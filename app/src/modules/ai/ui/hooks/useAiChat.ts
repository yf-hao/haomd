import { useCallback, useEffect, useState } from 'react'
import type { ChatEntryMode, ConversationState, EntryContext } from '../../domain/chatSession'
import type { SystemPromptInfo } from '../../application/systemPromptService'
import type { ProviderType } from '../../domain/types'
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
  providerType: ProviderType | null
  error: Error | null
  send: (content: string, options?: { hideUserInView?: boolean }) => Promise<void>
  stop: () => void
  stopAndTruncate: (messageId: string, length: number) => void
  changeRole: (roleId: string) => Promise<void>
  changeModel: (modelId: string) => Promise<void>
  resetError: () => void
  availableModels: { id: string; providerName: string }[]
  activeModelId: string | null
}

export function useAiChat(options: UseAiChatOptions): UseAiChatResult {
  const { entryMode, initialContext, open } = options
  const [session, setSession] = useState<ChatSession | null>(null)
  const [loading, setLoading] = useState(false)
  const [state, setState] = useState<ConversationState | null>(null)
  const [systemPromptInfo, setSystemPromptInfo] = useState<SystemPromptInfo | null>(null)
  const [providerType, setProviderType] = useState<ProviderType | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [activeModelId, setActiveModelId] = useState<string | null>(null)
  const [rawModels, setRawModels] = useState<{ id: string; providerName: string }[]>([])

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
        setProviderType(created.getProviderType())
        setActiveModelId(created.getActiveModelId())
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

  // Load available models
  useEffect(() => {
    if (!open) return
    const loadModels = async () => {
      const { loadAiSettingsState } = await import('../../config/aiSettingsRepo')
      const settings = await loadAiSettingsState()
      const models = settings.providers.flatMap((p) =>
        p.models.map((m) => ({
          id: m.id,
          providerName: p.name,
        })),
      )
      setRawModels(models)
    }
    void loadModels()
  }, [open])

  const isGenerating = !!state?.viewMessages.some((m) => m.streaming) || loading

  const send = useCallback(
    async (content: string, options?: { hideUserInView?: boolean }) => {
      if (!session) return
      setError(null)
      setLoading(true)
      try {
        await session.sendUserMessage(content, { hideInView: options?.hideUserInView })
      } finally {
        setLoading(false)
        setState(session.getState())
        setSystemPromptInfo(session.getSystemPromptInfo())
      }
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

  const changeModel = useCallback(
    async (modelId: string) => {
      if (!session) return
      setError(null)
      try {
        await session.setActiveModel?.(modelId)
        setActiveModelId(session.getActiveModelId?.() ?? modelId)
        setProviderType(session.getProviderType())
      } catch (e) {
        setError(e as Error)
      }
    },
    [session],
  )

  const stop = useCallback(() => {
    console.log('[useAiChat] stop called', { hasSession: !!session })
    if (session) {
      session.stopRunningStream()
    }
  }, [session])

  const stopAndTruncate = useCallback(
    (messageId: string, length: number) => {
      console.log('[useAiChat] stopAndTruncate called', { messageId, length, hasSession: !!session })
      if (session) {
        session.stopAndTruncate(messageId, length)
      }
    },
    [session],
  )

  const resetError = useCallback(() => {
    setError(null)
  }, [])

  return {
    loading: isGenerating, // Rename derived state to loading for UI compatibility
    state,
    systemPromptInfo,
    providerType,
    error,
    send,
    stop,
    stopAndTruncate,
    changeRole,
    changeModel,
    resetError,
    availableModels: rawModels,
    activeModelId,
  }
}
