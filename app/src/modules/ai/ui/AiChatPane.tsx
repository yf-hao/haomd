import type { FC, FormEvent, KeyboardEvent } from 'react'
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChatEntryMode, EntryContext } from '../domain/chatSession'
import { getDirKeyFromDocPath, normalizePersistableDocPath } from '../domain/docPathUtils'
import type { AiChatSessionKey } from '../application/aiChatSessionService'
import { useAiChatSession } from './hooks/useAiChatSession'
import { getAiInputHistory, appendAiInputHistory } from '../application/localStorageAiChatInputHistory'
import { resolveHistoryEntryByOrdinal } from '../application/historyViewService'
import { copyTextToClipboard } from '../platform/clipboardService'
import { insertMarkdownAtCursorBelow, replaceSelectionWithText, createTabAndInsertContent } from '../platform/editorInsertService'
import { onNativePaste, onNativePasteImage } from '../../platform/clipboardEvents'
import { AiChatBody } from './AiChatBody'
import { base64ToImageDataUrl, base64ToImageFile, readClipboardImageBase64 } from '../platform/clipboardImageService'
import { tryHandleSlashCommand, parseHistoryRecallCommand } from './aiSlashCommands'
import { AiChatCommandBridgeContext } from './AiChatCommandBridgeContext'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { AiChatHistoryDialog } from './AiChatHistoryDialog'
import {
  buildDeleteConfirmationPrompt,
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
import { useThemeContext } from '../../theme/ThemeContext'
import { loadAgentSettingsState } from '../config/agentSettingsRepo'
import type { AgentProvider } from '../domain/types'
import { getNotesConfig } from '../../settings/editorSettings'
import { createNote } from '../../notes/notesFileService'
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
import type { WorkspaceEntryKind } from '../../workspace/workspaceEntryResolver'

const EMPTY_MESSAGES = [] as const
const AI_CHAT_AGENT_STORAGE_KEY = 'haomd_ai_chat_selected_agent_id'
const EMPTY_AGENT_OPTION = { id: '', name: 'Agent' }
const DOC_PATH_SWITCH_DELAY_MS = 800
const DELETE_CONFIRM_TOKENS = new Set(['确认', '确认删除', '是', '确定', 'ok', 'okay', 'yes', 'y', 'confirm'])
const DELETE_CANCEL_TOKENS = new Set(['取消', '算了', '否', '不用了', 'cancel', 'no', 'n'])

function resolveAiChatDocPath(currentPath?: string | null): string | undefined {
  const normalized = normalizePersistableDocPath(currentPath)
  if (!normalized) {
    return undefined
  }

  const lastSegment = normalized.split('/').pop() ?? ''
  const looksLikeFile = /\.[^./\\]+$/.test(lastSegment)
  if (!looksLikeFile) {
    return normalized
  }

  return getDirKeyFromDocPath(normalized)
}

export interface AiChatPaneProps {
  sessionKey: AiChatSessionKey
  entryMode: ChatEntryMode
  initialContext?: EntryContext
  onClose: () => void
  currentFilePath?: string | null
  currentFolderPath?: string | null
  getCurrentMarkdown?: () => string
  getCurrentFileName?: () => string | null
  getCurrentFilePath?: () => string | null
  getCurrentFolderPath?: () => string | null
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
  /** 触发 AI 操作的编辑器标签 ID，用于避免内容串到其他标签 */
  sourceTabId?: string | null
  /** Full-page mode: centered input when empty, messages above input when not */
  fullPage?: boolean
}

export const AiChatPane: FC<AiChatPaneProps> = ({
  sessionKey,
  entryMode,
  initialContext,
  onClose,
  currentFilePath,
  currentFolderPath,
  getCurrentMarkdown,
  getCurrentFileName,
  getCurrentFilePath,
  getCurrentFolderPath,
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
  sourceTabId,
  fullPage = false,
}) => {
  const { themeSettings } = useThemeContext()
  const [input, setInput] = useState('')
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
  const [imageGenerationRunning, setImageGenerationRunning] = useState(false)
  // 仅在通过 /list 打开输入历史弹窗时，才允许使用 `!n` 本地历史回填命令
  const [historyRecallEnabled, setHistoryRecallEnabled] = useState(false)
  const commandBridge = useContext(AiChatCommandBridgeContext)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const paneRootRef = useRef<HTMLElement>(null)
  const shouldAutoScrollRef = useRef(true)
  const programmaticScrollRef = useRef(false)
  const lastScrollTopRef = useRef(0)
  const pendingInitialScrollRef = useRef(true)
  const lastTouchYRef = useRef<number | null>(null)
  const isComposingRef = useRef(false)
  const lockEnterRef = useRef(false)
  const historyCursorRef = useRef<number | null>(null)
  const [, setHistoryCursor] = useState<number | null>(null)
  const docPathStabilizeTimerRef = useRef<number | null>(null)
  const previousBusyRef = useRef(false)

  const autoResizeInput = () => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    const maxHeight = 120
    const next = Math.min(maxHeight, el.scrollHeight)
    el.style.height = `${next}px`
  }

  const clearHistoryBrowse = () => {
    historyCursorRef.current = null
    setHistoryCursor(null)
  }

  const rawDocPath = resolveAiChatDocPath(currentFolderPath ?? currentFilePath)
  const isPersistedSession = sessionKey.startsWith('session:')
  const [stableDocPath, setStableDocPath] = useState<string | undefined>(() =>
    isPersistedSession ? rawDocPath : undefined,
  )
  const [docPathReady, setDocPathReady] = useState<boolean>(() => isPersistedSession)
  const [docPathFreezeUntil, setDocPathFreezeUntil] = useState<number>(0)
  const [docConversationReloadToken, setDocConversationReloadToken] = useState(0)

  const effectiveDocPath = isPersistedSession ? undefined : stableDocPath
  const historyDirectoryKey = stableDocPath ?? rawDocPath ?? sessionKey ?? '/'
  const selectedAgent = agents.find((agent) => agent.id === activeAgentId) ?? null
  const activeAgentMode = selectedAgent?.kind === 'image_generation' ? 'image_generation' : 'chat'

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
    sessionKey,
    entryMode,
    initialContext,
    open: isPersistedSession || docPathReady,
    selectedAgentId: activeAgentMode === 'chat' ? activeAgentId : null,
    docPath: effectiveDocPath,
    legacyDocPath: normalizePersistableDocPath(currentFilePath),
    getCurrentMarkdown,
    getCurrentFileName,
    getCurrentFilePath,
    getCurrentFolderPath: () => currentFolderPath ?? getCurrentFolderPath?.() ?? null,
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
      setPendingDeleteRequest({ path: targetPath, target: 'workspace-entry', targetKind })
      return {
        ok: true,
        message: buildDeleteConfirmationPrompt(
          targetKind === 'dir' ? `目标文件夹「${targetPath}」` : `目标「${targetPath}」`,
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
    if (isPersistedSession) return
    if (previousBusyRef.current && !isBusy) {
      setDocPathFreezeUntil(Date.now() + DOC_PATH_SWITCH_DELAY_MS)
    }
    previousBusyRef.current = isBusy
  }, [isBusy, isPersistedSession])

  useEffect(() => {
    if (docPathStabilizeTimerRef.current != null) {
      window.clearTimeout(docPathStabilizeTimerRef.current)
      docPathStabilizeTimerRef.current = null
    }

    if (isPersistedSession) {
      setStableDocPath(rawDocPath)
      setDocPathReady(true)
      return
    }

    const now = Date.now()
    const remainingFreeze = Math.max(0, docPathFreezeUntil - now)
    if (isBusy || remainingFreeze > 0) {
      if (!isBusy && remainingFreeze > 0) {
        docPathStabilizeTimerRef.current = window.setTimeout(() => {
          setStableDocPath(rawDocPath)
          setDocPathReady(true)
          setDocConversationReloadToken((prev) => prev + 1)
          docPathStabilizeTimerRef.current = null
        }, remainingFreeze)
      }
      return
    }

    docPathStabilizeTimerRef.current = window.setTimeout(() => {
      setStableDocPath(rawDocPath)
      setDocPathReady(true)
      setDocConversationReloadToken((prev) => prev + 1)
      docPathStabilizeTimerRef.current = null
    }, 0)

    return () => {
      if (docPathStabilizeTimerRef.current != null) {
        window.clearTimeout(docPathStabilizeTimerRef.current)
        docPathStabilizeTimerRef.current = null
      }
    }
  }, [rawDocPath, isPersistedSession, sessionKey, isBusy, docPathFreezeUntil])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
    autoResizeInput()
  }, [entryMode, initialContext])

  useLayoutEffect(() => {
    autoResizeInput()
  }, [input])

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
    if (entryMode === 'selection' && initialContext && initialContext.type === 'selection') {
      setContextPlaceholderMode('selection')
      return
    }
    if (entryMode === 'file' && initialContext && initialContext.type === 'file') {
      setContextPlaceholderMode('file')
      return
    }
    setContextPlaceholderMode('none')
  }, [entryMode, initialContext])

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
        console.warn('[AiChatPane] load agents failed', error)
        if (!cancelled) {
          setAgents([])
          setActiveAgentId(null)
        }
      }
    }

    void loadAgents()
    return () => {
      cancelled = true
    }
  }, [])

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
      setInput(next)
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

        // 根据当前文件名构造一个友好的文件名，仅用于 Dify 附件展示
        const fileName = (() => {
          if (!currentFilePath) return 'clipboard.png'
          const pathPart = currentFilePath.split(/[/\\]/).pop() || ''
          const withoutExt = pathPart.replace(/\.[^./\\]+$/, '')
          const base = withoutExt || 'clipboard'
          return `image_${base}.png`
        })()

        // Dify 模式：base64 → File → 走附件上传路径
        if (!providerType || providerType === 'dify') {
          const file = base64ToImageFile(base64, fileName, 'image/png')
          console.log('[AiChatPane] native image paste: uploading file', file.name)
          await uploadFiles([file])
          return
        }

        // 非 Dify 模式：base64 → data URL，通过 Vision 模式发送
        const dataUrl = base64ToImageDataUrl(base64, 'image/png')
        console.log('[AiChatPane] native image paste: attachedImageDataUrl set via base64')
        setAttachedImageDataUrl(dataUrl)
      } catch (e) {
        console.error('[AiChatPane] native image paste: error', e)
      }
    })

    return () => {
      unlisten()
    }
  }, [currentFilePath, providerType, uploadFiles])

  const doSend = async () => {
    const contentToSend = input
    const directoryKey = historyDirectoryKey

    if (activeAgentMode === 'image_generation') {
      const prompt = contentToSend.trim()
      if (!prompt || imageGenerationRunning) return

      const imageAgent =
        agents.find((agent) => agent.id === activeAgentId && agent.kind === 'image_generation') ?? null
      if (!imageAgent) return

      clearHistoryBrowse()
      setInput('')

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
      shouldAutoScrollRef.current = true
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
    if (pendingDeleteRequest) {
      clearHistoryBrowse()
      if (DELETE_CONFIRM_TOKENS.has(trimmedInput) || DELETE_CONFIRM_TOKENS.has(normalizedInput)) {
        setInput('')
        const result =
          pendingDeleteRequest.target === 'folder'
            ? onConfirmDeleteCurrentFolder
              ? await onConfirmDeleteCurrentFolder(pendingDeleteRequest.path)
              : { ok: false, message: '当前文件夹删除能力不可用。' }
            : pendingDeleteRequest.target === 'workspace-entry'
              ? onConfirmDeleteWorkspaceEntry
                ? await onConfirmDeleteWorkspaceEntry(
                  pendingDeleteRequest.path,
                  pendingDeleteRequest.targetKind,
                )
                : { ok: false, message: '当前工作区删除能力不可用。' }
              : onConfirmDeleteCurrentDocument
                ? await onConfirmDeleteCurrentDocument(pendingDeleteRequest.path)
                : { ok: false, message: '当前删除能力不可用。' }
        setPendingDeleteRequest(null)
        setStatusMessage?.(result.message)
        return
      }
      if (DELETE_CANCEL_TOKENS.has(trimmedInput) || DELETE_CANCEL_TOKENS.has(normalizedInput)) {
        setInput('')
        setPendingDeleteRequest(null)
        setStatusMessage?.('已取消删除。')
        return
      }
      setStatusMessage?.('请回复“确认删除”或“取消”。')
      return
    }

    if (shouldTriggerDeleteCurrentDocument(trimmedInput)) {
      const currentPath = normalizePersistableDocPath(getCurrentFilePath?.())
      if (!currentPath) {
        setStatusMessage?.('当前文档尚未保存，无法删除文件。')
        return
      }
      clearHistoryBrowse()
      setInput('')
      setPendingDeleteRequest({ path: currentPath, target: 'document' })
      setStatusMessage?.(buildDeleteConfirmationPrompt('当前文档'))
      return
    }

    if (shouldTriggerDeleteCurrentFolder(trimmedInput)) {
      const currentFolder = (currentFolderPath ?? getCurrentFolderPath?.() ?? '').trim()
      if (!currentFolder) {
        setStatusMessage?.('当前未选中文件夹，无法删除文件夹。')
        return
      }
      clearHistoryBrowse()
      setInput('')
      setPendingDeleteRequest({ path: currentFolder, target: 'folder' })
      setStatusMessage?.(buildDeleteConfirmationPrompt('当前文件夹'))
      return
    }

    const deleteWorkspaceEntryRequest = matchDeleteWorkspaceEntry(trimmedInput)
    if (deleteWorkspaceEntryRequest) {
      clearHistoryBrowse()
      setInput('')
      setPendingDeleteRequest({
        path: deleteWorkspaceEntryRequest.targetPath,
        target: 'workspace-entry',
        targetKind: deleteWorkspaceEntryRequest.targetKind,
      })
      setStatusMessage?.(
        buildDeleteConfirmationPrompt(
          deleteWorkspaceEntryRequest.targetKind === 'dir'
            ? `目标文件夹「${deleteWorkspaceEntryRequest.targetPath}」`
            : `目标「${deleteWorkspaceEntryRequest.targetPath}」`,
        ),
      )
      return
    }

    const renameRequest = matchRenameCurrentDocument(trimmedInput)
    if (renameRequest) {
      clearHistoryBrowse()
      setInput('')
      const result = onRenameCurrentDocument
        ? await onRenameCurrentDocument(renameRequest.fileName)
        : { ok: false, message: '当前重命名能力不可用。' }
      setStatusMessage?.(result.message)
      return
    }

    const renameWorkspaceRequest = matchRenameWorkspaceEntry(trimmedInput)
    if (renameWorkspaceRequest) {
      clearHistoryBrowse()
      setInput('')
      const result = onRenameWorkspaceEntry
        ? await onRenameWorkspaceEntry(
          renameWorkspaceRequest.targetPath,
          renameWorkspaceRequest.newName,
          renameWorkspaceRequest.targetKind,
        )
        : { ok: false, message: '当前工作区重命名能力不可用。' }
      setStatusMessage?.(result.message)
      return
    }

    const createDirectoryRequest = matchCreateDirectoryUnderSelection(trimmedInput)
    if (createDirectoryRequest) {
      clearHistoryBrowse()
      setInput('')
      const result = onCreateDirectoryUnderSelection
        ? await onCreateDirectoryUnderSelection(createDirectoryRequest.directoryName)
        : { ok: false, message: '当前创建目录能力不可用。' }
      setStatusMessage?.(result.message)
      return
    }

    const createWorkspaceDirectoryRequest = matchCreateDirectoryInWorkspace(trimmedInput)
    if (createWorkspaceDirectoryRequest) {
      clearHistoryBrowse()
      setInput('')
      const result = onCreateDirectoryInWorkspace
        ? await onCreateDirectoryInWorkspace(
          createWorkspaceDirectoryRequest.parentPath,
          createWorkspaceDirectoryRequest.directoryName,
        )
        : { ok: false, message: '当前工作区创建目录能力不可用。' }
      setStatusMessage?.(result.message)
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
        setHistoryCursor(null)
        setInput(nextText)
        requestAnimationFrame(() => {
          const el = inputRef.current
          if (!el) return
          const len = el.value.length
          el.setSelectionRange(len, len)
          autoResizeInput()
        })
      }
      return
    }

    clearHistoryBrowse()
    setInput('')
    shouldAutoScrollRef.current = true

    const handled = await tryHandleSlashCommand(contentToSend, {
      // slash 命令与文档会话保持一致：按目录共享会话
      docPath: effectiveDocPath,
      runAppCommand: commandBridge?.runAppCommand,
      showModal: (message: string) => setSlashModalMessage(message),
      getRecentMessagesForDigest: getRecentMessagesForDigest,
      openHistoryDialog: ({ docPath }) => {
        const key = docPath ?? historyDirectoryKey
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

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (isComposingRef.current) return
    await doSend()
  }


  const handleInputKeyDown = async (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposingRef.current) return

    if (e.key === 'Escape' && isProcessing) {
      e.preventDefault()
      handleStop()
      return
    }

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
      if (!isHistoryMode && input.trim()) {
        // 非历史模式且当前输入非空：不进入历史浏览，交给默认光标逻辑
      } else {
        const directoryKey = historyDirectoryKey
        const historyList = getAiInputHistory(directoryKey)
        if (historyList.length > 0) {
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
          if (entry && entry.text.trim()) {
            const el = inputRef.current
            if (el) {
              e.preventDefault()
              historyCursorRef.current = nextCursor
              setHistoryCursor(nextCursor)
              setInput(entry.text)
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
        }
      }
      // 如果当前输入非空且尚未进入历史模式，或没有历史记录，则交给默认的光标移动逻辑
    }

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
    const effectiveSourceTabId = sourceTabId ?? sessionKey
    await insertMarkdownAtCursorBelow({ text: content, sourceTabId: effectiveSourceTabId })
  }

  const handleReplace = async (content: string) => {
    const effectiveSourceTabId = sourceTabId ?? sessionKey
    await replaceSelectionWithText({ text: content, sourceTabId: effectiveSourceTabId })
  }

  const handleSave = async (content: string) => {
    await createTabAndInsertContent(content)
  }

  const handleSaveToNotes = async (content: string) => {
    const cfg = await getNotesConfig()
    if (!cfg.notesDirectory) {
      // TODO: show toast when toast service is accessible
      console.warn('[Notes] 未配置随笔目录，请先在随笔侧边栏配置保存目录')
      return
    }
    await createNote(cfg.notesDirectory, content)
  }

  const handleChangeRole = async (roleId: string) => {
    if (!roleId) return
    await changeRole(roleId)
  }

  const handleModelChange = async (modelId: string) => {
    if (!modelId) return
    await changeModel(modelId)
  }

  const handleCopyImageUrl = async (message: EphemeralImageGenerationResultMessage) => {
    if (!message.imageUrl) return
    await copyTextToClipboard(message.imageUrl)
  }

  const handleCopyImageMarkdown = async (message: EphemeralImageGenerationResultMessage) => {
    if (!message.imageUrl) return
    await copyTextToClipboard(buildImageMarkdown({ imageUrl: message.imageUrl, prompt: message.prompt }))
  }

  const handleSaveGeneratedImage = async (message: EphemeralImageGenerationResultMessage) => {
    if (!message.imageUrl) return
    await saveRemoteImageWithDialog({ imageUrl: message.imageUrl, prompt: message.prompt })
  }

  const handleInsertGeneratedImage = async (message: EphemeralImageGenerationResultMessage) => {
    if (!message.imageUrl) return
    await insertGeneratedImageIntoEditor({ imageUrl: message.imageUrl, prompt: message.prompt })
  }

  const handleSaveGeneratedImageToNotes = async (message: EphemeralImageGenerationResultMessage) => {
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
  }

  const messageSource = state?.viewMessages ?? EMPTY_MESSAGES
  const allMessages = messageSource.filter((m) => !m.hidden)
  const messages = allMessages

  const [visibleLengths, setVisibleLengths] = useState<Record<string, number>>({})
  const [activeTypewriterId, setActiveTypewriterId] = useState<string | null>(null)
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
    if (!isDifyProvider) {
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
          // 新的打字目标，从 0 开始
          next[msg.id] = 0
        } else {
          // 旧消息一律锁死为全文
          next[msg.id] = fullLen
        }
      }
      return next
    })

    setActiveTypewriterId(nextActiveId)
  }, [isDifyProvider, messages, activeTypewriterId])

  useEffect(() => {
    if (!isDifyProvider) {
      // 切换到非 Dify 模式时，不再暴力清空 visibleLengths。
      // 因为 getDisplayContent 已经有 !isDifyProvider 的判断，所以保留缓存是安全的，
      // 且能防止切回 Dify 时因全量清空导致的“重新输出”。
      return
    }

    // 当前没有需要打字机动画的消息（没有 streaming 的助手消息），
    // 直接退出，不启动 requestAnimationFrame 循环。
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
          } else {
            // 虽然本帧由于 speed 限制没产生新字符，但任务未完成，仍需下一帧
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
  }, [animationKey, messageSource])


  const getDisplayContent = (msgId: string, full: string) => {
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
  }

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

  const inputPlaceholder =
    activeAgentMode === 'image_generation'
      ? '输入图片生成提示词'
      : contextPlaceholderMode === 'selection'
      ? 'Selected content will be used as context for the answer.'
      : contextPlaceholderMode === 'file'
        ? 'Current file content will be used as context for the answer.'
        : 'Ask anything to AI'

  const handleStop = () => {
    // 找到当前正在“吐出”的消息（无论是网络流还是打字机补齐阶段）
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
    } else {
      stop()
    }
  }

  useEffect(() => {
    if (!isProcessing) return

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const root = paneRootRef.current
      if (!root) return
      const target = event.target instanceof Node ? event.target : null
      const active = typeof document !== 'undefined' ? document.activeElement : null
      const withinPane =
        (!!target && root.contains(target)) ||
        (!!active && root.contains(active))
      if (!withinPane) return

      event.preventDefault()
      event.stopPropagation()
      handleStop()
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [isProcessing, handleStop])

  const roles = systemPromptInfo?.roles ?? []
  const activeRoleId = systemPromptInfo?.activeRoleId

  const lastMessage = messages[messages.length - 1]
  const latestStreamingAssistantId =
    [...messages]
      .reverse()
      .find((message) => message.role === 'assistant' && message.streaming)?.id ?? null
  const lastMessageDisplayLength =
    lastMessage && lastMessage.role === 'assistant'
      ? getDisplayContent(lastMessage.id, lastMessage.content).length
      : lastMessage?.content.length ?? 0

  const lastMessageKey = lastMessage ? `${lastMessage.id}:${lastMessageDisplayLength}` : ''
  const hasLocalBackground = Boolean(themeSettings.aiChatBackground?.enabled && themeSettings.aiChatBackground?.path)

  const scrollMessagesToBottom = () => {
    const el = messagesContainerRef.current
    if (!el) return
    programmaticScrollRef.current = true
    el.scrollTop = el.scrollHeight
    lastScrollTopRef.current = el.scrollTop
    requestAnimationFrame(() => {
      programmaticScrollRef.current = false
    })
  }

  useEffect(() => {
    const el = messagesContainerRef.current
    if (!el) return

    const updateAutoScroll = () => {
      const currentScrollTop = el.scrollTop
      const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      if (distanceToBottom <= 24) {
        shouldAutoScrollRef.current = true
      }
      lastScrollTopRef.current = currentScrollTop
    }

    const handleWheel = (event: WheelEvent) => {
      if (programmaticScrollRef.current) return
      if (event.deltaY < 0) {
        shouldAutoScrollRef.current = false
      }
    }

    const handleTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0]
      lastTouchYRef.current = touch?.clientY ?? null
    }

    const handleTouchMove = (event: TouchEvent) => {
      if (programmaticScrollRef.current) return
      const touch = event.touches[0]
      if (!touch) return
      const previousY = lastTouchYRef.current
      lastTouchYRef.current = touch.clientY
      if (previousY == null) return
      if (touch.clientY - previousY > 4) {
        shouldAutoScrollRef.current = false
      }
    }

    updateAutoScroll()
    el.addEventListener('scroll', updateAutoScroll, { passive: true })
    el.addEventListener('wheel', handleWheel, { passive: true })
    el.addEventListener('touchstart', handleTouchStart, { passive: true })
    el.addEventListener('touchmove', handleTouchMove, { passive: true })
    return () => {
      el.removeEventListener('scroll', updateAutoScroll)
      el.removeEventListener('wheel', handleWheel)
      el.removeEventListener('touchstart', handleTouchStart)
      el.removeEventListener('touchmove', handleTouchMove)
    }
  }, [sessionKey])

  useEffect(() => {
    shouldAutoScrollRef.current = true
    lastScrollTopRef.current = 0
    pendingInitialScrollRef.current = true
  }, [sessionKey, fullPage])

  useEffect(() => {
    if (!pendingInitialScrollRef.current) return
    if (messages.length === 0) return

    const scrollToBottom = () => {
      scrollMessagesToBottom()
      pendingInitialScrollRef.current = false
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(scrollToBottom)
    })
  }, [sessionKey, fullPage, messages.length, lastMessageKey])

  useEffect(() => {
    if (!shouldAutoScrollRef.current) return
    scrollMessagesToBottom()
  }, [lastMessageKey])

  useEffect(() => {
    if (!latestStreamingAssistantId) return
    shouldAutoScrollRef.current = true
    scrollMessagesToBottom()
  }, [latestStreamingAssistantId])

  useEffect(() => {
    const scrollContainer = messagesContainerRef.current
    if (!scrollContainer) return
    const content = scrollContainer.firstElementChild
    if (!content || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      if (!shouldAutoScrollRef.current) return
      scrollMessagesToBottom()
    })

    observer.observe(content)
    return () => {
      observer.disconnect()
    }
  }, [sessionKey, fullPage, messages.length])

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
    <>
    <section className={`pane ai-chat-pane ${fullPage ? 'ai-chat-pane-fullpage' : ''} ${hasLocalBackground ? 'has-ai-chat-local-background' : ''}`.trim()} ref={paneRootRef}>
      {!fullPage && (
      <div className="ai-chat-pane-header">
        <div className="ai-chat-pane-title">
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
        <button
          type="button"
          className="ai-chat-close-button"
          aria-label="关闭 AI Chat"
          onClick={onClose}
        >
          <span className="ai-chat-close-icon" aria-hidden="true" />
        </button>
      </div>
      )}

      <div className="ai-chat-pane-body">
        <AiChatBody
          messages={messages}
          ephemeralMessages={ephemeralMessages}
          agentMode={activeAgentMode}
          activeDisplayAssistantId={isDifyProvider ? activeTypewriterId : latestStreamingAssistantId}
          historyIdentity={`${sessionKey}:${fullPage ? 'full' : 'dock'}`}
          loading={isProcessing}
          error={error}
          input={input}
          onInputChange={(value) => {
            setInput(value)
            autoResizeInput()
          }}
          onManualInputChange={clearHistoryBrowse}
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
          onSaveToNotes={handleSaveToNotes}
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
          isResizing={false}
          fullPage={fullPage}
        />
      </div>
    </section>
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
