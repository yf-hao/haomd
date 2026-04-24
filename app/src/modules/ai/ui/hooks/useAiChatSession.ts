import { useCallback, useEffect, useRef, useState } from 'react'
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
import { normalizePersistableDocPath } from '../../domain/docPathUtils'
import { appendAiInputHistory } from '../../application/localStorageAiChatInputHistory'
import { loadSession, saveSession, type AiChatSessionCfg, type AiChatMessageCfg } from '../../config/aiSessionsRepo'
import { mergePendingAttachments } from './attachmentDrafts'
import type { WorkspaceEntryKind } from '../../../workspace/workspaceEntryResolver'

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
  getCurrentMarkdown?: () => string
  getCurrentFileName?: () => string | null
  getCurrentFilePath?: () => string | null
  getCurrentFolderPath?: () => string | null
  getCurrentWorkspaceRoot?: () => string | null
  onDocumentSaved?: (path: string) => void
  onRequestDeleteCurrentDocument?: (path: string) => Promise<{ ok: boolean; message: string }>
  onRequestDeleteCurrentFolder?: (path: string) => Promise<{ ok: boolean; message: string }>
  onRequestDeleteWorkspaceEntry?: (
    targetPath: string,
    targetKind?: WorkspaceEntryKind,
  ) => Promise<{ ok: boolean; message: string }>
  onRenameCurrentDocument?: (fileName: string) => Promise<{ ok: boolean; message: string }>
  onRenameWorkspaceEntry?: (
    targetPath: string,
    newName: string,
    targetKind?: WorkspaceEntryKind,
  ) => Promise<{ ok: boolean; message: string }>
  onCreateDirectoryUnderSelection?: (directoryName: string) => Promise<{ ok: boolean; message: string }>
  onCreateDirectoryInWorkspace?: (
    parentPath: string,
    directoryName: string,
  ) => Promise<{ ok: boolean; message: string }>
  setStatusMessage?: (message: string) => void
  t?: (key: string, params?: Record<string, string | number>) => string
  restartToken?: number
}

