import type { FC, FormEvent, KeyboardEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { ChatEntryMode, EntryContext } from '../domain/chatSession'
import { useAiChat } from './hooks/useAiChat'
import { copyTextToClipboard } from '../platform/clipboardService'
import { insertMarkdownAtCursorBelow, replaceSelectionWithText, createTabAndInsertContent } from '../platform/editorInsertService'
import { onNativePaste } from '../../platform/clipboardEvents'
import { AiChatBody } from './AiChatBody'

const EMPTY_MESSAGES = [] as const

export interface AiChatPaneProps {
  entryMode: ChatEntryMode
  initialContext?: EntryContext
  onClose: () => void
}

export const AiChatPane: FC<AiChatPaneProps> = ({ entryMode, initialContext, onClose }) => {
  const [input, setInput] = useState('')
  const [contextPrefix, setContextPrefix] = useState<string | null>(null)
  const [contextPrefixUsed, setContextPrefixUsed] = useState(false)
  const [attachedImageDataUrl, setAttachedImageDataUrl] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const paneRootRef = useRef<HTMLElement>(null)
  const isComposingRef = useRef(false)
  const lockEnterRef = useRef(false)

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
    open: true,
  })

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  useEffect(() => {
    if (!entryMode || !initialContext) {
      setContextPrefix(null)
      setContextPrefixUsed(false)
      return
    }

    if (entryMode === 'selection' && initialContext.type === 'selection') {
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

    if (entryMode === 'file' && initialContext.type === 'file') {
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
  }, [entryMode, initialContext])

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

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (isComposingRef.current) return
    await doSend()
  }


  const handleInputKeyDown = async (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposingRef.current) return
    if (e.key === 'Enter' && !e.shiftKey) {
      if (lockEnterRef.current) return
      e.preventDefault()
      if (loading) return
      await doSend()
    }
  }

  const handleCompositionStart = () => {
    isComposingRef.current = true
  }

  const handleCompositionEnd = () => {
    isComposingRef.current = false
    lockEnterRef.current = true
    setTimeout(() => {
      lockEnterRef.current = false
    }, 100)
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

  const messageSource = state?.viewMessages ?? EMPTY_MESSAGES
  const messages = messageSource.filter((m) => !m.hidden)

  const [visibleLengths, setVisibleLengths] = useState<Record<string, number>>({})
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
      // 切换到非 Dify 模式时，不再暴力清空 visibleLengths。
      // 因为 getDisplayContent 已经有 !isDifyProvider 的判断，所以保留缓存是安全的，
      // 且能防止切回 Dify 时因全量清空导致的“重新输出”。
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

    // 当前没有需要打字机动画的消息（没有 streaming 的助手消息），
    // 直接退出，不启动 requestAnimationFrame 循环。
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

        // 如果本轮没有任何变化，也不再继续调度下一帧
        if (!changed) {
          hasNextFrame = false
          return prev
        }

        return next
      })

      if (hasNextFrame) {
        frameId = window.requestAnimationFrame(tick)
      }
    }

    frameId = window.requestAnimationFrame(tick)

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [animationKey, messageSource])

  const getDisplayContent = (msgId: string, full: string, streaming?: boolean) => {
    if (!isDifyProvider || full.length === 0 || !state) return full
    const visible = visibleLengths[msgId]
    if (visible === undefined) {
      // 关键修复：对于已完成的历史消息，即便 visibleLengths 还未建立，也应直接展示全量，
      // 避免从 OpenAI 切换回 Dify 时导致历史记录重新“打”一遍。
      return streaming ? '' : full
    }
    const length = Math.max(0, Math.min(full.length, visible))
    return full.slice(0, length)
  }

  const isStreamingUI = isDifyProvider && messages.some(
    (msg) => msg.role === 'assistant' && (msg.streaming || (visibleLengths[msg.id] !== undefined && visibleLengths[msg.id] < msg.content.length))
  )
  const isProcessing = loading || isStreamingUI

  const handleStop = () => {
    // 找到当前正在“吐出”的消息（无论是网络流还是打字机流）
    const activeMsg = messages.find(m => m.role === 'assistant' && (m.streaming || (visibleLengths[m.id] ?? 0) < m.content.length))
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
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey
      if (!isMeta) return
      const key = e.key.toLowerCase()
      if (key !== 'w') return
      if (typeof document === 'undefined') return
      const root = paneRootRef.current
      const active = document.activeElement as HTMLElement | null
      if (!root || !active) return
      if (!root.contains(active)) return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [onClose])

  return (
    <section className="pane ai-chat-pane" ref={paneRootRef}>
      <div className="ai-chat-pane-header">
        <div className="ai-chat-pane-title">
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
        <button
          type="button"
          className="ai-chat-close-button"
          aria-label="关闭 AI Chat"
          onClick={onClose}
        >
          <span className="ai-chat-close-icon" aria-hidden="true" />
        </button>
      </div>

      <div className="ai-chat-pane-body">
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
            console.warn('[AiChatPane] Render AiChatBody', { providerType, canUpload });
            return canUpload ? uploadFiles : undefined;
          })()}
        />
      </div>
    </section>
  )
}
