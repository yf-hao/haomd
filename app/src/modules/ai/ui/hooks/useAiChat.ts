import { useCallback, useEffect, useState } from 'react'
import type { ChatEntryMode, ConversationState, EntryContext } from '../../domain/chatSession'
import type { SystemPromptInfo } from '../../application/systemPromptService'
import type { ProviderType, VisionTask, UploadedFileRef } from '../../domain/types'
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
  sendVisionTask: (task: VisionTask, options?: { hideUserInView?: boolean }) => Promise<void>
  stop: () => void
  stopAndTruncate: (messageId: string, length: number) => void
  changeRole: (roleId: string) => Promise<void>
  changeModel: (modelId: string) => Promise<void>
  resetError: () => void
  availableModels: { id: string; providerName: string }[]
  activeModelId: string | null
  pendingAttachments: UploadedFileRef[]
  uploadFiles: (files: File[]) => Promise<void>
  removeAttachment: (id: string) => void
  isUploading: boolean
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
  const [pendingAttachments, setPendingAttachments] = useState<UploadedFileRef[]>([])
  const [uploadingCount, setUploadingCount] = useState(0)

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
        await session.sendUserMessage(content, {
          hideInView: options?.hideUserInView,
          attachments: pendingAttachments.length > 0 ? pendingAttachments : undefined
        })
        setPendingAttachments([]) // Clear after sending
      } finally {
        setLoading(false)
        setState(session.getState())
        setSystemPromptInfo(session.getSystemPromptInfo())
      }
    },
    [session, pendingAttachments],
  )

  const uploadFiles = useCallback(async (files: File[]) => {
    if (!session) {
      console.warn('[useAiChat] uploadFiles ignored: no session')
      return
    }
    console.warn('[useAiChat] uploadFiles starting for:', files.map(f => f.name))
    setUploadingCount(prev => prev + files.length)
    try {
      const results = await Promise.all(
        files.map(file => session.uploadAttachment(file))
      )
      console.warn('[useAiChat] uploadFiles success:', results)
      setPendingAttachments(prev => [...prev, ...results])
    } catch (e) {
      console.warn('[useAiChat] uploadFiles error:', e)
      setError(e as Error)
    } finally {
      setUploadingCount(prev => Math.max(0, prev - files.length))
    }
  }, [session])

  const removeAttachment = useCallback((id: string) => {
    console.warn('[useAiChat] removeAttachment:', id)
    setPendingAttachments(prev => prev.filter(a => a.id !== id))
  }, [])

  const sendVisionTask = useCallback(
    async (task: VisionTask, options?: { hideUserInView?: boolean }) => {
      if (!session) return
      setError(null)
      setLoading(true)
      try {
        await session.sendVisionTask(task, { hideInView: options?.hideUserInView })
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
        console.warn('[useAiChat] changing model to:', modelId)
        await session.setActiveModel?.(modelId)

        // 关键点：切换后立即重新获取 providerType 并更新 UI 状态
        const nextProviderType = session.getProviderType()
        console.warn('[useAiChat] model change complete. nextProviderType:', nextProviderType)

        setActiveModelId(session.getActiveModelId?.() ?? modelId)
        setProviderType(nextProviderType)
      } catch (e) {
        console.error('[useAiChat] changeModel error:', e)
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
    sendVisionTask,
    stop,
    stopAndTruncate,
    changeRole,
    changeModel,
    resetError,
    availableModels: rawModels,
    activeModelId,
    pendingAttachments,
    uploadFiles,
    removeAttachment,
    isUploading: uploadingCount > 0,
  }
}
