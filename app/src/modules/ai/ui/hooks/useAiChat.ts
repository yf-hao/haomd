import { useCallback, useEffect, useState } from 'react'
import type { ChatEntryMode, ConversationState, EntryContext } from '../../domain/chatSession'
import type { SystemPromptInfo } from '../../application/systemPromptService'
import type { ChatSession, StartChatOptions } from '../../application/chatSessionService'
import { createChatSession } from '../../application/chatSessionService'

export type UseAiChatOptions = {
  entryMode: ChatEntryMode
  initialContext?: EntryContext
  open: boolean
}

export type UseAiChatResult = {
  loading: boolean
  state: ConversationState | null
  systemPromptInfo: SystemPromptInfo | null
  error: Error | null
  send: (content: string) => Promise<void>
  changeRole: (roleId: string) => Promise<void>
  resetError: () => void
}

export function useAiChat(options: UseAiChatOptions): UseAiChatResult {
  const { entryMode, initialContext, open } = options
  const [session, setSession] = useState<ChatSession | null>(null)
  const [loading, setLoading] = useState(false)
  const [state, setState] = useState<ConversationState | null>(null)
  const [systemPromptInfo, setSystemPromptInfo] = useState<SystemPromptInfo | null>(null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    const startSession = async () => {
      try {
        const startOptions: StartChatOptions = {
          entryMode,
          initialContext,
          onStateChange: (nextState) => {
            if (cancelled) return
            setState(nextState)
          },
        }

        const created = await createChatSession(startOptions)
        if (cancelled) {
          created.dispose()
          return
        }

        setSession(created)
        setState(created.getState())
        setSystemPromptInfo(created.getSystemPromptInfo())
      } catch (e) {
        if (cancelled) return
        setError(e as Error)
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void startSession()

    return () => {
      cancelled = true
      setSession((prev) => {
        if (prev) {
          prev.dispose()
        }
        return null
      })
    }
  }, [open, entryMode, initialContext])

  const send = useCallback(
    async (content: string) => {
      if (!session) return
      setError(null)
      await session.sendUserMessage(content)
      setState(session.getState())
      setSystemPromptInfo(session.getSystemPromptInfo())
    },
    [session],
  )

  const changeRole = useCallback(
    async (roleId: string) => {
      if (!session) return
      setError(null)
      await session.setActiveRole(roleId)
      setSystemPromptInfo(session.getSystemPromptInfo())
    },
    [session],
  )

  const resetError = useCallback(() => {
    setError(null)
  }, [])

  return {
    loading,
    state,
    systemPromptInfo,
    error,
    send,
    changeRole,
    resetError,
  }
}