const DOC_PATH_MIGRATION_DELAY_MS = 800

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
  const {
    sessionKey,
    entryMode,
    initialContext,
    open,
    selectedAgentId,
    docPath,
    legacyDocPath,
    getCurrentMarkdown,
    getCurrentFileName,
    getCurrentFilePath,
    getCurrentFolderPath,
    getCurrentWorkspaceRoot,
    onDocumentSaved,
    onRequestDeleteCurrentDocument,
    onRequestDeleteCurrentFolder,
    onRequestDeleteWorkspaceEntry,
    onRenameCurrentDocument,
    onRenameWorkspaceEntry,
    onCreateDirectoryUnderSelection,
    onCreateDirectoryInWorkspace,
    setStatusMessage,
    t,
    restartToken = 0,
  } = options
  const sanitizedLegacyDocPath = normalizePersistableDocPath(legacyDocPath)
  const sanitizedDocPath =
    legacyDocPath && !sanitizedLegacyDocPath
      ? undefined
      : normalizePersistableDocPath(docPath)
  const shouldUseDocPersistence = !selectedAgentId

  const [session, setSession] = useState<ChatSession | null>(null)
  const [loading, setLoading] = useState(false)
  const [starting, setStarting] = useState(false)
  const [state, setState] = useState<ConversationState | null>(null)
  const [systemPromptInfo, setSystemPromptInfo] = useState<SystemPromptInfo | null>(null)
  const [providerType, setProviderType] = useState<ProviderType | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [activeModelId, setActiveModelId] = useState<string | null>(null)
  const [rawModels, setRawModels] = useState<{ id: string; providerName: string; visionMode?: VisionMode }[]>([])
  const [pendingAttachments, setPendingAttachments] = useState<UploadedFileRef[]>([])
  const [uploadingCount, setUploadingCount] = useState(0)
  const [reloadToken, setReloadToken] = useState(0)
  const getCurrentMarkdownRef = useRef(getCurrentMarkdown)
  const getCurrentFileNameRef = useRef(getCurrentFileName)
  const getCurrentFilePathRef = useRef(getCurrentFilePath)
  const getCurrentFolderPathRef = useRef(getCurrentFolderPath)
  const getCurrentWorkspaceRootRef = useRef(getCurrentWorkspaceRoot)
  const onDocumentSavedRef = useRef(onDocumentSaved)
  const onRequestDeleteCurrentDocumentRef = useRef(onRequestDeleteCurrentDocument)
  const onRequestDeleteCurrentFolderRef = useRef(onRequestDeleteCurrentFolder)
  const onRequestDeleteWorkspaceEntryRef = useRef(onRequestDeleteWorkspaceEntry)
  const onRenameCurrentDocumentRef = useRef(onRenameCurrentDocument)
  const onRenameWorkspaceEntryRef = useRef(onRenameWorkspaceEntry)
  const onCreateDirectoryUnderSelectionRef = useRef(onCreateDirectoryUnderSelection)
  const onCreateDirectoryInWorkspaceRef = useRef(onCreateDirectoryInWorkspace)
  const setStatusMessageRef = useRef(setStatusMessage)
  const tRef = useRef(t)
  const pendingDocPathRef = useRef<string | undefined>(undefined)
  const lastBoundDocPathRef = useRef<string | undefined>(undefined)
  const migrationTimerRef = useRef<number | null>(null)

  useEffect(() => {
    getCurrentMarkdownRef.current = getCurrentMarkdown
  }, [getCurrentMarkdown])

  useEffect(() => {
    getCurrentFileNameRef.current = getCurrentFileName
  }, [getCurrentFileName])

  useEffect(() => {
    getCurrentFilePathRef.current = getCurrentFilePath
  }, [getCurrentFilePath])

  useEffect(() => {
    getCurrentFolderPathRef.current = getCurrentFolderPath
  }, [getCurrentFolderPath])

  useEffect(() => {
    getCurrentWorkspaceRootRef.current = getCurrentWorkspaceRoot
  }, [getCurrentWorkspaceRoot])

  useEffect(() => {
    onDocumentSavedRef.current = onDocumentSaved
  }, [onDocumentSaved])

  useEffect(() => {
    onRequestDeleteCurrentDocumentRef.current = onRequestDeleteCurrentDocument
  }, [onRequestDeleteCurrentDocument])

  useEffect(() => {
    onRequestDeleteCurrentFolderRef.current = onRequestDeleteCurrentFolder
  }, [onRequestDeleteCurrentFolder])

  useEffect(() => {
    onRequestDeleteWorkspaceEntryRef.current = onRequestDeleteWorkspaceEntry
  }, [onRequestDeleteWorkspaceEntry])

  useEffect(() => {
    onRenameCurrentDocumentRef.current = onRenameCurrentDocument
  }, [onRenameCurrentDocument])

  useEffect(() => {
    onRenameWorkspaceEntryRef.current = onRenameWorkspaceEntry
  }, [onRenameWorkspaceEntry])

  useEffect(() => {
    onCreateDirectoryUnderSelectionRef.current = onCreateDirectoryUnderSelection
  }, [onCreateDirectoryUnderSelection])

  useEffect(() => {
    onCreateDirectoryInWorkspaceRef.current = onCreateDirectoryInWorkspace
  }, [onCreateDirectoryInWorkspace])

  useEffect(() => {
    setStatusMessageRef.current = setStatusMessage
  }, [setStatusMessage])

  useEffect(() => {
    tRef.current = t
  }, [t])

  useEffect(() => {
    if (!sanitizedDocPath) return

    const unsubscribe = subscribeDocConversationEvents((event: DocConversationEvent) => {
      if (event.docPath !== sanitizedDocPath) return

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
  }, [sanitizedDocPath])

  useEffect(() => {
    if (!open) return

    let cancelled = false
    setStarting(true)
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
        } else if (sanitizedDocPath && shouldUseDocPersistence) {
          let saved: DocConversationRecord | null = await docConversationService.getByDocPath(sanitizedDocPath)

          // 懒迁移：如果目录级 docPath 下没有记录，且提供了旧版文件级 docPath，则尝试回退加载
          if (!saved && sanitizedLegacyDocPath && sanitizedLegacyDocPath !== sanitizedDocPath) {
            try {
              saved = await docConversationService.getByDocPath(sanitizedLegacyDocPath)
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
          ...(sanitizedDocPath && shouldUseDocPersistence ? { docPath: sanitizedDocPath } : {}),
          ...(initialDifyConversationId ? { initialDifyConversationId } : {}),
          ...(initialDifyMapping ? { initialDifyProviderConversations: initialDifyMapping } : {}),
          ...(getCurrentMarkdownRef.current
            ? {
                getCurrentMarkdown: () => getCurrentMarkdownRef.current?.() ?? '',
              }
            : {}),
          ...(getCurrentFileNameRef.current
            ? {
                getCurrentFileName: () => getCurrentFileNameRef.current?.() ?? null,
              }
            : {}),
          ...(getCurrentFilePathRef.current
            ? {
                getCurrentFilePath: () => getCurrentFilePathRef.current?.() ?? null,
              }
            : {}),
          ...(getCurrentFolderPathRef.current
            ? {
                getCurrentFolderPath: () => getCurrentFolderPathRef.current?.() ?? null,
              }
            : {}),
          ...(getCurrentWorkspaceRootRef.current
            ? {
                getCurrentWorkspaceRoot: () => getCurrentWorkspaceRootRef.current?.() ?? null,
              }
            : {}),
          ...(onDocumentSavedRef.current
            ? {
                onDocumentSaved: (path: string) => onDocumentSavedRef.current?.(path),
              }
            : {}),
          ...(onRequestDeleteCurrentDocumentRef.current
            ? {
                onRequestDeleteCurrentDocument: (path: string) =>
                  onRequestDeleteCurrentDocumentRef.current?.(path) ??
                  Promise.resolve({ ok: false, message: '删除确认能力不可用。' }),
              }
            : {}),
          ...(onRequestDeleteCurrentFolderRef.current
            ? {
                onRequestDeleteCurrentFolder: (path: string) =>
                  onRequestDeleteCurrentFolderRef.current?.(path) ??
                  Promise.resolve({ ok: false, message: '文件夹删除能力不可用。' }),
              }
            : {}),
          ...(onRequestDeleteWorkspaceEntryRef.current
            ? {
                onRequestDeleteWorkspaceEntry: (
                  targetPath: string,
                  targetKind?: WorkspaceEntryKind,
                ) =>
                  onRequestDeleteWorkspaceEntryRef.current?.(targetPath, targetKind) ??
                  Promise.resolve({ ok: false, message: '工作区目标删除能力不可用。' }),
              }
            : {}),
          ...(onRenameCurrentDocumentRef.current
            ? {
                onRenameCurrentDocument: (fileName: string) =>
                  onRenameCurrentDocumentRef.current?.(fileName) ??
                  Promise.resolve({ ok: false, message: '当前重命名能力不可用。' }),
              }
            : {}),
          ...(onRenameWorkspaceEntryRef.current
            ? {
                onRenameWorkspaceEntry: (
                  targetPath: string,
                  newName: string,
                  targetKind?: WorkspaceEntryKind,
                ) =>
                  onRenameWorkspaceEntryRef.current?.(targetPath, newName, targetKind) ??
                  Promise.resolve({ ok: false, message: '工作区重命名能力不可用。' }),
              }
            : {}),
          ...(onCreateDirectoryUnderSelectionRef.current
            ? {
                onCreateDirectoryUnderSelection: (directoryName: string) =>
                  onCreateDirectoryUnderSelectionRef.current?.(directoryName) ??
                  Promise.resolve({ ok: false, message: '当前创建目录能力不可用。' }),
              }
            : {}),
          ...(onCreateDirectoryInWorkspaceRef.current
            ? {
                onCreateDirectoryInWorkspace: (
                  parentPath: string,
                  directoryName: string,
                ) =>
                  onCreateDirectoryInWorkspaceRef.current?.(parentPath, directoryName) ??
                  Promise.resolve({ ok: false, message: '工作区创建目录能力不可用。' }),
              }
            : {}),
          ...(setStatusMessageRef.current
            ? {
                setStatusMessage: (message: string) => setStatusMessageRef.current?.(message),
              }
            : {}),
          ...(tRef.current
            ? {
                t: (key: string, params?: Record<string, string | number>) =>
                  tRef.current?.(key, params) ?? key,
              }
            : {}),
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

        pendingDocPathRef.current = undefined
        lastBoundDocPathRef.current = sanitizedDocPath
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
          setStarting(false)
        }
      }
    }

    void startSession()

    return () => {
      cancelled = true
      pendingDocPathRef.current = undefined
      lastBoundDocPathRef.current = undefined
      if (migrationTimerRef.current != null) {
        window.clearTimeout(migrationTimerRef.current)
        migrationTimerRef.current = null
      }
      setSession((prev) => {
        if (prev) {
          prev.dispose()
        }
        return null
      })
    }
  }, [
    open,
    sessionKey,
    entryMode,
    initialContext,
    selectedAgentId,
    reloadToken,
    restartToken,
    shouldUseDocPersistence,
  ])

  useEffect(() => {
    if (!session || !open || !shouldUseDocPersistence) return
    if (!sanitizedDocPath) return
    if (sanitizedDocPath === lastBoundDocPathRef.current) return
    pendingDocPathRef.current = sanitizedDocPath
  }, [session, open, sanitizedDocPath, shouldUseDocPersistence])

  useEffect(() => {
    if (!session || !open || !shouldUseDocPersistence) return
    const pendingDocPath = pendingDocPathRef.current
    if (!pendingDocPath) return
    if (pendingDocPath === lastBoundDocPathRef.current) {
      pendingDocPathRef.current = undefined
      return
    }
    if (loading || starting || state?.viewMessages.some((message) => message.streaming)) {
      if (migrationTimerRef.current != null) {
        window.clearTimeout(migrationTimerRef.current)
        migrationTimerRef.current = null
      }
      return
    }

    if (migrationTimerRef.current != null) {
      window.clearTimeout(migrationTimerRef.current)
      migrationTimerRef.current = null
    }

    migrationTimerRef.current = window.setTimeout(() => {
      migrationTimerRef.current = null
      if (pendingDocPathRef.current !== pendingDocPath) return
      session.setDocPath(pendingDocPath)
      lastBoundDocPathRef.current = pendingDocPath
      pendingDocPathRef.current = undefined
    }, DOC_PATH_MIGRATION_DELAY_MS)

    return () => {
      if (migrationTimerRef.current != null) {
        window.clearTimeout(migrationTimerRef.current)
        migrationTimerRef.current = null
      }
    }
  }, [session, open, shouldUseDocPersistence, loading, starting, state, sanitizedDocPath])

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
