import { useCallback, useEffect, useState } from 'react'
import type {
  ChatEntryMode,
  ConversationState,
  EntryContext,
  ChatMessageView,
  EngineMessage,
  ChatRole,
} from '../../domain/chatSession'
import type { SystemPromptInfo } from '../../application/systemPromptService'
import type { ProviderType, VisionMode, VisionTask, UploadedFileRef } from '../../domain/types'
import type { UseAiChatResult } from './useAiChat'
import type { AiChatSessionKey } from '../../application/aiChatSessionService'
import type { ChatSession, StartChatOptions } from '../../application/chatSessionService'
import { createChatSession } from '../../application/chatSessionService'
import { docConversationService, subscribeDocConversationEvents, type DocConversationEvent } from '../../application/docConversationService'
import type { DocConversationRecord } from '../../domain/docConversations'

export type UseAiChatSessionOptions = {
  sessionKey: AiChatSessionKey
  entryMode: ChatEntryMode
  initialContext?: EntryContext
  open: boolean
  /** 当前会话关联的文档路径，用于文档级会话历史持久化与恢复 */
  docPath?: string
}

function buildStateFromDocRecord(record: DocConversationRecord, entryMode: ChatEntryMode): ConversationState {
  const engineHistory: EngineMessage[] = record.messages.map((m): EngineMessage => ({
    role: m.role,
    content: m.content,
  }))

  const viewMessages: ChatMessageView[] = record.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m): ChatMessageView => ({
      id: m.id,
      role: m.role as ChatRole,
      content: m.content,
    }))

  return {
    engineHistory,
    viewMessages,
    entryMode,
  }
}

export function useAiChatSession(options: UseAiChatSessionOptions): UseAiChatResult {
  const { entryMode, initialContext, open, docPath } = options

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
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!docPath) return

    const unsubscribe = subscribeDocConversationEvents((event: DocConversationEvent) => {
      if (event.docPath !== docPath) return

      if (event.type === 'cleared') {
        // 清空当前 UI 并触发一次会话重建
        setState(null)
        setPendingAttachments([])
        setReloadToken((prev) => prev + 1)
        return
      }

      if (event.type === 'compressed') {
        // 文档会话已被压缩：重建当前会话，以便 UI 与最新摘要后的历史保持一致
        setState(null)
        setReloadToken((prev) => prev + 1)
      }
    })

    return () => {
      unsubscribe()
    }
  }, [docPath])

  useEffect(() => {
    if (!open) return

    let cancelled = false
    setLoading(true)
    setError(null)

    const startSession = async () => {
      try {
        let initialState: ConversationState | undefined
        let initialDifyConversationId: string | undefined

        if (docPath) {
          const saved: DocConversationRecord | null = await docConversationService.getByDocPath(docPath)
          if (saved) {
            initialState = buildStateFromDocRecord(saved, entryMode)
            if (saved.difyConversationId) {
              initialDifyConversationId = saved.difyConversationId
            }
          }
        }

        const startOptions: StartChatOptions = {
          entryMode,
          initialContext,
          ...(initialState ? { initialState } : {}),
          ...(docPath ? { docPath } : {}),
          ...(initialDifyConversationId ? { initialDifyConversationId } : {}),
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
  }, [open, entryMode, initialContext, docPath, reloadToken])

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
        // 有真实输入时在 UI 保留这条“提问”消息；
        // 仅在“纯上下文（只发选区/文件，不输入问题）”时隐藏 user 气泡。
        hideUserInView = !basePrompt
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
            // 只在 UI 中展示用户真实输入的问题部分，
            // selection/file 上下文只进入 engineHistory，不出现在气泡里。
            viewContent: basePrompt,
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

  const getRecentMessagesForDigest = useCallback<UseAiChatResult['getRecentMessagesForDigest']>(
    (limit: number) => {
      const messages = state?.viewMessages ?? []
      const visible = messages.filter((m) => !m.hidden)
      if (limit <= 0 || visible.length <= limit) return visible
      return visible.slice(-limit)
    },
    [state],
  )

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
    getRecentMessagesForDigest,
  }
}
