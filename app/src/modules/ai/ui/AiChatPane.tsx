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

  const { loading, state, systemPromptInfo, providerType, error, send, stop, stopAndTruncate, changeRole, resetError } = useAiChat({
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

  const isStreamingUI = isDifyProvider && messages.some(
    (msg) => msg.role === 'assistant' && (visibleLengths[msg.id] ?? 0) < msg.content.length
  )
  const isProcessing = loading || isStreamingUI

  const handleStop = () => {
    // 找到当前正在“吐出”的消息（无论是网络流还是打字机流）
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
        />
      </div>
    </section>
  )
}
