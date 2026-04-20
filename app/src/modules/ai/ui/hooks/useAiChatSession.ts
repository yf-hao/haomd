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
import { ensureSessionAutoTitle } from '../../application/sessionAutoTitleService'
import type { DocConversationRecord } from '../../domain/docConversations'
import { appendAiInputHistory } from '../../application/localStorageAiChatInputHistory'
import { loadSession, saveSession, type AiChatSessionCfg, type AiChatMessageCfg } from '../../config/aiSessionsRepo'
import { mergePendingAttachments } from './attachmentDrafts'

export type UseAiChatSessionOptions = {
  sessionKey: AiChatSessionKey
  entryMode: ChatEntryMode
  initialContext?: EntryContext
  open: boolean
  selectedAgentId?: string | null
  /** 当前会话关联的文档路径（目录级 key），用于文档级会话历史持久化与恢复 */
  docPath?: string
  /** 旧版文档级会话使用的原始 docPath（文件路径），用于懒迁移 */
  legacyDocPath?: string
}

function buildRestoredViewMessages(record: DocConversationRecord): ChatMessageView[] {
  const originalMessages: ChatMessageView[] = []
  const preservedMessages: ChatMessageView[] = []

  for (const message of record.messages) {
    if (message.role === 'user' || message.role === 'assistant') {
      originalMessages.push({
        id: message.id,
        role: message.role as ChatRole,
        content: message.content,
        source: 'original',
      })
      continue
    }

    const preservedUserInputs = message.meta?.preservedUserInputs ?? []
    preservedUserInputs.forEach((content, index) => {
      const trimmed = content.trim()
      if (!trimmed) return
      preservedMessages.push({
        id: `${message.id}:preserved-user:${index}`,
        role: 'user',
        content: trimmed,
        source: 'summary-preserved',
      })
    })
  }

  return originalMessages.length > 0 ? originalMessages : preservedMessages
}

function buildStateFromDocRecord(record: DocConversationRecord, entryMode: ChatEntryMode): ConversationState {
  const engineHistory: EngineMessage[] = record.messages.map((m): EngineMessage => ({
    role: m.role,
    content: m.content,
  }))

  const viewMessages = buildRestoredViewMessages(record)

  return {
    engineHistory,
    viewMessages,
    entryMode,
  }
}

function isPersistedSessionKey(sessionKey: AiChatSessionKey): boolean {
  return sessionKey.startsWith('session:')
}

function isPersistedEngineRole(role: string): role is EngineMessage['role'] {
  return role === 'system' || role === 'user' || role === 'assistant'
}

function buildStateFromAiSessionRecord(record: AiChatSessionCfg, entryMode: ChatEntryMode): ConversationState {
  const engineHistory: EngineMessage[] = record.messages
    .filter((m): m is AiChatMessageCfg & { role: EngineMessage['role'] } => isPersistedEngineRole(m.role))
    .map((m) => ({
      role: m.role,
      content: m.content,
    }))

  const viewMessages: ChatMessageView[] = record.messages
    .filter((m): m is AiChatMessageCfg & { role: 'user' | 'assistant' } => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      source: 'original',
    }))

  return {
    engineHistory,
    viewMessages,
    entryMode: (record.entryMode as ChatEntryMode | null | undefined) ?? entryMode,
    activeRoleId: record.activeRoleId ?? undefined,
  }
}

