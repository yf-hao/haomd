import type { FC, FormEvent, KeyboardEvent, MouseEventHandler, MouseEvent as ReactMouseEvent } from 'react'
import { useContext, useEffect, useRef, useState } from 'react'
import { getAiChatUiSettings } from '../../settings/editorSettings'
import type { ChatEntryMode, ChatMessageView, EntryContext } from '../domain/chatSession'
import { getDirKeyFromDocPath } from '../domain/docPathUtils'
import { AiChatBody } from './AiChatBody'
import { useAiChatSession } from './hooks/useAiChatSession'
import { getAiInputHistory, appendAiInputHistory } from '../application/localStorageAiChatInputHistory'
import { resolveHistoryEntryByOrdinal } from '../application/historyViewService'
import { copyTextToClipboard } from '../platform/clipboardService'
import { insertMarkdownAtCursorBelow, replaceSelectionWithText, createTabAndInsertContent } from '../platform/editorInsertService'
import { onNativePaste, onNativePasteImage } from '../../platform/clipboardEvents'
import { base64ToImageDataUrl, base64ToImageFile, readClipboardImageBase64 } from '../platform/clipboardImageService'
import { tryHandleSlashCommand, parseHistoryRecallCommand } from './aiSlashCommands'
import { AiChatCommandBridgeContext } from './AiChatCommandBridgeContext'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { AiChatHistoryDialog } from './AiChatHistoryDialog'

const EMPTY_MESSAGES: ChatMessageView[] = []

export type AiChatDialogProps = {
  open: boolean
  entryMode: ChatEntryMode
  initialContext?: EntryContext
  onClose: () => void
  currentFilePath?: string | null
  /**
   * 用于在本地持久化与恢复会话的 key，一般为 tabId。
   */
  tabId: string
}

