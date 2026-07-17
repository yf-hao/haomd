import type { FC, FormEvent, KeyboardEvent, MouseEventHandler, MouseEvent as ReactMouseEvent } from 'react'
import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { getAiChatUiSettings } from '../../settings/editorSettings'
import type { ChatEntryMode, ChatMessageView, EntryContext } from '../domain/chatSession'
import { getDirKeyFromDocPath, normalizePersistableDocPath } from '../domain/docPathUtils'
import { AiChatBody } from './AiChatBody'
import type { AiChatComposerHandle } from './AiChatComposer'
import { buildDisplayMessages } from './displayMessageOrder'
import { useAiChatSession } from './hooks/useAiChatSession'
import { getAiInputHistory, appendAiInputHistory } from '../application/localStorageAiChatInputHistory'
import { resolveHistoryEntryByOrdinal } from '../application/historyViewService'
import { copyTextToClipboard } from '../platform/clipboardService'
import { insertMarkdownAtCursorBelow, replaceSelectionWithText, createTabAndInsertContent } from '../platform/editorInsertService'
import { onNativePaste, onNativePasteImage } from '../../platform/clipboardEvents'
import { base64ToImageDataUrl, base64ToImageFile, readClipboardImageBase64 } from '../platform/clipboardImageService'
import { tryHandleSlashCommand, parseHistoryRecallCommand } from './aiSlashCommands'
import { AiChatCommandBridgeContext } from './AiChatCommandBridgeContext'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { AiChatHistoryDialog } from './AiChatHistoryDialog'
import {
  buildDeleteConfirmationPrompt,
  parseDeleteConfirmationPrompt,
  shouldTriggerDeleteCurrentDocument,
  shouldTriggerDeleteCurrentFolder,
} from './deleteIntentMatcher'
import { matchRenameCurrentDocument } from './renameIntentMatcher'
import { matchCreateDirectoryUnderSelection } from './createDirectoryIntentMatcher'
import {
  matchCreateDirectoryInWorkspace,
  matchDeleteWorkspaceEntry,
  matchRenameWorkspaceEntry,
} from './workspaceEntryIntentMatcher'
import { shouldRevealCurrentDirectory } from './currentDirectoryIntentMatcher'
import { resolveWorkspaceEntryByName, type WorkspaceEntryKind } from '../../workspace/workspaceEntryResolver'
import { loadAgentSettingsState } from '../config/agentSettingsRepo'
import type { AgentProvider } from '../domain/types'
import { useThemeContext } from '../../theme/ThemeContext'
import type { EphemeralAiChatMessage, EphemeralImageGenerationResultMessage } from './imageGenerationEphemeral'
import { createEphemeralId } from './imageGenerationEphemeral'
import { runImageGenerationWithAgent } from '../agents/imageGeneration/imageGenerationAgentService'
import { appendImageGenerationHistory } from '../agents/imageGeneration/imageGenerationHistoryRepo'
import {
  buildImageMarkdown,
  insertGeneratedImageIntoEditor,
  saveRemoteImageWithDialog,
} from '../agents/imageGeneration/imageGenerationResultService'
import { saveImageGenerationToNotes } from '../agents/imageGeneration/imageGenerationNotesBridge'

const EMPTY_MESSAGES: ChatMessageView[] = []
const AI_CHAT_AGENT_STORAGE_KEY = 'haomd_ai_chat_selected_agent_id'
const EMPTY_AGENT_OPTION = { id: '', name: 'Agent' }
const DOC_PATH_SWITCH_DELAY_MS = 800
const DELETE_CONFIRM_TOKENS = new Set(['确认', '确认删除', '是', '确定', 'ok', 'okay', 'yes', 'y', 'confirm'])
const DELETE_CANCEL_TOKENS = new Set(['取消', '算了', '否', '不用了', 'cancel', 'no', 'n'])

