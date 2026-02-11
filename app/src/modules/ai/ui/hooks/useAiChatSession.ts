import { useCallback, useEffect, useState } from 'react'
import type { ChatEntryMode, ConversationState, EntryContext } from '../../domain/chatSession'
import type { SystemPromptInfo } from '../../application/systemPromptService'
import type { ProviderType, VisionMode, VisionTask, UploadedFileRef } from '../../domain/types'
import type { UseAiChatResult } from './useAiChat'
import type { AiChatSessionKey } from '../../application/aiChatSessionService'
import type { ChatSession } from '../../application/chatSessionService'
import { useAiChatSessionService } from '../AiChatProvider'

export type UseAiChatSessionOptions = {
  sessionKey: AiChatSessionKey
  entryMode: ChatEntryMode
  initialContext?: EntryContext
  open: boolean
}

export function useAiChatSession(options: UseAiChatSessionOptions): UseAiChatResult {
  const { sessionKey, entryMode, initialContext, open } = options
  const sessionService = useAiChatSessionService()

  const [session, setSession] = useState<ChatSession | null>(null)
  const [loading, setLoading] = useState(false)
  const [state, setState] = useState<ConversationState | null>(null)
  const [systemPromptInfo, setSystemPromptInfo] = useState<SystemPromptInfo | null>(null)
  const [providerType, setProviderType] = useState<ProviderType | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [activeModelId, setActiveModelId] = useState<string | null>(null)
  const [rawModels, setRawModels] = useState<{ id: string; providerName: string; visionMode?: VisionMode }[]>([])
  const [pendingAttachments, setPendingAttachments] = useState<UploadedFileRef[]>([])
  const [uploadingCount, setUploadingCount] = useState(0)

  useEffect(() => {
    if (!open) return

    let cancelled = false
    let unsubscribe: (() => void) | null = null
    setLoading(true)
    setError(null)

    const startSession = async () => {
      try {
        const record = await sessionService.getOrCreateSession(sessionKey, {
          entryMode,
          initialContext,
        })
        if (cancelled) return

        setSession(record.session)
        setState(record.state)
        setSystemPromptInfo(record.session.getSystemPromptInfo())
        setProviderType(record.session.getProviderType())
        setActiveModelId(record.session.getActiveModelId())

        unsubscribe = sessionService.subscribe(sessionKey, (nextState) => {
          if (cancelled) return
          setState(nextState)
        })
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
      if (unsubscribe) unsubscribe()
    }
  }, [open, sessionKey, entryMode, initialContext, sessionService])

  // Load available models
  useEffect(() => {
    if (!open) return
    const loadModels = async () => {
      const { loadAiSettingsState } = await import('../../config/aiSettingsRepo')
      const settings = await loadAiSettingsState()
      const models = settings.providers.flatMap((p) =>
        p.models.map((m) => {
          const effectiveVisionMode: VisionMode | undefined = m.visionMode ?? p.visionMode
          return {
            id: m.id,
            providerName: p.name,
            visionMode: effectiveVisionMode,
          }
        }),
      )
      setRawModels(models)
    }
    void loadModels()
  }, [open])

  const isGenerating = !!state?.viewMessages.some((m) => m.streaming) || loading

  const send = useCallback<UseAiChatResult['send']>(
    async (content, options) => {
      if (!session) return
      setError(null)
      setLoading(true)
      try {
        await session.sendUserMessage(content, {
          hideInView: options?.hideUserInView,
          attachments: pendingAttachments.length > 0 ? pendingAttachments : undefined,
        })
        setPendingAttachments([])
      } finally {
        setLoading(false)
        setState(session.getState())
        setSystemPromptInfo(session.getSystemPromptInfo())
      }
    },
    [session, pendingAttachments],
  )

  const uploadFiles = useCallback<UseAiChatResult['uploadFiles']>(
    async (files) => {
      if (!session) {
        console.warn('[useAiChatSession] uploadFiles ignored: no session')
        return
      }
      console.warn('[useAiChatSession] uploadFiles starting for:', files.map((f) => f.name))
      setUploadingCount((prev) => prev + files.length)
      try {
        const results = await Promise.all(files.map((file) => session.uploadAttachment(file)))
        console.warn('[useAiChatSession] uploadFiles success:', results)
        setPendingAttachments((prev) => [...prev, ...results])
      } catch (e) {
        console.warn('[useAiChatSession] uploadFiles error:', e)
        setError(e as Error)
      } finally {
        setUploadingCount((prev) => Math.max(0, prev - files.length))
      }
    },
    [session],
  )

  const removeAttachment = useCallback<UseAiChatResult['removeAttachment']>((id) => {
    console.warn('[useAiChatSession] removeAttachment:', id)
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id))
  }, [])

  const sendVisionTask = useCallback<UseAiChatResult['sendVisionTask']>(
    async (task, options) => {
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

  const changeRole = useCallback<UseAiChatResult['changeRole']>(
    async (roleId) => {
      if (!session) return
      setError(null)
      await session.setActiveRole(roleId)
      setSystemPromptInfo(session.getSystemPromptInfo())
    },
    [session],
  )

  const changeModel = useCallback<UseAiChatResult['changeModel']>(
    async (modelId) => {
      if (!session) return
      setError(null)
      try {
        console.warn('[useAiChatSession] changing model to:', modelId)
        await session.setActiveModel?.(modelId)

        const nextProviderType = session.getProviderType()
        console.warn('[useAiChatSession] model change complete. nextProviderType:', nextProviderType)

        setActiveModelId(session.getActiveModelId?.() ?? modelId)
        setProviderType(nextProviderType)
      } catch (e) {
        console.error('[useAiChatSession] changeModel error:', e)
        setError(e as Error)
      }
    },
    [session],
  )

  const DEFAULT_VISION_PROMPT = '解析图片并根据上下文回复图片中内容的含义'

  const sendMessage = useCallback<UseAiChatResult['sendMessage']>(
    async (input, options) => {
      if (!session) return
      setError(null)

      const raw = input
      const trimmed = raw.trim()
      const isDify = providerType === 'dify'
      const hasAttachments = isDify ? pendingAttachments.length > 0 : !!options?.attachedImageDataUrl

      if (!trimmed && !options?.contextPrefix && !hasAttachments) return

      const basePrompt = trimmed || (hasAttachments ? DEFAULT_VISION_PROMPT : '')

      let finalContent = basePrompt
      let hideUserInView = false

      if (options?.contextPrefix && !options?.contextPrefixUsed) {
        finalContent = basePrompt ? `${options.contextPrefix}\n\n${basePrompt}` : options.contextPrefix
        options.onContextUsed?.()
        hideUserInView = true
      }

      setLoading(true)
      try {
        if (options?.attachedImageDataUrl && !isDify) {
          const visionTask: VisionTask = {
            prompt: finalContent,
            images: [{ kind: 'data_url', dataUrl: options.attachedImageDataUrl }],
          }
          await session.sendVisionTask(visionTask, { hideInView: hideUserInView })
          options.onClearAttachedImage?.()
        } else {
          await session.sendUserMessage(finalContent, {
            hideInView: hideUserInView,
            attachments: pendingAttachments.length > 0 ? pendingAttachments : undefined,
          })
          setPendingAttachments([])
        }
      } catch (e) {
        const err = e as Error
        if (err.name !== 'AbortError') {
          console.error('[useAiChatSession] sendMessage error:', e)
          setError(err)
        }
      } finally {
        setLoading(false)
        setState(session.getState())
        setSystemPromptInfo(session.getSystemPromptInfo())
      }
    },
    [session, providerType, pendingAttachments],
  )

  const stop = useCallback<UseAiChatResult['stop']>(() => {
    console.log('[useAiChatSession] stop called', { hasSession: !!session })
    if (session) {
      session.stopRunningStream()
    }
  }, [session])

  const stopAndTruncate = useCallback<UseAiChatResult['stopAndTruncate']>(
    (messageId, length) => {
      console.log('[useAiChatSession] stopAndTruncate called', { messageId, length, hasSession: !!session })
      if (session) {
        session.stopAndTruncate(messageId, length)
      }
    },
    [session],
  )

  const resetError = useCallback<UseAiChatResult['resetError']>(() => {
    setError(null)
  }, [])

  return {
    loading: isGenerating,
    state,
    systemPromptInfo,
    providerType,
    error,
    send,
    sendMessage,
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
