import type { ChangeEvent, FC, FormEvent, KeyboardEvent, MouseEvent as ReactMouseEvent, MouseEventHandler } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { ChatEntryMode, ChatMessageView, EntryContext } from '../domain/chatSession'
import { MarkdownViewer } from '../../../components/MarkdownViewer'
import { useAiChat } from './hooks/useAiChat'
import { copyTextToClipboard } from '../platform/clipboardService'
import { insertMarkdownAtCursorBelow } from '../platform/editorInsertService'
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
  // 通用上下文前缀：用于 file / selection 入口的首条消息拼接
  const [contextPrefix, setContextPrefix] = useState<string | null>(null)
  const [contextPrefixUsed, setContextPrefixUsed] = useState(false)
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

  // 当通过文件/选区入口打开时，准备上下文前缀：
  // - selection： [选中内容]\n\n根据以上问题回答：
  // - file：      下面是文件「name」的完整内容：\n\n[全文]\n\n根据以上问题回答：
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

    // 其他模式（chat 等）不使用上下文前缀
    setContextPrefix(null)
    setContextPrefixUsed(false)
  }, [open, entryMode, initialContext])

  // 监听原生粘贴事件：当焦点在 AI 输入框时，支持 Cmd/Ctrl+V 粘贴
  useEffect(() => {
    const unPaste = onNativePaste((text) => {
      if (!text) return
      const el = inputRef.current
      if (!el) return

      if (typeof document !== 'undefined') {
        const active = document.activeElement
        // 仅在 AI 输入框聚焦时处理粘贴，避免影响编辑器或其他输入框
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
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [open])

  const doSend = async () => {
    const raw = input
    const trimmed = raw.trim()

    // 如果既没有用户输入也没有上下文前缀，则不发送
    if (!trimmed && !contextPrefix) return

    let finalContent = trimmed
    let hideUserInView = false

    // file / selection 模式下的首条消息：
    //   [上下文前缀]\n\n[用户输入]
    if ((entryMode === 'file' || entryMode === 'selection') && contextPrefix && !contextPrefixUsed) {
      finalContent = trimmed ? `${contextPrefix}\n\n${trimmed}` : contextPrefix
      setContextPrefixUsed(true)
      setContextPrefix(null)
      hideUserInView = true
    }

    setInput('')
    autoResizeInput()
    await send(finalContent, hideUserInView ? { hideUserInView: true } : undefined)
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

  // 原始消息列表（稳定引用），用于作为动画和依赖的来源
  const messageSource = state?.viewMessages ?? EMPTY_MESSAGES
  // 实际渲染时过滤掉 hidden 消息
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

        // 使用过滤后的 messages 做打字机动画
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
  }, [isDifyProvider, messageSource])

  const getDisplayContent = (msgId: string, full: string, streaming?: boolean) => {
    if (!isDifyProvider || full.length === 0 || !state) return full
    const visible = visibleLengths[msgId]
    if (visible === undefined) {
      return streaming ? '' : full
    }
    const length = Math.max(0, Math.min(full.length, visible))
    return full.slice(0, length)
  }

  const handleDragStart: MouseEventHandler<HTMLDivElement> = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return

    // 如果用户在可交互控件上按下（如 select/button/input/textarea），不要触发拖拽
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

  // 当 AI Chat 打开时，拦截 Cmd/Ctrl+W，优先关闭 AI Chat 而不是文档
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

        {/* 额外拖拽区域：底部 + 左右两侧 */}
        <div
          className="ai-chat-drag-handle ai-chat-drag-bottom"
          onMouseDown={handleDragStart}
        />
        <div
          className="ai-chat-drag-handle ai-chat-drag-left"
          onMouseDown={handleDragStart}
        />
        <div
          className="ai-chat-drag-handle ai-chat-drag-right"
          onMouseDown={handleDragStart}
        />
      </div>
    </div>
  )
}
