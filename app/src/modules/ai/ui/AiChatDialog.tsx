import type { ChangeEvent, FC, FormEvent, KeyboardEvent, MouseEventHandler } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { ChatEntryMode, EntryContext } from '../domain/chatSession'
import { MarkdownViewer } from '../../../components/MarkdownViewer'
import { useAiChat } from './hooks/useAiChat'
import { copyTextToClipboard } from '../platform/clipboardService'
import { insertMarkdownAtCursorBelow } from '../platform/editorInsertService'

export type AiChatDialogProps = {
  open: boolean
  entryMode: ChatEntryMode
  initialContext?: EntryContext
  onClose: () => void
}

export const AiChatDialog: FC<AiChatDialogProps> = ({ open, entryMode, initialContext, onClose }) => {
  const [input, setInput] = useState('')
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

  const { loading, state, systemPromptInfo, providerType, error, send, changeRole, resetError } = useAiChat({
    entryMode,
    initialContext,
    open,
  })

  useEffect(() => {
    if (!open) return
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [open])

  const doSend = async () => {
    const raw = input
    const value = raw.trim()
    if (!value) return
    setInput('')
    autoResizeInput()
    await send(value)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    await doSend()
  }

  const handleInputKeyDown = async (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
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

  const handleChangeRole = async (e: ChangeEvent<HTMLSelectElement>) => {
    const roleId = e.target.value
    if (!roleId) return
    await changeRole(roleId)
  }

  const handleDialogClick: MouseEventHandler<HTMLDivElement> = (e) => {
    e.stopPropagation()
  }

  const messages = state?.viewMessages ?? []
  const [visibleLengths, setVisibleLengths] = useState<Record<string, number>>({})

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
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [isDifyProvider, messages])

  const getDisplayContent = (msgId: string, full: string, streaming?: boolean) => {
    if (!isDifyProvider || full.length === 0 || !state) return full
    const visible = visibleLengths[msgId]
    if (visible === undefined) {
      return streaming ? '' : full
    }
    const length = Math.max(0, Math.min(full.length, visible))
    return full.slice(0, length)
  }
  const roles = systemPromptInfo?.roles ?? []
  const activeRoleId = systemPromptInfo?.activeRoleId
  const lastMessage = messages[messages.length - 1]

  const lastMessageDisplayLength =
    lastMessage && lastMessage.role === 'assistant'
      ? getDisplayContent(lastMessage.id, lastMessage.content, lastMessage.streaming).length
      : lastMessage?.content.length ?? 0

  const lastMessageKey = lastMessage
    ? `${lastMessage.id}:${lastMessageDisplayLength}`
    : ''

  useEffect(() => {
    const el = messagesContainerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [lastMessageKey])

  if (!open) return null

  return (
    <div className="modal-backdrop">
      <div className="modal modal-ai-chat" onClick={handleDialogClick}>
        <div className="modal-title ai-chat-title">
          <button
            type="button"
            className="ai-chat-close-button"
            aria-label="关闭 AI Chat"
            onClick={onClose}
          >
            <span className="ai-chat-close-icon" aria-hidden="true" />
          </button>
          <div className="modal-title-text">AI Chat</div>
          <div className="ai-chat-role">
            <select
              id="ai-chat-role-select"
              className="field-select"
              value={activeRoleId ?? ''}
              onChange={handleChangeRole}
            >
              {roles.length === 0 && <option value="">No roles configured</option>}
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="modal-content ai-chat-body">
          <div
            className="ai-chat-messages"
            ref={messagesContainerRef}
          >
            {messages.length === 0 && !loading && (
              <div className="ai-chat-empty muted small">开始对话，或通过文件/选区入口提问。</div>
            )}
            {messages.map((msg) => {
              const displayContent =
                msg.role === 'assistant'
                  ? getDisplayContent(msg.id, msg.content, msg.streaming)
                  : msg.content

              return (
                <div key={msg.id} className={`ai-chat-message ai-chat-message-${msg.role}`}>
                  {msg.role === 'assistant' ? (
                    <MarkdownViewer value={displayContent} />
                  ) : (
                    <div className="ai-chat-message-content">{displayContent}</div>
                  )}
                  {msg.role === 'assistant' && !msg.streaming && msg.content.trim() && (
                    <div className="ai-chat-message-actions">
                      <button
                        type="button"
                        className="icon-button ai-chat-icon-button"
                        title="复制为 Markdown"
                        aria-label="复制为 Markdown"
                        onClick={() => void handleCopy(msg.content)}
                      >
                        <span className="ai-chat-icon ai-chat-icon-copy" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="icon-button ai-chat-icon-button"
                        title="插入到编辑器"
                        aria-label="插入到编辑器"
                        onClick={() => void handleInsert(msg.content)}
                      >
                        <span className="ai-chat-icon ai-chat-icon-insert" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <form className="ai-chat-input" onSubmit={handleSubmit}>
            <textarea
              id="ai-chat-input"
              ref={inputRef}
              className="field-textarea"
              rows={1}
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                autoResizeInput()
              }}
              onKeyDown={handleInputKeyDown}
              placeholder="向 AI 提问，或继续就当前话题追问…"
            />
            <div className="ai-chat-input-actions">
              {error && (
                <div className="form-error" onClick={resetError}>
                  {error.message}
                </div>
              )}
              <button className="ghost primary" type="submit" disabled={loading}>
                {loading ? '思考中…' : '发送'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