export function useAiChatSession(options: UseAiChatSessionOptions): UseAiChatResult {
  const { sessionKey, entryMode, initialContext, open, selectedAgentId, docPath, legacyDocPath } = options
  const shouldUseDocPersistence = !selectedAgentId

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
        let initialDifyMapping: Record<string, string> | undefined

        if (isPersistedSessionKey(sessionKey)) {
          const savedSession = await loadSession(sessionKey)
          if (savedSession) {
            initialState = buildStateFromAiSessionRecord(savedSession, entryMode)
          }
        } else if (docPath && shouldUseDocPersistence) {
          let saved: DocConversationRecord | null = await docConversationService.getByDocPath(docPath)

          // 懒迁移：如果目录级 docPath 下没有记录，且提供了旧版文件级 docPath，则尝试回退加载
          if (!saved && legacyDocPath && legacyDocPath !== docPath) {
            try {
              saved = await docConversationService.getByDocPath(legacyDocPath)
            } catch (e) {
              console.warn('[useAiChatSession] failed to load legacy doc conversation', e)
            }
          }

          if (saved) {
            initialState = buildStateFromDocRecord(saved, entryMode)
            initialDifyConversationId = saved.difyConversationId
            initialDifyMapping = saved.difyProviderConversations
          }
        }

        const startOptions: StartChatOptions = {
          entryMode,
          initialContext,
          selectedAgentId,
          ...(initialState ? { initialState } : {}),
          ...(docPath && shouldUseDocPersistence ? { docPath } : {}),
          ...(initialDifyConversationId ? { initialDifyConversationId } : {}),
          ...(initialDifyMapping ? { initialDifyProviderConversations: initialDifyMapping } : {}),
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
  }, [open, sessionKey, entryMode, initialContext, selectedAgentId, docPath, legacyDocPath, reloadToken, shouldUseDocPersistence])

  useEffect(() => {
    if (!open || !isPersistedSessionKey(sessionKey) || !state) return
    if (state.viewMessages.some((message) => message.streaming)) return

    const timeout = window.setTimeout(() => {
      const now = Date.now()
      void (async () => {
        const existing = await loadSession(sessionKey)
        const previousMessages = existing?.messages ?? []

        const messages: AiChatMessageCfg[] = state.engineHistory.map((message, index) => {
          const previous = previousMessages[index]
          const reuseIdentity = previous && previous.role === message.role
          return {
            id: reuseIdentity ? previous.id : `${sessionKey}:${message.role}:${now + index}`,
            role: message.role,
            content: message.content,
            timestamp: reuseIdentity ? previous.timestamp : now + index,
          }
        })

        const sessionRecord: AiChatSessionCfg = {
          id: sessionKey,
          title: existing?.title ?? null,
          entryMode,
          messages,
          providerType,
          activeRoleId: state.activeRoleId ?? existing?.activeRoleId ?? null,
          autoTitleStatus: existing?.autoTitleStatus ?? null,
          autoTitleAttemptCount: existing?.autoTitleAttemptCount ?? null,
          autoTitleLastAttemptAt: existing?.autoTitleLastAttemptAt ?? null,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        }

        await saveSession(sessionRecord)
        await ensureSessionAutoTitle({
          sessionKey,
          state,
          entryMode,
          providerContext: session?.getProviderContext() ?? null,
        })
      })().catch((err) => {
        console.warn('[useAiChatSession] failed to persist session history', err)
      })
    }, 150)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [open, sessionKey, entryMode, state, providerType, session])

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
      const attachmentsToSend = pendingAttachments
      if (attachmentsToSend.length > 0) {
        setPendingAttachments([])
      }
      try {
        await session.sendUserMessage(content, {
          hideInView: options?.hideUserInView,
          attachments: attachmentsToSend.length > 0 ? attachmentsToSend : undefined,
        })
      } catch (error) {
        const err = error as Error
        if (err.name !== 'AbortError' && attachmentsToSend.length > 0) {
          setPendingAttachments((current) => mergePendingAttachments(attachmentsToSend, current))
        }
        throw error
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

  const DEFAULT_VISION_PROMPT = '请详细识别并描述这张图片中的内容。如果图片中包含文字、公式、表格、题目或文档，请先完整提取关键信息，再直接回答。若图片信息不足，请明确说明。'

  const sendMessage = useCallback<UseAiChatResult['sendMessage']>(
    async (input, options) => {
      if (!session) return
      setError(null)

      const raw = input
      const trimmed = raw.trim()
      const isDify = providerType === 'dify'
      const attachmentsToSend = isDify ? pendingAttachments : []
      const attachedImageToSend = !isDify ? options?.attachedImageDataUrl ?? null : null
      const hasAttachments = isDify ? attachmentsToSend.length > 0 : !!attachedImageToSend

      if (!trimmed && !options?.contextPrefix && !hasAttachments) return

      const directoryKey = docPath ?? '/'
      if (trimmed) {
        appendAiInputHistory(directoryKey, trimmed)
      }

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
      if (attachmentsToSend.length > 0) {
        setPendingAttachments([])
      }
      if (attachedImageToSend) {
        options?.onClearAttachedImage?.()
      }
      try {
        if (attachedImageToSend && !isDify) {
          const visionTask: VisionTask = {
            prompt: finalContent,
            images: [{ kind: 'data_url', dataUrl: attachedImageToSend }],
          }
          await session.sendVisionTask(visionTask, { hideInView: hideUserInView })
        } else {
          await session.sendUserMessage(finalContent, {
            hideInView: hideUserInView,
            attachments: attachmentsToSend.length > 0 ? attachmentsToSend : undefined,
            // 只在 UI 中展示用户真实输入的问题部分，
            // selection/file 上下文只进入 engineHistory，不出现在气泡里。
            viewContent: basePrompt,
          })
        }
      } catch (e) {
        const err = e as Error
        if (err.name !== 'AbortError') {
          if (attachmentsToSend.length > 0) {
            setPendingAttachments((current) => mergePendingAttachments(attachmentsToSend, current))
          }
          if (attachedImageToSend) {
            options?.onRestoreAttachedImage?.(attachedImageToSend)
          }
          console.error('[useAiChatSession] sendMessage error:', e)
          setError(err)
        }
      } finally {
        setLoading(false)
        setState(session.getState())
        setSystemPromptInfo(session.getSystemPromptInfo())
      }
    },
    [session, providerType, pendingAttachments, docPath],
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
