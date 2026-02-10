import type { FC, FormEvent, KeyboardEvent, MouseEventHandler, MouseEvent as ReactMouseEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { ChatEntryMode, ChatMessageView, EntryContext } from '../domain/chatSession'
import { AiChatBody } from './AiChatBody'
import { useAiChat } from './hooks/useAiChat'
import { copyTextToClipboard } from '../platform/clipboardService'
import { insertMarkdownAtCursorBelow, replaceSelectionWithText, createTabAndInsertContent } from '../platform/editorInsertService'
import { onNativePaste } from '../../platform/clipboardEvents'

const EMPTY_MESSAGES: ChatMessageView[] = []

export type AiChatDialogProps = {
  open: boolean
  entryMode: ChatEntryMode
  initialContext?: EntryContext
  onClose: () => void
}

export const AiChatDialog: FC<AiChatDialogProps> = ({ open, entryMode, initialContext, onClose }) => {
  const [input, setInput] = useState('')
  const [contextPrefix, setContextPrefix] = useState<string | null>(null)
  const [contextPrefixUsed, setContextPrefixUsed] = useState(false)
  const [attachedImageDataUrl, setAttachedImageDataUrl] = useState<string | null>(null)
  const [isComposing, setIsComposing] = useState(false)
  const [compositionEndTime, setCompositionEndTime] = useState(0)
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
  } = useAiChat({
    entryMode,
    initialContext,
    open,
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

  useEffect(() => {
    if (!open) return
    console.warn('[AiChatDialog] open, providerType:', providerType)
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [open, providerType])

  const doSend = async () => {
    await sendMessage(input, {
      contextPrefix,
      contextPrefixUsed,
      onContextUsed: () => {
        setContextPrefixUsed(true)
        setContextPrefix(null)
      },
      attachedImageDataUrl,
      onClearAttachedImage: () => setAttachedImageDataUrl(null),
    })
    setInput('')
    autoResizeInput()
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
    await insertMarkdownAtCursorBelow(content)
  }

  const handleReplace = async (content: string) => {
    await replaceSelectionWithText(content)
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

  const messageSource = state?.viewMessages ?? EMPTY_MESSAGES
  const messages = messageSource.filter((m) => !m.hidden)
  const [visibleLengths, setVisibleLengths] = useState<Record<string, number>>({})

  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragStateRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)

  const isDifyProvider = providerType === 'dify'

  // 核心改进：打字机动画不仅仅取决于“网络是否正在流式传输”，还取决于“打字机是否追上了内容”。
  // 这样可以确保在网络流结束后的最后一小段文字也能平滑打完，且切换模型时状态更稳定。
  const isTypewriterRunning = isDifyProvider && messages.some(
    (msg) => msg.role === 'assistant' && (
      msg.streaming || (visibleLengths[msg.id] !== undefined && visibleLengths[msg.id] < msg.content.length)
    )
  )

  const streamingIds = messages
    .filter((m) => m.role === 'assistant' && m.streaming)
    .map((m) => m.id)
    .join(',')

  const animationKey = !isDifyProvider ? 'off' : (isTypewriterRunning ? `active:${streamingIds}` : 'idle')

  useEffect(() => {
    if (!isDifyProvider) {
      return
    }

    // 先确保所有已完成的助手消息在打字机模式下也是“全量显示”的，
    // 避免在切换模型时对历史消息重新做打字动画。
    setVisibleLengths((prev) => {
      const next: Record<string, number> = { ...prev }
      for (const msg of messages) {
        if (msg.role !== 'assistant') continue
        if (msg.streaming) continue
        const fullLen = msg.content.length
        if (fullLen === 0) continue
        const current = next[msg.id]
        if (current === undefined || current < fullLen) {
          next[msg.id] = fullLen
        }
      }
      return next
    })

    if (animationKey === 'idle') {
      return
    }

    let frameId: number | null = null
    let lastTime = performance.now()
    const stepPerSecond = 60

    const tick = (time: number) => {
      const deltaMs = time - lastTime
      lastTime = time
      const deltaChars = Math.max(1, Math.round((deltaMs / 1000) * stepPerSecond))

      let hasNextFrame = false

      setVisibleLengths((prev) => {
        let changed = false
        const next: Record<string, number> = { ...prev }

        for (const msg of messages) {
          if (msg.role !== 'assistant') continue
          const fullLen = msg.content.length
          if (fullLen === 0) continue

          const base = msg.streaming ? next[msg.id] ?? 0 : next[msg.id] ?? fullLen
          if (base >= fullLen) continue

          const target = Math.min(fullLen, base + deltaChars)
          if (target !== base) {
            next[msg.id] = target
            changed = true
          }

          if (target < fullLen) {
            hasNextFrame = true
          }
        }

        return changed ? next : prev
      })

      if (hasNextFrame) {
        frameId = window.requestAnimationFrame(tick)
      }
    }

    frameId = window.requestAnimationFrame(tick)

    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId)
    }
  }, [animationKey, messageSource, isDifyProvider])

  const getDisplayContent = (msgId: string, full: string, streaming?: boolean) => {
    if (!isDifyProvider || full.length === 0 || !state) return full
    const visible = visibleLengths[msgId]
    if (visible === undefined) {
      // 关键修复：如果是已经结束的消息（非 streaming），且 visibleLengths 中没有记录，
      // 说明是刚刚从非 Dify 模式切过来的历史消息，应直接全量显示，不触发打字机。
      return streaming ? '' : full
    }
    const length = Math.max(0, Math.min(full.length, visible))
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

  const isStreamingUI = isDifyProvider && messages.some(
    (msg) => msg.role === 'assistant' && (msg.streaming || (visibleLengths[msg.id] !== undefined && visibleLengths[msg.id] < msg.content.length))
  )
  const isProcessing = loading || isStreamingUI

  const handleStop = () => {
    // 找到当前正在“吐出”的消息（无论是网络流还是打字机流）
    const activeMsg = messages.find(m => m.role === 'assistant' && (m.streaming || (visibleLengths[m.id] !== undefined && visibleLengths[m.id] < m.content.length)))
    if (activeMsg) {
      if (isDifyProvider) {
        const currentLen = visibleLengths[activeMsg.id] ?? 0
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
      ? getDisplayContent(lastMessage.id, lastMessage.content, lastMessage.streaming).length
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

  if (!open) return null

  return (
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
              switch (entryMode) {
                case 'selection':
                  return 'AI Chat -- About Selection';
                case 'file':
                  return 'AI Chat -- About File';
                default:
                  return 'AI Chat';
              }
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
            console.warn('[AiChatDialog] onAttachImage callback', { providerType })
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
            if (open) {
              console.warn('[AiChatDialog] Render AiChatBody', { providerType, canUpload });
            }
            return canUpload ? uploadFiles : undefined;
          })()}
        />


        <div className="ai-chat-drag-handle ai-chat-drag-bottom" onMouseDown={handleDragStart} />
        <div className="ai-chat-drag-handle ai-chat-drag-left" onMouseDown={handleDragStart} />
        <div className="ai-chat-drag-handle ai-chat-drag-right" onMouseDown={handleDragStart} />
      </div>
    </div>
  )
}
