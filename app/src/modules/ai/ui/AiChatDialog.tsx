import type { FC, FormEvent, KeyboardEvent, MouseEventHandler, MouseEvent as ReactMouseEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { ChatEntryMode, ChatMessageView, EntryContext } from '../domain/chatSession'
import type { VisionTask } from '../domain/types'
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
    send,
    sendVisionTask,
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

  const DEFAULT_VISION_PROMPT = '解析图片并根据上下文回复'

  const doSend = async () => {
    const raw = input
    const trimmed = raw.trim()
    const isDify = providerType === 'dify'
    const hasAttachments = isDify ? pendingAttachments.length > 0 : !!attachedImageDataUrl

    console.warn('[AiChatDialog] doSend', { providerType, isDify, hasAttachments, pendingCount: pendingAttachments.length })

    // 没有文字、没有上下文、也没有图片时不发送
    if (!trimmed && !contextPrefix && !hasAttachments) return

    const basePrompt =
      trimmed || (!trimmed && hasAttachments ? DEFAULT_VISION_PROMPT : '')

    let finalContent = basePrompt
    let hideUserInView = false

    if ((entryMode === 'file' || entryMode === 'selection') && contextPrefix && !contextPrefixUsed) {
      finalContent = basePrompt ? `${contextPrefix}\n\n${basePrompt}` : contextPrefix
      setContextPrefixUsed(true)
      setContextPrefix(null)
      hideUserInView = true
    }
    setInput('')
    autoResizeInput()

    if (attachedImageDataUrl && !isDify) {
      const visionTask: VisionTask = {
        prompt: finalContent,
        images: [
          { kind: 'data_url', dataUrl: attachedImageDataUrl },
        ],
      }
      await sendVisionTask(visionTask, hideUserInView ? { hideUserInView: true } : undefined)
    } else {
      // 这里的 send 在 useAiChat 中已经被增强，会自动带上 pendingAttachments
      await send(finalContent, hideUserInView ? { hideUserInView: true } : undefined)
    }

    // 发送后清空已附加图片 (传统方案)
    if (!isDify) {
      setAttachedImageDataUrl(null)
    }
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

  useEffect(() => {
    if (!isDifyProvider) {
      setVisibleLengths({})
      return
    }
    let frameId: number | null = null
    let lastTime = performance.now()
    const stepPerSecond = 60
    const tick = (time: number) => {
      const deltaMs = time - lastTime
      lastTime = time
      const deltaChars = Math.max(1, Math.round((deltaMs / 1000) * stepPerSecond))
      setVisibleLengths((prev) => {
        let changed = false
        const next: Record<string, number> = { ...prev }
        for (const msg of messages) {
          if (msg.role !== 'assistant') continue
          const fullLen = msg.content.length
          if (fullLen === 0) continue
          const current = next[msg.id] ?? 0
          if (current >= fullLen) continue
          const target = Math.min(fullLen, current + deltaChars)
          if (target !== current) {
            next[msg.id] = target
            changed = true
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
  }, [isDifyProvider, messageSource])

  const getDisplayContent = (msgId: string, full: string, streaming?: boolean) => {
    if (!isDifyProvider || full.length === 0 || !state) return full
    const visible = visibleLengths[msgId]
    if (visible === undefined) return streaming ? '' : full
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
    (msg) => msg.role === 'assistant' && (visibleLengths[msg.id] ?? 0) < msg.content.length
  )
  const isProcessing = loading || isStreamingUI

  const handleStop = () => {
    const activeMsg = messages.find(m => m.role === 'assistant' && (m.streaming || (visibleLengths[m.id] ?? 0) < m.content.length))
    if (activeMsg) {
      const currentLen = visibleLengths[activeMsg.id] ?? 0
      stopAndTruncate(activeMsg.id, currentLen)
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