export type AiChatDialogProps = {
  open: boolean
  entryMode: ChatEntryMode
  initialContext?: EntryContext
  onClose: () => void
  currentFilePath?: string | null
  currentFolderPath?: string | null
  currentDirectoryPath?: string | null
  docPathOverride?: string | null
  getCurrentMarkdown?: () => string
  getCurrentFileName?: () => string | null
  getCurrentFilePath?: () => string | null
  getCurrentFolderPath?: () => string | null
  getCurrentDirectoryPath?: () => string | null
  getCurrentWorkspaceRoot?: () => string | null
  onDocumentSaved?: (path: string) => void
  onConfirmDeleteCurrentDocument?: (path: string) => Promise<{ ok: boolean; message: string }>
  onConfirmDeleteCurrentFolder?: (path: string) => Promise<{ ok: boolean; message: string }>
  onConfirmDeleteWorkspaceEntry?: (
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
  /**
   * 用于在本地持久化与恢复会话的 key，一般为 tabId。
   */
  tabId: string
}

export const AiChatDialog: FC<AiChatDialogProps> = ({
  open,
  entryMode,
  initialContext,
  onClose,
  currentFilePath,
  currentFolderPath,
  currentDirectoryPath,
  docPathOverride,
  getCurrentMarkdown,
  getCurrentFileName,
  getCurrentFilePath,
  getCurrentFolderPath,
  getCurrentDirectoryPath,
  getCurrentWorkspaceRoot,
  onDocumentSaved,
  onConfirmDeleteCurrentDocument,
  onConfirmDeleteCurrentFolder,
  onConfirmDeleteWorkspaceEntry,
  onRenameCurrentDocument,
  onRenameWorkspaceEntry,
  onCreateDirectoryUnderSelection,
  onCreateDirectoryInWorkspace,
  setStatusMessage,
  t,
  tabId,
}) => {
  const { themeSettings } = useThemeContext()
  const [contextPrefix, setContextPrefix] = useState<string | null>(null)
  const [contextPrefixUsed, setContextPrefixUsed] = useState(false)
  const [contextPlaceholderMode, setContextPlaceholderMode] = useState<'none' | 'selection' | 'file'>('none')
  const [attachedImageDataUrl, setAttachedImageDataUrl] = useState<string | null>(null)
  const [slashModalMessage, setSlashModalMessage] = useState<string | null>(null)
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false)
  const [historyDialogDirKey, setHistoryDialogDirKey] = useState<string | null>(null)
  const [agents, setAgents] = useState<AgentProvider[]>([])
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null)
  const [ephemeralMessages, setEphemeralMessages] = useState<EphemeralAiChatMessage[]>([])
  const [pendingDeleteRequest, setPendingDeleteRequest] = useState<
    | { path: string; target: 'document' | 'folder' }
    | { path: string; target: 'workspace-entry'; targetKind?: WorkspaceEntryKind }
    | null
  >(null)
  const [localFeedbackMessages, setLocalFeedbackMessages] = useState<ChatMessageView[]>([])
  const [imageGenerationRunning, setImageGenerationRunning] = useState(false)
  // 仅在通过 /list 打开输入历史弹窗时，才允许使用 `!n` 本地历史回填命令
  const [historyRecallEnabled, setHistoryRecallEnabled] = useState(false)
  const commandBridge = useContext(AiChatCommandBridgeContext)
  const isComposingRef = useRef(false)
  const compositionCommitLockUntilRef = useRef(0)
  const compositionUnlockFrameRef = useRef<number | null>(null)
  const historyCursorRef = useRef<number | null>(null)
  const composerHandleRef = useRef<AiChatComposerHandle | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const messagesContainerRef = useRef<HTMLDivElement | null>(null)
  const docPathStabilizeTimerRef = useRef<number | null>(null)
  const previousBusyRef = useRef(false)
  const selectedAgent = agents.find((agent) => agent.id === activeAgentId) ?? null
  const activeAgentMode = selectedAgent?.kind === 'image_generation' ? 'image_generation' : 'chat'

  const autoResizeInput = () => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    const maxHeight = 120
    const next = Math.min(maxHeight, el.scrollHeight)
    el.style.height = `${next}px`
  }

  const clearHistoryBrowse = useCallback(() => {
    if (historyCursorRef.current == null) return
    historyCursorRef.current = null
  }, [])

  const getDraft = useCallback(() => composerHandleRef.current?.getDraft() ?? '', [])
  const setDraft = useCallback((value: string, caret?: number | null) => {
    composerHandleRef.current?.setDraft(value, caret)
  }, [])
  const clearDraft = useCallback(() => {
    composerHandleRef.current?.clearDraft()
  }, [])

  const findImplicitPendingDeleteRequest = () => {
    const candidates = [...localFeedbackMessages, ...(state?.viewMessages ?? [])]
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const message = candidates[index]
      if (message.role !== 'assistant') continue
      const parsed = parseDeleteConfirmationPrompt(message.content)
      if (!parsed) continue
      if (parsed.target === 'document') {
        const path = normalizePersistableDocPath(getCurrentFilePath?.())
        if (!path) return null
        return { path, target: 'document' as const }
      }
      if (parsed.target === 'folder') {
        const path = (currentFolderPath ?? getCurrentFolderPath?.() ?? '').trim()
        if (!path) return null
        return { path, target: 'folder' as const }
      }
      return {
        path: parsed.path,
        target: 'workspace-entry' as const,
        targetKind: parsed.targetKind,
      }
    }
    return null
  }

  const pushLocalFeedback = (content: string) => {
    const trimmed = content.trim()
    if (!trimmed) return
    setLocalFeedbackMessages((prev) => [
      ...prev.slice(-4),
      {
        id: `local-feedback:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        role: 'assistant',
        content: trimmed,
      },
    ])
  }

  const persistableFilePath = normalizePersistableDocPath(currentFilePath)
  const rawDocPath =
    docPathOverride ??
    normalizePersistableDocPath(currentFolderPath) ??
    (persistableFilePath ? getDirKeyFromDocPath(persistableFilePath) : undefined)
  const [stableDocPath, setStableDocPath] = useState<string | undefined>(rawDocPath)
  const [docPathReady, setDocPathReady] = useState<boolean>(open)
  const [docPathFreezeUntil, setDocPathFreezeUntil] = useState<number>(0)
  const [docConversationReloadToken, setDocConversationReloadToken] = useState(0)
  const activeDirectoryKey = stableDocPath ?? rawDocPath

  const {
    loading,
    state,
    systemPromptInfo,
    providerType,
    error,
    sendMessage,
    stop,
    stopAndTruncate,
    changeRole,
    changeModel,
    resetError,
    availableModels,
    activeModelId,
    pendingAttachments,
    uploadFiles,
    removeAttachment,
    isUploading,
    getRecentMessagesForDigest,
  } = useAiChatSession({
    sessionKey: tabId,
    entryMode,
    initialContext,
    open: open && docPathReady,
    selectedAgentId: activeAgentMode === 'chat' ? activeAgentId : null,
    docPath: stableDocPath,
    legacyDocPath: persistableFilePath,
    getCurrentMarkdown,
    getCurrentFileName,
    getCurrentFilePath,
    getCurrentFolderPath: () => currentFolderPath ?? getCurrentFolderPath?.() ?? null,
    getCurrentDirectoryPath: () => currentDirectoryPath ?? getCurrentDirectoryPath?.() ?? null,
    getCurrentWorkspaceRoot,
    onDocumentSaved,
    onRequestDeleteCurrentDocument: async (path: string) => {
      setPendingDeleteRequest({ path, target: 'document' })
      return {
        ok: true,
        message: buildDeleteConfirmationPrompt('当前文档'),
      }
    },
    onRequestDeleteCurrentFolder: async (path: string) => {
      setPendingDeleteRequest({ path, target: 'folder' })
      return {
        ok: true,
        message: buildDeleteConfirmationPrompt('当前文件夹'),
      }
    },
    onRenameCurrentDocument,
    onRequestDeleteWorkspaceEntry: async (targetPath: string, targetKind?: WorkspaceEntryKind) => {
      const resolved = await resolveWorkspaceEntryByName({
        workspaceRoot: getCurrentWorkspaceRoot?.(),
        targetPath,
        expectedKind: targetKind,
      })
      if (!resolved.ok) {
        return { ok: false, message: resolved.message }
      }
      setPendingDeleteRequest({
        path: resolved.resolvedPath,
        target: 'workspace-entry',
        targetKind: resolved.kind,
      })
      return {
        ok: true,
        message: buildDeleteConfirmationPrompt(
          resolved.kind === 'dir'
            ? `目标文件夹「${resolved.relativePath}」`
            : `目标「${resolved.relativePath}」`,
        ),
      }
    },
    onRenameWorkspaceEntry,
    onCreateDirectoryUnderSelection,
    onCreateDirectoryInWorkspace,
    setStatusMessage,
    t,
    restartToken: docConversationReloadToken,
  })

  const isBusy = loading || !!state?.viewMessages.some((message) => message.streaming)

  useEffect(() => {
    if (previousBusyRef.current && !isBusy) {
      setDocPathFreezeUntil(Date.now() + DOC_PATH_SWITCH_DELAY_MS)
    }
    previousBusyRef.current = isBusy
  }, [isBusy])

  useEffect(() => {
    if (docPathStabilizeTimerRef.current != null) {
      window.clearTimeout(docPathStabilizeTimerRef.current)
      docPathStabilizeTimerRef.current = null
    }

    if (!open) {
      setDocPathReady(false)
      return
    }

    const shouldReloadConversation = rawDocPath !== stableDocPath
    const shouldOpenSession = !docPathReady
    if (!shouldReloadConversation && !shouldOpenSession) {
      return
    }

    const now = Date.now()
    const remainingFreeze = Math.max(0, docPathFreezeUntil - now)
    if (isBusy || remainingFreeze > 0) {
      if (!isBusy && remainingFreeze > 0) {
        docPathStabilizeTimerRef.current = window.setTimeout(() => {
          setStableDocPath(rawDocPath)
          setDocPathReady(true)
          if (shouldReloadConversation) {
            setDocConversationReloadToken((prev) => prev + 1)
          }
          docPathStabilizeTimerRef.current = null
        }, remainingFreeze)
      }
      return
    }

    docPathStabilizeTimerRef.current = window.setTimeout(() => {
      setStableDocPath(rawDocPath)
      setDocPathReady(true)
      if (shouldReloadConversation) {
        setDocConversationReloadToken((prev) => prev + 1)
      }
      docPathStabilizeTimerRef.current = null
    }, 0)

    return () => {
      if (docPathStabilizeTimerRef.current != null) {
        window.clearTimeout(docPathStabilizeTimerRef.current)
        docPathStabilizeTimerRef.current = null
      }
    }
  }, [open, rawDocPath, stableDocPath, docPathReady, isBusy, docPathFreezeUntil])

  useEffect(() => {
    if (!open) {
      setContextPrefix(null)
      setContextPrefixUsed(false)
      return
    }

    if (entryMode === 'selection' && initialContext && initialContext.type === 'selection') {
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

    if (entryMode === 'file' && initialContext && initialContext.type === 'file') {
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
  }, [open, entryMode, initialContext])

  useEffect(() => {
    if (!open) {
      setContextPlaceholderMode('none')
      return
    }
    if (entryMode === 'selection' && initialContext && initialContext.type === 'selection') {
      setContextPlaceholderMode('selection')
      return
    }
    if (entryMode === 'file' && initialContext && initialContext.type === 'file') {
      setContextPlaceholderMode('file')
      return
    }
    setContextPlaceholderMode('none')
  }, [open, entryMode, initialContext])

  useEffect(() => {
    let cancelled = false
    const loadAgents = async () => {
      try {
        const state = await loadAgentSettingsState()
        if (cancelled) return
        const providers = state.providers ?? []
        setAgents(providers)

        const storedId =
          typeof localStorage !== 'undefined'
            ? localStorage.getItem(AI_CHAT_AGENT_STORAGE_KEY)
            : null
        const preferredId =
          (storedId && providers.some((item) => item.id === storedId) ? storedId : null)
          ?? null
        setActiveAgentId(preferredId)
      } catch (error) {
        console.warn('[AiChatDialog] load agents failed', error)
        if (!cancelled) {
          setAgents([])
          setActiveAgentId(null)
        }
      }
    }

    if (open) {
      void loadAgents()
    }

    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (typeof localStorage === 'undefined') return
    if (!activeAgentId) {
      localStorage.removeItem(AI_CHAT_AGENT_STORAGE_KEY)
      return
    }
    localStorage.setItem(AI_CHAT_AGENT_STORAGE_KEY, activeAgentId)
  }, [activeAgentId])

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
      setDraft(next, start + text.length)
      clearHistoryBrowse()
      const pos = start + text.length
      el.setSelectionRange(pos, pos)
    })
    return () => {
      unPaste()
    }
  }, [])

  // 处理来自 Tauri 原生菜单的图片粘贴（native://paste_image），仅在 AI Chat 输入框聚焦时生效
  useEffect(() => {
    const unlisten = onNativePasteImage(async () => {
      const el = inputRef.current
      if (!el) return

      if (typeof document !== 'undefined') {
        const active = document.activeElement
        if (active !== el) {
          // 焦点不在 AI Chat 输入框时，不处理这次图片粘贴（交给编辑器等其它逻辑）
          return
        }
      }

      try {
        // 直接从剪贴板读取图片为 base64，不再依赖文件路径和 haomd 协议
        const base64 = await readClipboardImageBase64()

        const fileName = (() => {
          if (!currentFilePath) return 'clipboard.png'
          const pathPart = currentFilePath.split(/[/\\]/).pop() || ''
          const withoutExt = pathPart.replace(/\.[^./\\]+$/, '')
          const base = withoutExt || 'clipboard'
          return `image_${base}.png`
        })()

        if (!providerType || providerType === 'dify') {
          const file = base64ToImageFile(base64, fileName, 'image/png')
          console.log('[AiChatDialog] native image paste: uploading file', file.name)
          await uploadFiles([file])
          return
        }

        const dataUrl = base64ToImageDataUrl(base64, 'image/png')
        console.log('[AiChatDialog] native image paste: attachedImageDataUrl set via base64')
        setAttachedImageDataUrl(dataUrl)
      } catch (e) {
        console.error('[AiChatDialog] native image paste: error', e)
      }
    })

    return () => {
      unlisten()
    }
  }, [currentFilePath, providerType, uploadFiles])

  useEffect(() => {
    if (!open) return
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
    autoResizeInput()
  }, [open, providerType, entryMode, initialContext])

  const doSend = async () => {
    const contentToSend = getDraft()
    const directoryKey = activeDirectoryKey ?? '/'

    if (activeAgentMode === 'image_generation') {
      const prompt = contentToSend.trim()
      if (!prompt || imageGenerationRunning) return

      const imageAgent =
        agents.find((agent) => agent.id === activeAgentId && agent.kind === 'image_generation') ?? null
      if (!imageAgent) return

      clearHistoryBrowse()
      clearDraft()

      const promptMessageId = createEphemeralId('image_prompt')
      const resultMessageId = createEphemeralId('image_result')
      setEphemeralMessages((prev) => [
        ...prev,
        { id: promptMessageId, type: 'image_generation_prompt', content: prompt },
        {
          id: resultMessageId,
          type: 'image_generation_result',
          prompt,
          agentId: imageAgent.id,
          agentName: imageAgent.name,
          status: 'running',
        },
      ])
      setImageGenerationRunning(true)

      try {
        const result = await runImageGenerationWithAgent(imageAgent, { prompt })
        appendImageGenerationHistory({
          agentId: imageAgent.id,
          agentName: imageAgent.name,
          prompt,
          result,
        })
        setEphemeralMessages((prev) =>
          prev.map((message) =>
            message.id === resultMessageId && message.type === 'image_generation_result'
              ? {
                  ...message,
                  status: 'succeeded',
                  imageUrl: result.imageUrl,
                  taskId: result.taskId,
                }
              : message,
          ),
        )
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '图片生成失败'
        setEphemeralMessages((prev) =>
          prev.map((message) =>
            message.id === resultMessageId && message.type === 'image_generation_result'
              ? {
                  ...message,
                  status: 'failed',
                  errorMessage,
                }
              : message,
          ),
        )
      } finally {
        setImageGenerationRunning(false)
      }
      return
    }

    const trimmedInput = contentToSend.trim()
    const normalizedInput = trimmedInput.toLowerCase()
    const effectivePendingDeleteRequest =
      pendingDeleteRequest
      ?? (
        (DELETE_CONFIRM_TOKENS.has(trimmedInput) || DELETE_CONFIRM_TOKENS.has(normalizedInput))
          ? findImplicitPendingDeleteRequest()
          : null
      )
    if (effectivePendingDeleteRequest) {
      clearHistoryBrowse()
      if (DELETE_CONFIRM_TOKENS.has(trimmedInput) || DELETE_CONFIRM_TOKENS.has(normalizedInput)) {
        clearDraft()
        const result =
          effectivePendingDeleteRequest.target === 'folder'
            ? onConfirmDeleteCurrentFolder
              ? await onConfirmDeleteCurrentFolder(effectivePendingDeleteRequest.path)
              : { ok: false, message: '当前文件夹删除能力不可用。' }
            : effectivePendingDeleteRequest.target === 'workspace-entry'
              ? onConfirmDeleteWorkspaceEntry
                ? await onConfirmDeleteWorkspaceEntry(
                  effectivePendingDeleteRequest.path,
                  effectivePendingDeleteRequest.targetKind,
                )
                : { ok: false, message: '当前工作区删除能力不可用。' }
              : onConfirmDeleteCurrentDocument
                ? await onConfirmDeleteCurrentDocument(effectivePendingDeleteRequest.path)
                : { ok: false, message: '当前删除能力不可用。' }
        setPendingDeleteRequest(null)
        setStatusMessage?.(result.message)
        pushLocalFeedback(result.message)
        return
      }
      if (DELETE_CANCEL_TOKENS.has(trimmedInput) || DELETE_CANCEL_TOKENS.has(normalizedInput)) {
        clearDraft()
        setPendingDeleteRequest(null)
        setStatusMessage?.('已取消删除。')
        pushLocalFeedback('已取消删除。')
        return
      }
      setStatusMessage?.('请回复“确认删除”或“取消”。')
      pushLocalFeedback('请回复“确认删除”或“取消”。')
      return
    }

    if (shouldTriggerDeleteCurrentDocument(trimmedInput)) {
      const currentPath = normalizePersistableDocPath(getCurrentFilePath?.())
      if (!currentPath) {
        setStatusMessage?.('当前文档尚未保存，无法删除文件。')
        pushLocalFeedback('当前文档尚未保存，无法删除文件。')
        return
      }
      clearHistoryBrowse()
      clearDraft()
      setPendingDeleteRequest({ path: currentPath, target: 'document' })
      const prompt = buildDeleteConfirmationPrompt('当前文档')
      setStatusMessage?.(prompt)
      setSlashModalMessage(prompt)
      pushLocalFeedback(prompt)
      return
    }

    if (shouldTriggerDeleteCurrentFolder(trimmedInput)) {
      const currentFolder = (currentFolderPath ?? getCurrentFolderPath?.() ?? '').trim()
      if (!currentFolder) {
        setStatusMessage?.('当前未选中文件夹，无法删除文件夹。')
        pushLocalFeedback('当前未选中文件夹，无法删除文件夹。')
        return
      }
      clearHistoryBrowse()
      clearDraft()
      setPendingDeleteRequest({ path: currentFolder, target: 'folder' })
      const prompt = buildDeleteConfirmationPrompt('当前文件夹')
      setStatusMessage?.(prompt)
      setSlashModalMessage(prompt)
      pushLocalFeedback(prompt)
      return
    }

    const deleteWorkspaceEntryRequest = matchDeleteWorkspaceEntry(trimmedInput)
    if (deleteWorkspaceEntryRequest) {
      clearHistoryBrowse()
      clearDraft()
      setPendingDeleteRequest({
        path: deleteWorkspaceEntryRequest.targetPath,
        target: 'workspace-entry',
        targetKind: deleteWorkspaceEntryRequest.targetKind,
      })
      const prompt = buildDeleteConfirmationPrompt(
        deleteWorkspaceEntryRequest.targetKind === 'dir'
          ? `目标文件夹「${deleteWorkspaceEntryRequest.targetPath}」`
          : `目标「${deleteWorkspaceEntryRequest.targetPath}」`,
      )
      setStatusMessage?.(prompt)
      setSlashModalMessage(prompt)
      pushLocalFeedback(prompt)
      return
    }

    const renameRequest = matchRenameCurrentDocument(trimmedInput)
    if (renameRequest) {
      clearHistoryBrowse()
      clearDraft()
      const result = onRenameCurrentDocument
        ? await onRenameCurrentDocument(renameRequest.fileName)
        : { ok: false, message: '当前重命名能力不可用。' }
      setStatusMessage?.(result.message)
      pushLocalFeedback(result.message)
      return
    }

    const renameWorkspaceRequest = matchRenameWorkspaceEntry(trimmedInput)
    if (renameWorkspaceRequest) {
      clearHistoryBrowse()
      clearDraft()
      const result = onRenameWorkspaceEntry
        ? await onRenameWorkspaceEntry(
          renameWorkspaceRequest.targetPath,
          renameWorkspaceRequest.newName,
          renameWorkspaceRequest.targetKind,
        )
        : { ok: false, message: '当前工作区重命名能力不可用。' }
      setStatusMessage?.(result.message)
      pushLocalFeedback(result.message)
      return
    }

    const createDirectoryRequest = matchCreateDirectoryUnderSelection(trimmedInput)
    if (createDirectoryRequest) {
      clearHistoryBrowse()
      clearDraft()
      const result = onCreateDirectoryUnderSelection
        ? await onCreateDirectoryUnderSelection(createDirectoryRequest.directoryName)
        : { ok: false, message: '当前创建目录能力不可用。' }
      setStatusMessage?.(result.message)
      pushLocalFeedback(result.message)
      return
    }

    const createWorkspaceDirectoryRequest = matchCreateDirectoryInWorkspace(trimmedInput)
    if (createWorkspaceDirectoryRequest) {
      clearHistoryBrowse()
      clearDraft()
      const result = onCreateDirectoryInWorkspace
        ? await onCreateDirectoryInWorkspace(
          createWorkspaceDirectoryRequest.parentPath,
          createWorkspaceDirectoryRequest.directoryName,
        )
        : { ok: false, message: '当前工作区创建目录能力不可用。' }
      setStatusMessage?.(result.message)
      pushLocalFeedback(result.message)
      return
    }

    if (shouldRevealCurrentDirectory(trimmedInput)) {
      clearHistoryBrowse()
      clearDraft()
      const activeDirectory = (currentDirectoryPath ?? getCurrentDirectoryPath?.() ?? '').trim()
      const message = activeDirectory
        ? `当前目录是：${activeDirectory}`
        : '当前没有可确定的目录。'
      setStatusMessage?.(message)
      pushLocalFeedback(message)
      return
    }

    // 先处理本地历史回填命令：!n / ！n
    const ordinal = parseHistoryRecallCommand(contentToSend)
    if (ordinal != null) {
      if (!historyRecallEnabled) {
        // 当前未处于“输入历史选择”模式：忽略本次 !n 命令，避免与 /history 语义混淆
        return
      }
      const entry = resolveHistoryEntryByOrdinal(directoryKey, ordinal)
      if (entry && entry.text.trim()) {
        const nextText = entry.text
        historyCursorRef.current = null
        setDraft(nextText, nextText.length)
        requestAnimationFrame(() => {
          const el = inputRef.current
          if (!el) return
          const len = el.value.length
          el.setSelectionRange(len, len)
          window.requestAnimationFrame(autoResizeInput)
        })
      }
      return
    }

    clearHistoryBrowse()
    clearDraft()

    const handled = await tryHandleSlashCommand(contentToSend, {
      // slash 命令与文档会话保持一致：按目录共享会话
      docPath: activeDirectoryKey,
      runAppCommand: commandBridge?.runAppCommand,
      showModal: (message: string) => setSlashModalMessage(message),
      getRecentMessagesForDigest: getRecentMessagesForDigest,
      openHistoryDialog: ({ docPath }) => {
        const key = docPath ?? activeDirectoryKey ?? '/'
        setHistoryDialogDirKey(key)
        setHistoryDialogOpen(true)
        setHistoryRecallEnabled(true)
      },
    })
    if (handled === 'handled') {
      if (contentToSend.trim()) {
        appendAiInputHistory(directoryKey, contentToSend)
      }
      return
    }

    await sendMessage(contentToSend, {
      contextPrefix,
      contextPrefixUsed,
      onContextUsed: () => {
        setContextPrefixUsed(true)
        setContextPrefix(null)
        setContextPlaceholderMode('none')
      },
      attachedImageDataUrl,
      onClearAttachedImage: () => setAttachedImageDataUrl(null),
      onRestoreAttachedImage: (dataUrl) => setAttachedImageDataUrl(dataUrl),
    })
  }

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault()
    await doSend()
  }, [doSend])

  const handleCompositionStart = useCallback(() => {
    if (compositionUnlockFrameRef.current != null) {
      window.cancelAnimationFrame(compositionUnlockFrameRef.current)
      compositionUnlockFrameRef.current = null
    }
    isComposingRef.current = true
  }, [])

  const handleCompositionEnd = useCallback(() => {
    isComposingRef.current = false
    compositionCommitLockUntilRef.current = Date.now() + 16
    if (compositionUnlockFrameRef.current != null) {
      window.cancelAnimationFrame(compositionUnlockFrameRef.current)
    }
    compositionUnlockFrameRef.current = window.requestAnimationFrame(() => {
      compositionUnlockFrameRef.current = null
      compositionCommitLockUntilRef.current = 0
    })
  }, [])

  const handleInputKeyDown = useCallback(async (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const currentHistoryCursor = historyCursorRef.current
    const isHistoryMode = currentHistoryCursor != null

    // 当输入框为空或已处于历史模式时，使用 ArrowUp / ArrowDown 在当前目录的输入历史中导航
    if (
      (e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
      !e.shiftKey &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey
    ) {
      if (isComposingRef.current || e.nativeEvent.isComposing) return

      if (!isHistoryMode && getDraft().trim().length > 0) {
        // 非历史模式且当前输入非空：不进入历史浏览，交给默认光标逻辑
      } else {
        const directoryKey = activeDirectoryKey ?? '/'
        const historyList = getAiInputHistory(directoryKey)
        if (historyList.length === 0) return

        const direction = e.key === 'ArrowUp' ? 'up' as const : 'down' as const
        let nextCursor = currentHistoryCursor

        if (direction === 'up') {
          if (nextCursor == null) {
            nextCursor = historyList.length - 1
          } else if (nextCursor > 0) {
            nextCursor = nextCursor - 1
          } else {
            nextCursor = 0
          }
        } else {
          if (nextCursor == null) {
            // 尚未进入历史模式时，向下键不做特殊处理，交给默认光标逻辑
            return
          } else if (nextCursor < historyList.length - 1) {
            nextCursor = nextCursor + 1
          } else {
            nextCursor = historyList.length - 1
          }
        }

        const entry = historyList[nextCursor]
        if (!entry || !entry.text.trim()) return

        const el = inputRef.current
        if (!el) return

        e.preventDefault()
        historyCursorRef.current = nextCursor
        setDraft(entry.text, entry.text.length)
        // 将光标移动到末尾
        requestAnimationFrame(() => {
          const target = inputRef.current
          if (!target) return
          const len = target.value.length
          target.setSelectionRange(len, len)
          autoResizeInput()
        })
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      if (isComposingRef.current || e.nativeEvent.isComposing) return
      const now = Date.now()
      if (now < compositionCommitLockUntilRef.current) return
      e.preventDefault()
      if (loading) return
      await doSend()
    }
  }, [activeDirectoryKey, autoResizeInput, doSend, getDraft, historyCursorRef, inputRef, loading])

  const handleCopy = useCallback(async (content: string) => {
    await copyTextToClipboard(content)
  }, [])

  const handleInsert = useCallback(async (content: string) => {
    await insertMarkdownAtCursorBelow({ text: content, sourceTabId: tabId })
  }, [tabId])

  const handleReplace = useCallback(async (content: string) => {
    await replaceSelectionWithText({ text: content, sourceTabId: tabId })
  }, [tabId])

  const handleSave = useCallback(async (content: string) => {
    await createTabAndInsertContent(content)
  }, [])

  const handleChangeRole = useCallback(async (roleId: string) => {
    if (!roleId) return
    await changeRole(roleId)
  }, [changeRole])

  const handleModelChange = useCallback(async (modelId: string) => {
    if (!modelId) return
    await changeModel(modelId)
  }, [changeModel])

  const handleCopyImageUrl = useCallback(async (message: EphemeralImageGenerationResultMessage) => {
    if (!message.imageUrl) return
    await copyTextToClipboard(message.imageUrl)
  }, [])

  const handleCopyImageMarkdown = useCallback(async (message: EphemeralImageGenerationResultMessage) => {
    if (!message.imageUrl) return
    await copyTextToClipboard(buildImageMarkdown({ imageUrl: message.imageUrl, prompt: message.prompt }))
  }, [])

  const handleSaveGeneratedImage = useCallback(async (message: EphemeralImageGenerationResultMessage) => {
    if (!message.imageUrl) return
    await saveRemoteImageWithDialog({ imageUrl: message.imageUrl, prompt: message.prompt })
  }, [])

  const handleInsertGeneratedImage = useCallback(async (message: EphemeralImageGenerationResultMessage) => {
    if (!message.imageUrl) return
    await insertGeneratedImageIntoEditor({ imageUrl: message.imageUrl, prompt: message.prompt })
  }, [])

  const handleSaveGeneratedImageToNotes = useCallback(async (message: EphemeralImageGenerationResultMessage) => {
    if (!message.imageUrl) return
    const agent =
      agents.find((candidate) => candidate.id === message.agentId && candidate.kind === 'image_generation') ?? null
    if (!agent) return
    await saveImageGenerationToNotes({
      agent,
      prompt: message.prompt,
      result: {
        imageUrl: message.imageUrl,
        taskId: message.taskId ?? '',
      },
    })
  }, [agents])

  const handleDialogClick: MouseEventHandler<HTMLDivElement> = (e) => {
    e.stopPropagation()
  }

  const [maxVisibleMessages, setMaxVisibleMessages] = useState<number>(10)

  useEffect(() => {
    let cancelled = false

    getAiChatUiSettings()
      .then((cfg) => {
        if (cancelled) return
        const n = cfg.maxVisibleMessagesDialog
        if (typeof n === 'number' && n > 0) {
          setMaxVisibleMessages(n)
        }
      })
      .catch((e) => {
        console.error('[AiChatDialog] failed to load AiChatUiSettings', e)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const messageSource = state?.viewMessages ?? EMPTY_MESSAGES
  const allMessages = messageSource.filter((m) => !m.hidden)
  const limit = maxVisibleMessages && maxVisibleMessages > 0 ? maxVisibleMessages : allMessages.length
  const persistedMessages =
    allMessages.length > limit
      ? allMessages.slice(-limit)
      : allMessages
  const messages = buildDisplayMessages(persistedMessages, localFeedbackMessages)

  const [visibleLengths, setVisibleLengths] = useState<Record<string, number>>({})
  const [activeTypewriterId, setActiveTypewriterId] = useState<string | null>(null)

  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const dragStateRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)
  const dragModeRef = useRef<'move' | 'resize'>('move')
  const resizeRestoreTimerRef = useRef<number | null>(null)

  const isDifyProvider = providerType === 'dify'

  // 核心策略：任何时刻只允许“当前这一条助手回复”参与打字机动画，
  // 历史消息一律显示全文，避免重复播放。
  const isTypewriterRunning = isDifyProvider && !!activeTypewriterId && messages.some(
    (msg) => msg.id === activeTypewriterId && msg.role === 'assistant' && (
      msg.streaming || (visibleLengths[msg.id] !== undefined && visibleLengths[msg.id] < msg.content.length)
    ),
  )

  const streamingIds = messages
    .filter((m) => m.role === 'assistant' && m.streaming)
    .map((m) => m.id)
    .join(',')

  const animationKey = !isDifyProvider ? 'off' : (isTypewriterRunning ? `active:${streamingIds}` : 'idle')

  // 根据最新的 streaming 消息更新当前打字机目标，并锁死旧消息为全文
  useEffect(() => {
    if (!open || !isDifyProvider) {
      setActiveTypewriterId(null)
      return
    }

    const assistantMessages = messages.filter(m => m.role === 'assistant')
    if (assistantMessages.length === 0) {
      setActiveTypewriterId(null)
      return
    }

    const streamingMessages = assistantMessages.filter(m => m.streaming)
    const latestStreaming = streamingMessages[streamingMessages.length - 1]

    if (!latestStreaming) {
      return
    }

    const nextActiveId = latestStreaming.id
    if (nextActiveId === activeTypewriterId) {
      return
    }

    setVisibleLengths((prev) => {
      const next: Record<string, number> = { ...prev }
      for (const msg of assistantMessages) {
        const fullLen = msg.content.length
        if (fullLen === 0) continue
        if (msg.id === nextActiveId) {
          next[msg.id] = 0
        } else {
          next[msg.id] = fullLen
        }
      }
      return next
    })

    setActiveTypewriterId(nextActiveId)
  }, [open, isDifyProvider, messages, activeTypewriterId])


  useEffect(() => {
    if (!isDifyProvider) {
      return
    }

    if (animationKey === 'idle') {
      return
    }

    let frameId: number | null = null
    let lastTime = performance.now()
    // 打字机速度：每秒字符数
    const stepPerSecond = 70
    // 累积本轮还未消费的“字符额度”，避免过度刷新
    let charBudget = 0

    const tick = (time: number) => {
      const deltaMs = time - lastTime
      lastTime = time

      // 根据真实时间累积应该输出的字符数
      charBudget += (deltaMs / 1000) * stepPerSecond
      let deltaChars = Math.floor(charBudget)

      // 限制单帧最多输出的字符数，避免浏览器卡顿时一下子跳到全文
      const maxCharsPerFrame = 20
      if (deltaChars > maxCharsPerFrame) {
        deltaChars = maxCharsPerFrame
      }
      charBudget -= Math.max(0, deltaChars)

      setVisibleLengths((prev) => {
        let changed = false
        const next: Record<string, number> = { ...prev }

        for (const msg of messages) {
          if (msg.role !== 'assistant') continue
          const fullLen = msg.content.length
          if (fullLen === 0) continue

          const existing = next[msg.id]

          // 关键修复：只要消息正在流式传输，就必须立即在打字机进度表中“挂号” (设置为 0)。
          // 这样即便网络流在打字机还没产生第 1 个字时就结束了，打字机也能接手后续播放。
          if (msg.streaming && existing === undefined) {
            next[msg.id] = 0
            changed = true
          }

          const base = next[msg.id]
          // 如果该消息既不在 streaming 也不在打字机流程中，则跳过（处理历史对话）
          if (base === undefined) continue

          if (base >= fullLen) continue

          if (deltaChars > 0) {
            const target = Math.min(fullLen, base + deltaChars)
            if (target !== base) {
              next[msg.id] = target
              changed = true
            }
          }
        }

        return changed ? next : prev
      })

      frameId = window.requestAnimationFrame(tick)
    }

    frameId = window.requestAnimationFrame(tick)

    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId)
    }
  }, [animationKey, messageSource, isDifyProvider])

  useEffect(() => {
    if (!open || !isDifyProvider) return
    const assistantMessages = messages.filter((m) => m.role === 'assistant')
    console.warn('[AiChatDialog][typewriter] visibleLengths', {
      animationKey,
      items: assistantMessages.map((m) => ({
        id: m.id,
        streaming: m.streaming,
        contentLen: m.content.length,
        visible: visibleLengths[m.id],
      })),
    })
  }, [open, isDifyProvider, animationKey, messages, visibleLengths])

  const getDisplayContent = useCallback((msgId: string, full: string) => {
    if (!isDifyProvider || full.length === 0 || !state) return full

    // 只有当前打字目标参与截断，其他消息一律显示全文，避免重复播放
    if (msgId !== activeTypewriterId) {
      return full
    }

    const msg = messages.find((m) => m.id === msgId && m.role === 'assistant')
    const visible = visibleLengths[msgId]

    // 兜底：如果已经不是 streaming 状态，且打字机进度还没初始化/为 0，则直接展示全文
    if (!msg?.streaming && (visible === undefined || visible <= 0)) {
      return full
    }

    const length = Math.max(0, Math.min(full.length, visible ?? 0))
    return full.slice(0, length)
  }, [activeTypewriterId, isDifyProvider, messages, state, visibleLengths])

  const handleDragStart: MouseEventHandler<HTMLDivElement> = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement | null
    if (target) {
      const interactive = target.closest('select, button, input, textarea')
      if (interactive) return
    }
    if (resizeRestoreTimerRef.current != null) {
      window.clearTimeout(resizeRestoreTimerRef.current)
      resizeRestoreTimerRef.current = null
    }
    const isResizeHandle = (e.currentTarget as HTMLElement).classList.contains('ai-chat-drag-handle')
    dragModeRef.current = isResizeHandle ? 'resize' : 'move'
    if (isResizeHandle) {
      setIsResizing(true)
    }
    const { clientX, clientY } = e
    dragStateRef.current = {
      startX: clientX,
      startY: clientY,
      originX: dragOffset.x,
      originY: dragOffset.y,
    }
    setDragging(true)
    e.preventDefault()
  }

  useEffect(() => {
    if (!dragging) return
    const handleMove = (e: MouseEvent) => {
      const state = dragStateRef.current
      if (!state) return
      const dx = e.clientX - state.startX
      const dy = e.clientY - state.startY
      setDragOffset({ x: state.originX + dx, y: state.originY + dy })
    }
    const handleUp = () => {
      setDragging(false)
      dragStateRef.current = null
      if (dragModeRef.current === 'resize') {
        resizeRestoreTimerRef.current = window.setTimeout(() => {
          setIsResizing(false)
          resizeRestoreTimerRef.current = null
        }, 120)
      }
      dragModeRef.current = 'move'
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [dragging])

  useEffect(() => {
    return () => {
      if (resizeRestoreTimerRef.current != null) {
        window.clearTimeout(resizeRestoreTimerRef.current)
      }
    }
  }, [])

  const isStreamingUI = isDifyProvider && !!activeTypewriterId && messages.some(
    (msg) => msg.id === activeTypewriterId && msg.role === 'assistant' && (
      msg.streaming || (visibleLengths[msg.id] !== undefined && visibleLengths[msg.id] < msg.content.length)
    ),
  )
  const isProcessing = loading || isStreamingUI
  const agentGroups = [
    {
      id: 'chat',
      label: 'Chat Agent',
      options: agents
        .filter((agent) => agent.kind === 'chat')
        .map((agent) => ({ value: agent.id, label: agent.name })),
    },
    {
      id: 'image_generation',
      label: 'Image Generation Agent',
      options: agents
        .filter((agent) => agent.kind === 'image_generation')
        .map((agent) => ({ value: agent.id, label: agent.name })),
    },
  ].filter((group) => group.options.length > 0)

  const roles = systemPromptInfo?.roles ?? []
  const activeRoleId = systemPromptInfo?.activeRoleId
  const lastMessage = messages[messages.length - 1]
  const lastMessageDisplayLength =
    lastMessage && lastMessage.role === 'assistant'
      ? getDisplayContent(lastMessage.id, lastMessage.content).length
      : lastMessage?.content.length ?? 0
  const lastMessageKey = lastMessage ? `${lastMessage.id}:${lastMessageDisplayLength}` : ''

  const handleStop = useCallback(() => {
    const activeMsg = messages.find((m) =>
      m.role === 'assistant' && (
        m.streaming || (visibleLengths[m.id] !== undefined && visibleLengths[m.id] < m.content.length)
      ),
    )
    if (activeMsg) {
      if (isDifyProvider) {
        const currentLen = visibleLengths[activeMsg.id] ?? activeMsg.content.length
        stopAndTruncate(activeMsg.id, currentLen)
      } else {
        stop()
      }
      return
    }
    stop()
  }, [isDifyProvider, messages, stop, stopAndTruncate, visibleLengths])

  useEffect(() => {
    const el = messagesContainerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [lastMessageKey])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey
      if (!isMeta) return
      const key = e.key.toLowerCase()
      if (key !== 'w') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [open, onClose])

  const inputPlaceholder =
    activeAgentMode === 'image_generation'
      ? '输入图片生成提示词'
      : contextPlaceholderMode === 'selection'
      ? 'Selected content will be used as context for the answer.'
      : contextPlaceholderMode === 'file'
        ? 'Current file content will be used as context for the answer.'
        : 'Ask anything to AI'
  const hasLocalBackground = Boolean(themeSettings.aiChatBackground?.enabled && themeSettings.aiChatBackground?.path)
  const hasWorkspaceBackground = Boolean(themeSettings.workspaceBackground?.enabled && themeSettings.workspaceBackground?.path)

  if (!open) return null

  return (
    <>
    <div className="modal-backdrop modal-backdrop-plain">
      <div
        className={`modal modal-ai-chat ${hasLocalBackground ? 'has-ai-chat-local-background' : ''} ${hasWorkspaceBackground ? 'has-workspace-background' : ''}`.trim()}
        onClick={handleDialogClick}
        style={{ transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)` }}
      >
        <div className="modal-title ai-chat-title" onMouseDown={handleDragStart}>
          <button
            type="button"
            className="ai-chat-close-button"
            aria-label="关闭 AI Chat"
            onClick={onClose}
          >
            <span className="ai-chat-close-icon" aria-hidden="true" />
          </button>
          <div className="modal-title-text">
            {(() => {
              if (entryMode === 'selection') {
                return contextPlaceholderMode === 'selection' ? 'AI Chat -- About Selection' : 'AI Chat';
              }
              if (entryMode === 'file') {
                return contextPlaceholderMode === 'file' ? 'AI Chat -- About File' : 'AI Chat';
              }
              return 'AI Chat';
            })()}
          </div>
        </div>

        <AiChatBody
          messages={messages}
          ephemeralMessages={ephemeralMessages}
          agentMode={activeAgentMode}
          loading={isProcessing}
          error={error}
          onDraftChange={clearHistoryBrowse}
          onSubmit={handleSubmit}
          onInputKeyDown={handleInputKeyDown}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          inputRef={inputRef as React.RefObject<HTMLTextAreaElement>}
          composerHandleRef={composerHandleRef}
          messagesContainerRef={messagesContainerRef as React.RefObject<HTMLDivElement>}
          getDisplayContent={getDisplayContent}
          onCopy={handleCopy}
          onInsert={handleInsert}
          onReplace={handleReplace}
          onSave={handleSave}
          onStop={handleStop}
          resetError={resetError}
          roles={roles}
          activeRoleId={activeRoleId}
          onChangeRole={handleChangeRole}
          models={availableModels}
          activeModelId={activeModelId}
          onChangeModel={handleModelChange}
          agents={[EMPTY_AGENT_OPTION]}
          agentGroups={agentGroups}
          activeAgentId={activeAgentId ?? ''}
          onChangeAgent={(value) => setActiveAgentId(value || null)}
          attachedImageDataUrl={attachedImageDataUrl}
          onAttachImage={(dataUrl) => {
            if (providerType !== 'dify') {
              setAttachedImageDataUrl(dataUrl)
            }
          }}
          onClearImage={() => setAttachedImageDataUrl(null)}
          pendingAttachments={pendingAttachments}
          onRemoveAttachment={removeAttachment}
          isUploading={isUploading}
          onUploadFiles={(() => {
            const canUpload = !providerType || providerType === 'dify';
            return canUpload ? uploadFiles : undefined;
          })()}
          inputPlaceholder={inputPlaceholder}
          imageGenerationRunning={imageGenerationRunning}
          onCopyImageUrl={handleCopyImageUrl}
          onCopyImageMarkdown={handleCopyImageMarkdown}
          onSaveGeneratedImage={handleSaveGeneratedImage}
          onInsertGeneratedImage={handleInsertGeneratedImage}
          onSaveGeneratedImageToNotes={handleSaveGeneratedImageToNotes}
          isResizing={isResizing}
        />


        <div className="ai-chat-drag-handle ai-chat-drag-bottom" onMouseDown={handleDragStart} />
        <div className="ai-chat-drag-handle ai-chat-drag-left" onMouseDown={handleDragStart} />
        <div className="ai-chat-drag-handle ai-chat-drag-right" onMouseDown={handleDragStart} />
      </div>
    </div>
    {historyDialogOpen && historyDialogDirKey && (
      <AiChatHistoryDialog
        open={historyDialogOpen}
        directoryKey={historyDialogDirKey}
        pageSize={10}
        onClose={() => {
          setHistoryDialogOpen(false)
          setHistoryRecallEnabled(false)
        }}
      />
    )}
    {slashModalMessage && (
      <ConfirmDialog
        title="Global Memory"
        message={slashModalMessage}
        confirmText="确定"
        cancelText="关闭"
        onConfirm={() => setSlashModalMessage(null)}
        onCancel={() => setSlashModalMessage(null)}
      />
    )}
    </>
  )
}
