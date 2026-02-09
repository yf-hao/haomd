import type { ChangeEvent, FC, FormEvent, KeyboardEvent } from 'react'
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
    const raw = input
    const trimmed = raw.trim()

    if (!trimmed && !contextPrefix) return

    let finalContent = trimmed
    let hideUserInView = false

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

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
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

  const handleReplace = async (content: string) => {
    await replaceSelectionWithText(content)
  }

  const handleSave = async (content: string) => {
    await createTabAndInsertContent(content)
  }

  const handleChangeRole = async (e: ChangeEvent<HTMLSelectElement>) => {
    const roleId = e.target.value
    if (!roleId) return
    await changeRole(roleId)
  }

  const messageSource = state?.viewMessages ?? EMPTY_MESSAGES
  const messages = messageSource.filter((m) => !m.hidden)

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

  return (
    <section className="pane ai-chat-pane">
      <div className="ai-chat-pane-header">
        <div className="ai-chat-pane-title">AI Chat</div>
        <div className="ai-chat-role">
          <select
            id="ai-chat-role-select-pane"
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
          loading={loading}
          error={error}
          input={input}
          onInputChange={(value) => {
            setInput(value)
            autoResizeInput()
          }}
          onSubmit={handleSubmit}
          onInputKeyDown={handleInputKeyDown}
          inputRef={inputRef}
          messagesContainerRef={messagesContainerRef}
          getDisplayContent={getDisplayContent}
          onCopy={handleCopy}
          onInsert={handleInsert}
          onReplace={handleReplace}
          onSave={handleSave}
          resetError={resetError}
        />
      </div>
    </section>
  )
}