export const AiChatDialog: FC<AiChatDialogProps> = ({ open, entryMode, initialContext, onClose, currentFilePath, tabId }) => {
  const [input, setInput] = useState('')
  const [contextPrefix, setContextPrefix] = useState<string | null>(null)
  const [contextPrefixUsed, setContextPrefixUsed] = useState(false)
  const [contextPlaceholderMode, setContextPlaceholderMode] = useState<'none' | 'selection' | 'file'>('none')
  const [attachedImageDataUrl, setAttachedImageDataUrl] = useState<string | null>(null)
  const [slashModalMessage, setSlashModalMessage] = useState<string | null>(null)
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false)
  const [historyDialogDirKey, setHistoryDialogDirKey] = useState<string | null>(null)
  // 仅在通过 /list 打开输入历史弹窗时，才允许使用 `!n` 本地历史回填命令
  const [historyRecallEnabled, setHistoryRecallEnabled] = useState(false)
  const commandBridge = useContext(AiChatCommandBridgeContext)
  const [isComposing, setIsComposing] = useState(false)
  const [compositionEndTime, setCompositionEndTime] = useState(0)
  const [historyCursor, setHistoryCursor] = useState<number | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const messagesContainerRef = useRef<HTMLDivElement | null>(null)

  const autoResizeInput = () => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    const maxHeight = 120
    const next = Math.min(maxHeight, el.scrollHeight)
    el.style.height = `${next}px`
  }

  const dirKey = currentFilePath ? getDirKeyFromDocPath(currentFilePath) : undefined

  const {
    loading,
    state,
    systemPromptInfo,
    providerType,
    error,
    sendMessage,
    stop,
    stopAndTruncate,
    changeRole,
    changeModel,
    resetError,
    availableModels,
    activeModelId,
    pendingAttachments,
    uploadFiles,
    removeAttachment,
    isUploading,
    getRecentMessagesForDigest,
  } = useAiChatSession({
    sessionKey: tabId,
    entryMode,
    initialContext,
    open,
    docPath: dirKey,
    legacyDocPath: currentFilePath ?? undefined,
  })

  useEffect(() => {
    if (!open) {
      setContextPrefix(null)
      setContextPrefixUsed(false)
      return
    }

    if (entryMode === 'selection' && initialContext && initialContext.type === 'selection') {
      const selection = initialContext.content.trim()
      if (selection) {
        setContextPrefix(`${selection}\n\n根据以上问题回答：`)
        setContextPrefixUsed(false)
      } else {
        setContextPrefix(null)
        setContextPrefixUsed(false)
      }
      return
    }

    if (entryMode === 'file' && initialContext && initialContext.type === 'file') {
      const content = initialContext.content.trim()
      if (content) {
        const fileName = initialContext.fileName?.trim()
        const header = fileName
          ? `下面是文件「${fileName}」的完整内容：`
          : '下面是当前文件的完整内容：'
        setContextPrefix(`${header}\n\n${content}\n\n根据以上问题回答：`)
        setContextPrefixUsed(false)
      } else {
        setContextPrefix(null)
        setContextPrefixUsed(false)
      }
      return
    }

    setContextPrefix(null)
    setContextPrefixUsed(false)
  }, [open, entryMode, initialContext])

  useEffect(() => {
    if (!open) {
      setContextPlaceholderMode('none')
      return
    }
    if (entryMode === 'selection' && initialContext && initialContext.type === 'selection') {
      setContextPlaceholderMode('selection')
      return
    }
    if (entryMode === 'file' && initialContext && initialContext.type === 'file') {
      setContextPlaceholderMode('file')
      return
    }
    setContextPlaceholderMode('none')
  }, [open, entryMode, initialContext])

  useEffect(() => {
    const unPaste = onNativePaste((text) => {
      if (!text) return
      const el = inputRef.current
      if (!el) return
      if (typeof document !== 'undefined') {
        const active = document.activeElement
        if (active !== el) return
      }
      const start = el.selectionStart ?? el.value.length
      const end = el.selectionEnd ?? el.value.length
      const value = el.value
      const next = value.slice(0, start) + text + value.slice(end)
      el.value = next
      setInput(next)
      const pos = start + text.length
      el.setSelectionRange(pos, pos)
    })
    return () => {
      unPaste()
    }
  }, [])

  // 处理来自 Tauri 原生菜单的图片粘贴（native://paste_image），仅在 AI Chat 输入框聚焦时生效
  useEffect(() => {
    const unlisten = onNativePasteImage(async () => {
      const el = inputRef.current
      if (!el) return

      if (typeof document !== 'undefined') {
        const active = document.activeElement
        if (active !== el) {
          // 焦点不在 AI Chat 输入框时，不处理这次图片粘贴（交给编辑器等其它逻辑）
          return
        }
      }

      try {
        // 直接从剪贴板读取图片为 base64，不再依赖文件路径和 haomd 协议
        const base64 = await readClipboardImageBase64()

        const fileName = (() => {
          if (!currentFilePath) return 'clipboard.png'
          const pathPart = currentFilePath.split(/[/\\]/).pop() || ''
          const withoutExt = pathPart.replace(/\.[^./\\]+$/, '')
          const base = withoutExt || 'clipboard'
          return `image_${base}.png`
        })()

        if (!providerType || providerType === 'dify') {
          const file = base64ToImageFile(base64, fileName, 'image/png')
          console.log('[AiChatDialog] native image paste: uploading file', file.name)
          await uploadFiles([file])
          return
        }

        const dataUrl = base64ToImageDataUrl(base64, 'image/png')
        console.log('[AiChatDialog] native image paste: attachedImageDataUrl set via base64')
        setAttachedImageDataUrl(dataUrl)
      } catch (e) {
        console.error('[AiChatDialog] native image paste: error', e)
      }
    })

    return () => {
      unlisten()
    }
  }, [currentFilePath, providerType, uploadFiles])

  useEffect(() => {
    if (!open) return
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
    autoResizeInput()
  }, [open, providerType])

  const doSend = async () => {
    const contentToSend = input
    const directoryKey = dirKey ?? '/'

    // 先处理本地历史回填命令：!n / ！n
    const ordinal = parseHistoryRecallCommand(contentToSend)
    if (ordinal != null) {
      if (!historyRecallEnabled) {
        // 当前未处于“输入历史选择”模式：忽略本次 !n 命令，避免与 /history 语义混淆
        return
      }
      const entry = resolveHistoryEntryByOrdinal(directoryKey, ordinal)
      if (entry && entry.text.trim()) {
        const nextText = entry.text
        setInput(nextText)
        requestAnimationFrame(() => {
          const el = inputRef.current
          if (!el) return
          const len = el.value.length
          el.setSelectionRange(len, len)
          autoResizeInput()
        })
      }
      return
    }

    // 记录本次输入到当前目录的输入历史（包含普通提问和 /history /list 等指令）
    if (contentToSend.trim()) {
      appendAiInputHistory(directoryKey, contentToSend)
    }

    // 非本地历史命令：正常进入 slash 命令和模型发送流程
    setInput('')
    autoResizeInput()

    const handled = await tryHandleSlashCommand(contentToSend, {
      // slash 命令与文档会话保持一致：按目录共享会话
      docPath: dirKey,
      runAppCommand: commandBridge?.runAppCommand,
      showModal: (message: string) => setSlashModalMessage(message),
      getRecentMessagesForDigest: getRecentMessagesForDigest,
      openHistoryDialog: ({ docPath }) => {
        const key = docPath ?? dirKey ?? '/'
        setHistoryDialogDirKey(key)
        setHistoryDialogOpen(true)
        setHistoryRecallEnabled(true)
      },
    })
    if (handled === 'handled') {
      return
    }

    await sendMessage(contentToSend, {
      contextPrefix,
      contextPrefixUsed,
      onContextUsed: () => {
        setContextPrefixUsed(true)
        setContextPrefix(null)
        setContextPlaceholderMode('none')
      },
      attachedImageDataUrl,
      onClearAttachedImage: () => setAttachedImageDataUrl(null),
    })
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    await doSend()
  }

  const handleCompositionStart = () => {
    setIsComposing(true)
  }

  const handleCompositionEnd = () => {
    const now = Date.now()
    setIsComposing(false)
    setCompositionEndTime(now)
  }

  const handleInputKeyDown = async (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const isHistoryMode = historyCursor != null

    // 当输入框为空或已处于历史模式时，使用 ArrowUp / ArrowDown 在当前目录的输入历史中导航
    if (
      (e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
      !e.shiftKey &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey
    ) {
      if (isComposing || e.nativeEvent.isComposing) return

      if (!isHistoryMode && input.trim().length > 0) {
        // 非历史模式且当前输入非空：不进入历史浏览，交给默认光标逻辑
      } else {
        const directoryKey = dirKey ?? '/'
        const historyList = getAiInputHistory(directoryKey)
        if (historyList.length === 0) return

        const direction = e.key === 'ArrowUp' ? 'up' as const : 'down' as const
        let nextCursor = historyCursor

        if (direction === 'up') {
          if (nextCursor == null) {
            nextCursor = historyList.length - 1
          } else if (nextCursor > 0) {
            nextCursor = nextCursor - 1
          } else {
            nextCursor = 0
          }
        } else {
          if (nextCursor == null) {
            // 尚未进入历史模式时，向下键不做特殊处理，交给默认光标逻辑
            return
          } else if (nextCursor < historyList.length - 1) {
            nextCursor = nextCursor + 1
          } else {
            nextCursor = historyList.length - 1
          }
        }

        const entry = historyList[nextCursor]
        if (!entry || !entry.text.trim()) return

        const el = inputRef.current
        if (!el) return

        e.preventDefault()
        setHistoryCursor(nextCursor)
        setInput(entry.text)
        // 将光标移动到末尾
        requestAnimationFrame(() => {
          const target = inputRef.current
          if (!target) return
          const len = target.value.length
          target.setSelectionRange(len, len)
          autoResizeInput()
        })
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      if (isComposing || e.nativeEvent.isComposing) return
      const now = Date.now()
      const timeDiff = now - compositionEndTime
      if (timeDiff < 50) return
      e.preventDefault()
      if (loading) return
      await doSend()
    }
  }

  const handleCopy = async (content: string) => {
    await copyTextToClipboard(content)
  }

  const handleInsert = async (content: string) => {
    await insertMarkdownAtCursorBelow({ text: content, sourceTabId: tabId })
  }

  const handleReplace = async (content: string) => {
    await replaceSelectionWithText({ text: content, sourceTabId: tabId })
  }

  const handleSave = async (content: string) => {
    await createTabAndInsertContent(content)
  }

  const handleChangeRole = async (roleId: string) => {
    if (!roleId) return
    await changeRole(roleId)
  }

  const handleModelChange = async (modelId: string) => {
    if (!modelId) return
    await changeModel(modelId)
  }

  const handleDialogClick: MouseEventHandler<HTMLDivElement> = (e) => {
    e.stopPropagation()
  }

  const [maxVisibleMessages, setMaxVisibleMessages] = useState<number>(10)

  useEffect(() => {
    let cancelled = false

    getAiChatUiSettings()
      .then((cfg) => {
        if (cancelled) return
        const n = cfg.maxVisibleMessagesDialog
        if (typeof n === 'number' && n > 0) {
          setMaxVisibleMessages(n)
        }
      })
      .catch((e) => {
        console.error('[AiChatDialog] failed to load AiChatUiSettings', e)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const messageSource = state?.viewMessages ?? EMPTY_MESSAGES
  const allMessages = messageSource.filter((m) => !m.hidden)
  const limit = maxVisibleMessages && maxVisibleMessages > 0 ? maxVisibleMessages : allMessages.length
  const messages =
    allMessages.length > limit
      ? allMessages.slice(-limit)
      : allMessages
  const [visibleLengths, setVisibleLengths] = useState<Record<string, number>>({})
  const [activeTypewriterId, setActiveTypewriterId] = useState<string | null>(null)

  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragStateRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)

  const isDifyProvider = providerType === 'dify'

  // 核心策略：任何时刻只允许“当前这一条助手回复”参与打字机动画，
  // 历史消息一律显示全文，避免重复播放。
  const isTypewriterRunning = isDifyProvider && !!activeTypewriterId && messages.some(
    (msg) => msg.id === activeTypewriterId && msg.role === 'assistant' && (
      msg.streaming || (visibleLengths[msg.id] !== undefined && visibleLengths[msg.id] < msg.content.length)
    ),
  )

  const streamingIds = messages
    .filter((m) => m.role === 'assistant' && m.streaming)
    .map((m) => m.id)
    .join(',')

  const animationKey = !isDifyProvider ? 'off' : (isTypewriterRunning ? `active:${streamingIds}` : 'idle')

  // 根据最新的 streaming 消息更新当前打字机目标，并锁死旧消息为全文
  useEffect(() => {
    if (!open || !isDifyProvider) {
      setActiveTypewriterId(null)
      return
    }

    const assistantMessages = messages.filter(m => m.role === 'assistant')
    if (assistantMessages.length === 0) {
      setActiveTypewriterId(null)
      return
    }

    const streamingMessages = assistantMessages.filter(m => m.streaming)
    const latestStreaming = streamingMessages[streamingMessages.length - 1]

    if (!latestStreaming) {
      return
    }

    const nextActiveId = latestStreaming.id
    if (nextActiveId === activeTypewriterId) {
      return
    }

    setVisibleLengths((prev) => {
      const next: Record<string, number> = { ...prev }
      for (const msg of assistantMessages) {
        const fullLen = msg.content.length
        if (fullLen === 0) continue
        if (msg.id === nextActiveId) {
          next[msg.id] = 0
        } else {
          next[msg.id] = fullLen
        }
      }
      return next
    })

    setActiveTypewriterId(nextActiveId)
  }, [open, isDifyProvider, messages, activeTypewriterId])


  useEffect(() => {
    if (!isDifyProvider) {
      return
    }

    if (animationKey === 'idle') {
      return
    }

    let frameId: number | null = null
    let lastTime = performance.now()
    // 打字机速度：每秒字符数
    const stepPerSecond = 70
    // 累积本轮还未消费的“字符额度”，避免过度刷新
    let charBudget = 0

    const tick = (time: number) => {
      const deltaMs = time - lastTime
      lastTime = time

      // 根据真实时间累积应该输出的字符数
      charBudget += (deltaMs / 1000) * stepPerSecond
      let deltaChars = Math.floor(charBudget)

      // 限制单帧最多输出的字符数，避免浏览器卡顿时一下子跳到全文
      const maxCharsPerFrame = 20
      if (deltaChars > maxCharsPerFrame) {
        deltaChars = maxCharsPerFrame
      }
      charBudget -= Math.max(0, deltaChars)

      setVisibleLengths((prev) => {
        let changed = false
        const next: Record<string, number> = { ...prev }

        for (const msg of messages) {
          if (msg.role !== 'assistant') continue
          const fullLen = msg.content.length
          if (fullLen === 0) continue

          const existing = next[msg.id]

          // 关键修复：只要消息正在流式传输，就必须立即在打字机进度表中“挂号” (设置为 0)。
          // 这样即便网络流在打字机还没产生第 1 个字时就结束了，打字机也能接手后续播放。
          if (msg.streaming && existing === undefined) {
            next[msg.id] = 0
            changed = true
          }

          const base = next[msg.id]
          // 如果该消息既不在 streaming 也不在打字机流程中，则跳过（处理历史对话）
          if (base === undefined) continue

          if (base >= fullLen) continue

          if (deltaChars > 0) {
            const target = Math.min(fullLen, base + deltaChars)
            if (target !== base) {
              next[msg.id] = target
              changed = true
            }
          }
        }

        return changed ? next : prev
      })

      frameId = window.requestAnimationFrame(tick)
    }

    frameId = window.requestAnimationFrame(tick)

    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId)
    }
  }, [animationKey, messageSource, isDifyProvider])

  useEffect(() => {
    if (!open || !isDifyProvider) return
    const assistantMessages = messages.filter((m) => m.role === 'assistant')
    console.warn('[AiChatDialog][typewriter] visibleLengths', {
      animationKey,
      items: assistantMessages.map((m) => ({
        id: m.id,
        streaming: m.streaming,
        contentLen: m.content.length,
        visible: visibleLengths[m.id],
      })),
    })
  }, [open, isDifyProvider, animationKey, messages, visibleLengths])

  const getDisplayContent = (msgId: string, full: string) => {
    if (!isDifyProvider || full.length === 0 || !state) return full

    // 只有当前打字目标参与截断，其他消息一律显示全文，避免重复播放
    if (msgId !== activeTypewriterId) {
      return full
    }

    const msg = messages.find((m) => m.id === msgId && m.role === 'assistant')
    const visible = visibleLengths[msgId]

    // 兜底：如果已经不是 streaming 状态，且打字机进度还没初始化/为 0，则直接展示全文
    if (!msg?.streaming && (visible === undefined || visible <= 0)) {
      return full
    }

    const length = Math.max(0, Math.min(full.length, visible ?? 0))
    return full.slice(0, length)
  }

  const handleDragStart: MouseEventHandler<HTMLDivElement> = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement | null
    if (target) {
      const interactive = target.closest('select, button, input, textarea')
      if (interactive) return
    }
    const { clientX, clientY } = e
    dragStateRef.current = {
      startX: clientX,
      startY: clientY,
      originX: dragOffset.x,
      originY: dragOffset.y,
    }
    setDragging(true)
    e.preventDefault()
  }

  useEffect(() => {
    if (!dragging) return
    const handleMove = (e: MouseEvent) => {
      const state = dragStateRef.current
      if (!state) return
      const dx = e.clientX - state.startX
      const dy = e.clientY - state.startY
      setDragOffset({ x: state.originX + dx, y: state.originY + dy })
    }
    const handleUp = () => {
      setDragging(false)
      dragStateRef.current = null
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [dragging])

  const isStreamingUI = isDifyProvider && !!activeTypewriterId && messages.some(
    (msg) => msg.id === activeTypewriterId && msg.role === 'assistant' && (
      msg.streaming || (visibleLengths[msg.id] !== undefined && visibleLengths[msg.id] < msg.content.length)
    ),
  )
  const isProcessing = loading || isStreamingUI

  const handleStop = () => {
    // 找到当前正在“吐出”的消息（无论是网络流还是打字机补齐阶段）
    const activeMsg = messages.find((m) =>
      m.role === 'assistant' && (
        m.streaming || (visibleLengths[m.id] !== undefined && visibleLengths[m.id] < m.content.length)
      ),
    )
    if (activeMsg) {
      if (isDifyProvider) {
        const currentLen = visibleLengths[activeMsg.id] ?? activeMsg.content.length
        stopAndTruncate(activeMsg.id, currentLen)
      } else {
        stop()
      }
    } else {
      stop()
    }
  }

  const roles = systemPromptInfo?.roles ?? []
  const activeRoleId = systemPromptInfo?.activeRoleId
  const lastMessage = messages[messages.length - 1]
  const lastMessageDisplayLength =
    lastMessage && lastMessage.role === 'assistant'
      ? getDisplayContent(lastMessage.id, lastMessage.content).length
      : lastMessage?.content.length ?? 0
  const lastMessageKey = lastMessage ? `${lastMessage.id}:${lastMessageDisplayLength}` : ''

  useEffect(() => {
    const el = messagesContainerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [lastMessageKey])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey
      if (!isMeta) return
      const key = e.key.toLowerCase()
      if (key !== 'w') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [open, onClose])

  const inputPlaceholder =
    contextPlaceholderMode === 'selection'
      ? 'Selected content will be used as context for the answer.'
      : contextPlaceholderMode === 'file'
        ? 'Current file content will be used as context for the answer.'
        : 'Ask anything to AI'

  if (!open) return null

  return (
    <>
    <div className="modal-backdrop modal-backdrop-plain">
      <div
        className="modal modal-ai-chat"
        onClick={handleDialogClick}
        style={{ transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)` }}
      >
        <div className="modal-title ai-chat-title" onMouseDown={handleDragStart}>
          <button
            type="button"
            className="ai-chat-close-button"
            aria-label="关闭 AI Chat"
            onClick={onClose}
          >
            <span className="ai-chat-close-icon" aria-hidden="true" />
          </button>
          <div className="modal-title-text">
            {(() => {
              if (entryMode === 'selection') {
                return contextPlaceholderMode === 'selection' ? 'AI Chat -- About Selection' : 'AI Chat';
              }
              if (entryMode === 'file') {
                return contextPlaceholderMode === 'file' ? 'AI Chat -- About File' : 'AI Chat';
              }
              return 'AI Chat';
            })()}
          </div>
        </div>

        <AiChatBody
          messages={messages}
          loading={isProcessing}
          error={error}
          input={input}
          onInputChange={(value) => {
            setInput(value)
            autoResizeInput()
          }}
          onSubmit={handleSubmit}
          onInputKeyDown={handleInputKeyDown}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          inputRef={inputRef as React.RefObject<HTMLTextAreaElement>}
          messagesContainerRef={messagesContainerRef as React.RefObject<HTMLDivElement>}
          getDisplayContent={getDisplayContent}
          onCopy={handleCopy}
          onInsert={handleInsert}
          onReplace={handleReplace}
          onSave={handleSave}
          onStop={handleStop}
          resetError={resetError}
          roles={roles}
          activeRoleId={activeRoleId}
          onChangeRole={handleChangeRole}
          models={availableModels}
          activeModelId={activeModelId}
          onChangeModel={handleModelChange}
          attachedImageDataUrl={attachedImageDataUrl}
          onAttachImage={(dataUrl) => {
            if (providerType !== 'dify') {
              setAttachedImageDataUrl(dataUrl)
            }
          }}
          onClearImage={() => setAttachedImageDataUrl(null)}
          pendingAttachments={pendingAttachments}
          onRemoveAttachment={removeAttachment}
          isUploading={isUploading}
          onUploadFiles={(() => {
            const canUpload = !providerType || providerType === 'dify';
            return canUpload ? uploadFiles : undefined;
          })()}
          inputPlaceholder={inputPlaceholder}
        />


        <div className="ai-chat-drag-handle ai-chat-drag-bottom" onMouseDown={handleDragStart} />
        <div className="ai-chat-drag-handle ai-chat-drag-left" onMouseDown={handleDragStart} />
        <div className="ai-chat-drag-handle ai-chat-drag-right" onMouseDown={handleDragStart} />
      </div>
    </div>
    {historyDialogOpen && historyDialogDirKey && (
      <AiChatHistoryDialog
        open={historyDialogOpen}
        directoryKey={historyDialogDirKey}
        pageSize={10}
        onClose={() => {
          setHistoryDialogOpen(false)
          setHistoryRecallEnabled(false)
        }}
      />
    )}
    {slashModalMessage && (
      <ConfirmDialog
        title="Global Memory"
        message={slashModalMessage}
        confirmText="确定"
        cancelText="关闭"
        onConfirm={() => setSlashModalMessage(null)}
        onCancel={() => setSlashModalMessage(null)}
      />
    )}
    </>
  )
}
