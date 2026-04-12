import { useCallback, useEffect, useRef, useState } from 'react'
import type { WebLiteChatSession } from '../domain/models'
import { sendWebChatMessage } from '../application/webChatService'
import { chatSessionsRepoWeb } from '../storage/chatSessionsRepo.web'
import { settingsRepoWeb } from '../storage/settingsRepo.web'

export function useWebChatDetail(sessionId?: string) {
  const [session, setSession] = useState<WebLiteChatSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const latestSessionRef = useRef<WebLiteChatSession | null>(null)

  useEffect(() => {
    latestSessionRef.current = session
  }, [session])

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setSession(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      setSession(await chatSessionsRepoWeb.getSession(sessionId))
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const send = useCallback(async (input: string) => {
    const current = latestSessionRef.current
    if (!current || sending) return
    setSending(true)
    setError(null)

    const settings = await settingsRepoWeb.loadAiSettings()
    const optimisticAssistantId = crypto.randomUUID()
    const now = Date.now()
    const optimisticSession: WebLiteChatSession = {
      ...current,
      messages: [
        ...current.messages,
        { id: crypto.randomUUID(), role: 'user', content: input.trim(), createdAt: now },
        { id: optimisticAssistantId, role: 'assistant', content: '', createdAt: now + 1 },
      ],
      updatedAt: now + 1,
    }
    setSession(optimisticSession)
    latestSessionRef.current = optimisticSession

    const result = await sendWebChatMessage({
      session: current,
      input,
      settings,
      onAssistantChunk: (content) => {
        setSession((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            messages: prev.messages.map((message) =>
              message.id === optimisticAssistantId
                ? { ...message, content }
                : message,
            ),
          }
        })
      },
    })

    if (result.error) {
      setError(result.error)
      setSession(current)
      latestSessionRef.current = current
      setSending(false)
      return
    }

    await chatSessionsRepoWeb.saveSession(result.session)
    setSession(result.session)
    latestSessionRef.current = result.session
    setSending(false)
  }, [sending])

  return { session, loading, sending, error, refresh, send }
}
