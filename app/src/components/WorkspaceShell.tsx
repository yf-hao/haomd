import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorView } from '@codemirror/view'
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { ConflictModal } from './ConflictModal'
import { ConfirmDialog } from './ConfirmDialog'
import Toast from './Toast'
import PreviewErrorBoundary from './PreviewErrorBoundary'
import { InsertTableDialog } from './InsertTableDialog'
import { AboutDialog } from './AboutDialog'
import { TabBar } from './TabBar'
import { FileContextMenu } from './FileContextMenu'
import { Sidebar, type SidebarContextActionPayload } from './Sidebar'
import { OutlinePanel } from './OutlinePanel'
import { Welcome } from './Welcome'
import { SearchBar } from './Editor/SearchBar'
import { useOutline } from '../hooks/useOutline'
import type { OutlineItem } from '../modules/outline/parser'
import { useWorkspaceLayout } from '../hooks/useWorkspaceLayout'
import { AiChatCommandBridgeContext } from '../modules/ai/ui/AiChatCommandBridgeContext'
import type { AiChatSessionKey } from '../modules/ai/application/aiChatSessionService'
import { aiChatSessionManager } from '../modules/ai/application/localStorageAiChatSessionManager'
import { registerEditorInsertBelow, registerEditorReplaceSelection, registerEditorCreateAndInsert, insertMarkdownAtCursorBelow } from '../modules/ai/platform/editorInsertService'
import { useFilePersistence } from '../hooks/useFilePersistence'
import { useTabs } from '../hooks/useTabs'
import { useCommandSystem } from '../hooks/useCommandSystem'
import { useSidebar } from '../hooks/useSidebar'
import { onOpenRecentFile } from '../modules/platform/menuEvents'
import { createFolder, deleteFsEntry, listFolder, writeFile } from '../modules/files/service'
import { usePdfPanel } from '../hooks/usePdfPanel'
import { useAiChatPanel } from '../hooks/useAiChatPanel'
import { useHugeDoc } from '../hooks/useHugeDoc'
import { useCursorMemory } from '../hooks/useCursorMemory'
import { useSidebarResize } from '../hooks/useSidebarResize'
import { useNativePaste } from '../hooks/useNativePaste'
import { onNativePasteImage } from '../modules/platform/clipboardEvents'
import { openTerminalAt } from '../modules/platform/terminalService'
import { openInFileManager } from '../modules/platform/fileExplorerService'
import { loadDefaultImagePathStrategyConfig, resolveImageTarget } from '../modules/images/imagePasteStrategy'
import { registerApplyHeadingLevel, registerResetHeadingToParagraph, registerEmphasizeSelection, registerInsertCodeBlock } from '../modules/editor/formatService'
// 改为从内部动态加载，优化编辑性能
// import { exportToHtml } from '../modules/export/html'

const EditorPaneLazy = lazy(() =>
  import('./EditorPane').then((m) => ({ default: m.EditorPane }))
)

const PreviewPaneLazy = lazy(() =>
  import('./PreviewPane').then((m) => ({ default: m.PreviewPane }))
)

const PdfViewerLazy = lazy(() =>
  import('../modules/pdf/components/PdfViewer').then((m) => ({ default: m.PdfViewer }))
)

const AiChatPaneLazy = lazy(() =>
  import('../modules/ai/ui/AiChatPane').then((m) => ({ default: m.AiChatPane }))
)

const AiChatDialogLazy = lazy(() =>
  import('../modules/ai/ui/AiChatDialog').then((m) => ({ default: m.AiChatDialog }))
)

const DocConversationHistoryDialogLazy = lazy(() =>
  import('../modules/ai/ui/DocConversationHistoryDialog').then((m) => ({ default: m.DocConversationHistoryDialog }))
)

const GlobalMemoryDialogLazy = lazy(() =>
  import('../modules/ai/ui/GlobalMemoryDialog').then((m) => ({ default: m.GlobalMemoryDialog }))
)

export type LeftPanelId = 'files' | 'outline' | 'pdf' | 'sessions' | null
export type InitialWorkspaceAction = 'new' | 'open' | 'open_folder' | 'open_recent' | null

export interface WorkspaceShellProps {
  activeLeftPanel: LeftPanelId
  isTauriEnv: () => boolean
  initialAction: InitialWorkspaceAction
  initialOpenRecentPath?: string | null
  initialOpenRecentIsFolder?: boolean | null
  onInitialActionHandled?: () => void
  onDocumentStatsChange?: (stats: { charCount: number | null }) => void
}

const countDocumentChars = (text: string): number => {
  if (!text) return 0
  // 简单实现：统计非空白字符数，汉字/字母/数字/标点都计入
  const noWhitespace = text.replace(/\s/g, '')
  return noWhitespace.length
}

const seed = ''

export function WorkspaceShell({
  activeLeftPanel,
  isTauriEnv,
  initialAction,
  initialOpenRecentPath,
  initialOpenRecentIsFolder,
  onInitialActionHandled,
  onDocumentStatsChange,
}: WorkspaceShellProps) {
  const [markdown, setMarkdown] = useState(seed)
  const [previewValue, setPreviewValue] = useState(seed)
  const [activeLine, setActiveLine] = useState(1)
  // 预览专用的行号：对 activeLine 做轻量节流后再驱动 Preview，降低重渲染频率
  const [previewActiveLine, setPreviewActiveLine] = useState(1)
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(null)
  const markdownRef = useRef(markdown)
  const lastActiveIdForPreviewRef = useRef<string | null>(null)

  const [aboutOpen, setAboutOpen] = useState(false)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const aiChatSessionKey: AiChatSessionKey = 'global'

  // Other States
  const [editorZoom, setEditorZoom] = useState(() => {
    if (typeof localStorage === 'undefined') return 1.0
    const stored = localStorage.getItem('haomd:editor:zoom')
    if (!stored) return 1.0
    const n = Number(stored)
    if (!Number.isFinite(n)) return 1.0
    const min = 0.75
    const max = 1.5
    if (n < min) return min
    if (n > max) return max
    return n
  })
  useEffect(() => {
    try {
      if (typeof localStorage === 'undefined') return
      localStorage.setItem('haomd:editor:zoom', String(editorZoom))
    } catch (e) {
      console.error('Failed to save editor zoom to localStorage', e)
    }
  }, [editorZoom])
  const [activeOutlineId, setActiveOutlineId] = useState<string | null>(null)
  const [isCreatingTab, setIsCreatingTab] = useState(false)
  const [foldRegions, setFoldRegions] = useState<{ fromLine: number; toLine: number }[]>([])
  const [inlineNewFileDir, setInlineNewFileDir] = useState<string | null>(null)
  const [inlineNewFolderDir, setInlineNewFolderDir] = useState<string | null>(null)
  const [focusRequest, setFocusRequest] = useState<{ localLine: number; searchText?: string } | null>(null)
  const [previewSelectionText, setPreviewSelectionText] = useState<string | null>(null)
  const pdfSelectionGetterRef = useRef<(() => string | null) | null>(null)
  const isProgrammaticScrollRef = useRef(false)

  // 将编辑器的实时行号节流后再传给预览，使用 rAF 节流（~16ms）降低重渲染频率
  const previewLineRafRef = useRef<number | null>(null)
  useEffect(() => {
    if (previewLineRafRef.current != null) {
      cancelAnimationFrame(previewLineRafRef.current)
    }
    previewLineRafRef.current = requestAnimationFrame(() => {
      previewLineRafRef.current = null
      setPreviewActiveLine((prev) => (prev !== activeLine ? activeLine : prev))
    })

    return () => {
      if (previewLineRafRef.current != null) {
        cancelAnimationFrame(previewLineRafRef.current)
        previewLineRafRef.current = null
      }
    }
  }, [activeLine])

  const {
    layout,
    setLayout,
    showPreview,
    setShowPreview,
    dragging,
    workspaceRef,
    effectiveLayout,
    gridTemplateColumns,
    previewWidthForRender,
    startDragging,
  } = useWorkspaceLayout()

  const isPreviewVisible = effectiveLayout !== 'editor-only'
  const prevIsPreviewVisibleRef = useRef(isPreviewVisible)

  // Sidebar resize hook
  const {
    sidebarWidth,
    isSidebarResizing,
    handleSidebarResizeStart,
  } = useSidebarResize({ activeLeftPanel })

  // Register closeCurrentTab callback
  const closeCurrentTabRef = useRef<(() => void) | null>(null)

  const {
    tabs,
    activeId,
    activeTab,
    createTab,
    setActiveTab,
    closeTab,
    closeCurrentTab,
    getUnsavedTabs,
    updateTabContent,
    updateActiveContent,
    updateActiveMeta,
  } = useTabs({
    onRequestCloseCurrentTab: () => {
      if (closeCurrentTabRef.current) {
        closeCurrentTabRef.current()
      }
    },
  })

  const isPdfActive = !!activeTab?.path && activeTab.path.toLowerCase().endsWith('.pdf')

  // AI Chat hook
  const {
    aiChatState,
    aiChatMode, setAiChatMode,
    aiChatOpen,
    aiChatDockSide, setAiChatDockSide,
    aiChatWidthLeft: _aiChatWidthLeft, aiChatWidthRight: _aiChatWidthRight,
    isAiChatResizing: _isAiChatResizing,
    docHistoryState,
    globalMemoryState,
    openAiChatDialog,
    closeAiChatDialog,
    openDocHistoryDialog,
    closeDocHistoryDialog,
    openGlobalMemoryDialog,
    closeGlobalMemoryDialog,
    handleAiChatResizeStart,
    outerGridTemplateColumns,
    aiChatWidth,
  } = useAiChatPanel({ activeTabId: activeTab?.id })

  const activeIdRef = useRef<string | null>(null)
  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  useEffect(() => {
    markdownRef.current = markdown
  }, [markdown])

  // HugeDoc hook
  const {
    hugeDocState: _hugeDocState,
    hugeDocStateRef: _hugeDocStateRef,
    hugeDocEnabled: _hugeDocEnabled,
    applyChunkEdit,
    getChunkContent,
    localToGlobal,
    focusOnGlobalLine,
  } = useHugeDoc({ markdown, markdownRef, activeLine })

  const closeTabWithAiSession = useCallback((id: string) => {
    // 按 tab 维度清理 AI Chat 会话
    aiChatSessionManager.deleteSession(id)
    closeTab(id)
  }, [closeTab])

  const sidebar = useSidebar()
  const editorViewRef = useRef<EditorView | null>(null)

  const openAboutDialog = useCallback(() => {
    setAboutOpen(true)
  }, [])

  const closeAboutDialog = useCallback(() => {
    setAboutOpen(false)
  }, [])

  const getCurrentMarkdown = useCallback(() => markdown, [markdown])
  const getCurrentFileName = useCallback(() => {
    const path = activeTab?.path
    if (!path) return null
    return path.split(/[/\\]/).pop() || path
  }, [activeTab])
  const getCurrentSelectionText = useCallback(() => {
    // PDF 标签：优先使用 PdfViewer 提供的实时选区 getter
    if (isPdfActive) {
      const getter = pdfSelectionGetterRef.current
      if (getter) {
        const text = getter()
        if (text && text.trim()) {
          return text
        }
      }
      return null
    }

    // 非 PDF：优先使用 Markdown 预览的选区
    if (previewSelectionText && previewSelectionText.trim()) {
      return previewSelectionText
    }

    // 回退到编辑器选区
    const view = editorViewRef.current
    if (!view || view.state.selection.main.empty) return null
    return view.state.doc.sliceString(view.state.selection.main.from, view.state.selection.main.to)
  }, [isPdfActive, previewSelectionText])

  const outlineItems = useOutline(markdown)

  const [confirmDialog, setConfirmDialog] = useState<any>(null)
  const [quitConfirmDialog, setQuitConfirmDialog] = useState<any>(null)
  const [isInsertTableDialogOpen, setIsInsertTableDialogOpen] = useState(false)
  const [recentDialogOpen, setRecentDialogOpen] = useState(false)

  // 用于在 useEffect 中访问最新的 setConfirmDialog
  const setConfirmDialogRef = useRef(setConfirmDialog)
  setConfirmDialogRef.current = setConfirmDialog

  // restoreCursorForPath 在 useCursorMemory 中定义（位于下方），
  // 这里用 ref 桥接，让 Sync Content effect 可以在不依赖其声明顺序的前提下调用。
  const restoreCursorRef = useRef<((path: string | null) => void) | null>(null)

  // Sync Content：切换激活标签时，同步内容，并仅在 tab 变化时重置 activeLine
  useEffect(() => {
    if (!activeId) return
    const tab = tabs.find((t) => t.id === activeId)
    if (!tab) return

    const isTabSwitch = lastActiveIdForPreviewRef.current !== activeId

    // 只有在切换标签页，或者外部强制更新了标签内容（且与当前编辑器不一致）时，才同步回编辑器
    // 这样避免了「输入 -> 更新 tabs -> tabs 触发 effect -> effect 用旧 tab.content 回滚输入」的循环
    if (isTabSwitch || tab.content !== markdownRef.current) {
      setMarkdown(tab.content)
      setPreviewValue(tab.content)

      if (isTabSwitch) {
        lastActiveIdForPreviewRef.current = activeId
        restoreCursorRef.current?.(tab.path ?? null)
      }
    }
  }, [activeId, tabs])

  // Window Title：不再显示文件名，保持标题栏空白
  useEffect(() => {
    const title = ''
    if (isTauriEnv()) {
      void invoke('set_title', { title }).catch(() => { })
    }
  }, [activeTab, isTauriEnv])

  // 如果当前激活标签对应的文件曾经是“从文件分组收编”的高亮文件，则视为已访问，移除高亮
  useEffect(() => {
    const path = activeTab?.path
    if (!path) return
    const normalized = path.replace(/\\/g, '/')
    if (sidebar.highlightedFiles.includes(normalized)) {
      sidebar.markFileVisited(normalized)
    }
  }, [activeTab?.path, sidebar])

  const {
    filePath,
    setFilePath,
    statusMessage,
    setStatusMessage,
    conflictError,
    setConflictError,
    clearRecentAll,
    save,
    saveAs,
    openFile,
    openFromPath,
    markDirty,
    hasUnsavedChanges,
    confirmLoseChanges,
    newDocument,
  } = useFilePersistence(markdown, {
    onSaved: (path: string) => {
      // 方案2：在父组件处理保存后的逻辑

      // 1. 更新标签元数据（名称和 dirty 状态）
      updateActiveMeta(path, false)

      // 2. 处理侧边栏文件列表
      const normalizedPath = path.replace(/\\/g, '/')
      const isUnderAnyRoot = sidebar.folderRoots.some((root) => {
        const rootNorm = root.replace(/\\/g, '/')
        return normalizedPath.startsWith(rootNorm + '/')
      })

      if (isUnderAnyRoot) {
        // 如果保存在已打开的文件夹中，刷新该文件夹
        const parentRoot = sidebar.folderRoots.find((root) => {
          const rootNorm = root.replace(/\\/g, '/')
          return normalizedPath.startsWith(rootNorm + '/')
        })
        if (parentRoot) {
          void sidebar.refreshFolderTree(parentRoot)
        }
      } else {
        // 否则添加到独立文件列表
        sidebar.addStandaloneFile(path)
      }
    }
  })

  // PDF Panel hook
  const {
    pdfRecent, pdfFolders, collapsedPdfFolders,
    pdfRecentLoading, pdfRecentError,
    pdfNotes, setPdfNotes,
    pdfMenuState, setPdfMenuState,
    pdfFolderMenuState, setPdfFolderMenuState,
    creatingPdfFolder, creatingPdfFolderName,
    renamingPdfFolderId, renamingPdfFolderName,
    closePdfMenu, closePdfFolderMenu,
    togglePdfFolderCollapse,
    refreshPdfRecent,
    handleCreatePdfFolder,
    handlePdfFolderInlineNameChange,
    handlePdfFolderInlineCancel,
    handlePdfFolderInlineConfirm,
    startPdfFolderRename,
    handlePdfFolderRenameChange,
    handlePdfFolderRenameCancel,
    handlePdfFolderRenameConfirm,
    handleDeletePdfFolder,
    movePdfToFolder,
    handleRemovePdfFromRecent,
  } = usePdfPanel({
    isTauriEnv,
    setStatusMessage,
    setConfirmDialog,
    activeLeftPanel,
  })

  const handleMarkdownChange = useCallback((val: string) => {
    const patchedDoc = applyChunkEdit(val)
    if (patchedDoc !== null) {
      setMarkdown(patchedDoc)
      markDirty()
      updateActiveContent(patchedDoc)
      return
    }

    // 普通模式：直接用整篇文档更新
    setMarkdown(val)
    markDirty()
    updateActiveContent(val)
  }, [applyChunkEdit, markDirty, updateActiveContent])

  // 当前激活的 PDF 文件路径（仅在 isPdfActive 时有值）
  const activePdfPath = isPdfActive ? activeTab?.path ?? null : null

  // AI Chat 使用的“文档路径”：
  // - Markdown 标签：使用当前文本文件的路径（filePath）
  // - PDF 标签：使用当前激活的 PDF 文件路径（activePdfPath）
  const aiChatFilePath = isPdfActive ? activePdfPath : filePath

  // 统一决定编辑器里展示的内容：
  // - Markdown 标签：走原来的 hugeDoc/markdown 逻辑
  // - PDF 标签：按路径从 pdfNotes 中取笔记
  const editorMarkdown = useMemo(() => {
    if (isPdfActive) {
      if (!activePdfPath) return ''
      return pdfNotes[activePdfPath] ?? ''
    }

    return getChunkContent() ?? markdown
  }, [isPdfActive, activePdfPath, pdfNotes, getChunkContent, markdown])

  // 统一的编辑器 onChange：
  // - PDF 标签：只更新 pdfNotes，不碰 markdown/tab 内容
  // - Markdown 标签：沿用原有 handleMarkdownChange
  const handleEditorChange = useCallback(
    (val: string) => {
      if (isPdfActive) {
        if (!activePdfPath) return
        setPdfNotes((prev) => {
          if (prev[activePdfPath] === val) return prev
          return { ...prev, [activePdfPath]: val }
        })
        return
      }

      handleMarkdownChange(val)
    },
    [isPdfActive, activePdfPath, handleMarkdownChange],
  )

  // Register AI Editor handlers
  useEffect(() => {
    const syncEditorToReactState = () => {
      const view = editorViewRef.current
      if (!view) return
      const next = view.state.doc.toString()
      handleMarkdownChange(next)
    }

    const runInsertBelow = (text: string) => {
      const view = editorViewRef.current
      if (!view || !text) return
      const { state } = view
      const pos = state.selection.main.head
      const line = state.doc.lineAt(pos)
      const insertText = '\n' + text
      view.dispatch(state.update({
        changes: { from: line.to, to: line.to, insert: insertText },
        selection: { anchor: line.to + insertText.length },
        scrollIntoView: true,
      }))
    }

    const runReplaceSelection = (text: string) => {
      const view = editorViewRef.current
      if (!view || !text) return
      const { state } = view
      const { from, to } = state.selection.main
      view.dispatch(state.update({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
        scrollIntoView: true,
      }))
    }

    registerEditorInsertBelow(async ({ text, sourceTabId }) => {
      if (!text) return

      const performInsert = () => {
        runInsertBelow(text)
        syncEditorToReactState()
      }

      const hasSourceTab = !!sourceTabId && tabs.some((t) => t.id === sourceTabId)

      if (hasSourceTab && activeIdRef.current !== sourceTabId) {
        // 切回发起 AI 动作的标签页，避免内容串到其他标签
        setActiveTab(sourceTabId)
        activeIdRef.current = sourceTabId
        setTimeout(performInsert, 50)
      } else {
        performInsert()
      }
    })

    registerEditorReplaceSelection(async ({ text, sourceTabId }) => {
      if (!text) return

      const performReplace = () => {
        runReplaceSelection(text)
        syncEditorToReactState()
      }

      const hasSourceTab = !!sourceTabId && tabs.some((t) => t.id === sourceTabId)

      if (hasSourceTab && activeIdRef.current !== sourceTabId) {
        setActiveTab(sourceTabId)
        activeIdRef.current = sourceTabId
        setTimeout(performReplace, 50)
      } else {
        performReplace()
      }
    })

    registerEditorCreateAndInsert(async (text: string) => {
      if (!text || isCreatingTab) return
      setIsCreatingTab(true)
      try {
        createTab({ content: text })
        await new Promise(resolve => setTimeout(resolve, 50))
      } finally {
        setIsCreatingTab(false)
      }
    })

    registerApplyHeadingLevel(async (level: number) => {
      const view = editorViewRef.current
      if (!view) return

      const { state } = view
      const head = state.selection.main.head
      const line = state.doc.lineAt(head)
      const rawText = line.text

      // 去掉已有的 # 和前导空格，只保留正文
      const withoutHashes = rawText.replace(/^\s*#{1,6}\s*/, '')
      const trimmed = withoutHashes.replace(/^\s+/, '')

      const safeLevel = Math.min(6, Math.max(1, level))
      const prefix = '#'.repeat(safeLevel) + ' '
      const nextLine = prefix + trimmed

      view.dispatch(state.update({
        changes: { from: line.from, to: line.to, insert: nextLine },
        selection: { anchor: line.from + nextLine.length },
        scrollIntoView: true,
      }))

      // 保持 React 状态与编辑器内容同步
      syncEditorToReactState()
    })

    registerResetHeadingToParagraph(async () => {
      const view = editorViewRef.current
      if (!view) return

      const { state } = view
      const head = state.selection.main.head
      const line = state.doc.lineAt(head)
      const rawText = line.text

      // 如果当前行是标题，去掉行首的 # 和多余空格，恢复普通文本
      const withoutHashes = rawText.replace(/^\s*#{1,6}\s*/, '')
      const nextLine = withoutHashes.replace(/^\s+/, '')

      view.dispatch(state.update({
        changes: { from: line.from, to: line.to, insert: nextLine },
        selection: { anchor: line.from + nextLine.length },
        scrollIntoView: true,
      }))

      syncEditorToReactState()
    })

    registerEmphasizeSelection(async () => {
      const view = editorViewRef.current
      if (!view) return

      const { state } = view
      const { from, to } = state.selection.main

      // 没有选区时不做处理
      if (from === to) return

      const selected = state.doc.sliceString(from, to)
      const emphasized = `**${selected}**`

      view.dispatch(state.update({
        changes: { from, to, insert: emphasized },
        selection: { anchor: from + emphasized.length },
        scrollIntoView: true,
      }))

      syncEditorToReactState()
    })

    registerInsertCodeBlock(async () => {
      const view = editorViewRef.current
      if (!view) return

      const { state } = view
      const doc = state.doc
      const sel = state.selection.main
      const head = sel.head
      const line = doc.lineAt(head)

      const fenceRe = /^```(\S*)\s*$/
      let lastLang: string | null = null

      for (let lineNo = line.number; lineNo >= 1; lineNo--) {
        const l = doc.line(lineNo)
        const m = fenceRe.exec(l.text)
        if (!m) continue

        const langCandidate = m[1] || ''
        if (langCandidate) {
          lastLang = langCandidate
          break
        }
        // 空 fence（```）不提供语言，继续向上寻找
      }

      const lang = lastLang ?? ''
      const firstLine = lang ? '```' + lang : '```'
      const snippet = firstLine + '\n\n```'

      const insertFrom = sel.from
      const insertTo = sel.to
      const cursorPos = insertFrom + firstLine.length + 1

      view.dispatch(state.update({
        changes: { from: insertFrom, to: insertTo, insert: snippet },
        selection: { anchor: cursorPos },
        scrollIntoView: true,
      }))

      syncEditorToReactState()
    })
  }, [createTab, isCreatingTab, setActiveTab, handleMarkdownChange, tabs])

  const getCurrentFilePath = useCallback(() => {
    if (isPdfActive) {
      return activePdfPath ?? null
    }
    return filePath ?? null
  }, [isPdfActive, activePdfPath, filePath])

  useEffect(() => {
    if (activeTab && !isPdfActive) setFilePath(activeTab.path)
  }, [activeTab, isPdfActive, setFilePath])

  const handleCurrentTabClose = useCallback(() => {
    if (isCreatingTab || !activeId) return
    const tab = tabs.find((t) => t.id === activeId)
    if (!tab) return
    if (tab.dirty) {
      setConfirmDialog({
        title: `Do you want to save changes to ${tab.title}?`,
        message: "Your changes will be lost if you don't save them.",
        confirmText: 'Save',
        cancelText: 'Cancel',
        extraText: "Don't Save",
        variant: 'stacked',
        onConfirm: async () => {
          setConfirmDialog(null)
          const res = await save()
          if ((res as any)?.ok !== false) closeTabWithAiSession(activeId)
        },
        onExtra: () => {
          setConfirmDialog(null)
          closeTabWithAiSession(activeId)
        }
      })
    } else {
      closeTabWithAiSession(activeId)
    }
  }, [isCreatingTab, activeId, tabs, closeTabWithAiSession, save])

  closeCurrentTabRef.current = handleCurrentTabClose

  const handleQuit = useCallback(() => {
    if (isCreatingTab) return
    const unsaved = getUnsavedTabs()

    // 无论是否存在未保存标签，都先弹出确认模态
    if (unsaved.length === 0) {
      setConfirmDialog({
        title: 'Quit HaoMD?',
        message: 'Are you sure you want to quit HaoMD?',
        confirmText: 'Quit',
        cancelText: 'Cancel',
        onConfirm: () => {
          setConfirmDialog(null)
          if (isTauriEnv()) invoke('quit_app').catch(() => { })
          else window.close()
        },
      })
      return
    }

    // 存在未保存标签：使用带 Save All / Don't Save 的退出确认对话框
    setQuitConfirmDialog({
      unsavedCount: unsaved.length,
      onSaveAll: async () => {
        setQuitConfirmDialog(null)
        for (const tab of unsaved) {
          setActiveTab(tab.id)
          await new Promise(r => setTimeout(r, 10))
          const res = await save()
          if ((res as any)?.ok === false) return
        }
        if (isTauriEnv()) invoke('quit_app').catch(() => { })
        else window.close()
      },
      onQuitWithoutSaving: () => {
        setQuitConfirmDialog(null)
        if (isTauriEnv()) invoke('quit_app').catch(() => { })
        else window.close()
      }
    })
  }, [isCreatingTab, getUnsavedTabs, isTauriEnv, save, setActiveTab, setConfirmDialog])

  // 预览内容只在预览可见时才节流同步，避免 editor-only 模式下做无意义渲染
  useEffect(() => {
    if (!isPreviewVisible) return

    const timer = setTimeout(() => setPreviewValue(markdown), 150)
    return () => clearTimeout(timer)
  }, [markdown, isPreviewVisible])

  // 当预览从不可见切换为可见时，立即用最新 markdown 做一次全量同步
  useEffect(() => {
    if (!prevIsPreviewVisibleRef.current && isPreviewVisible) {
      setPreviewValue(markdown)
    }
    prevIsPreviewVisibleRef.current = isPreviewVisible
  }, [isPreviewVisible, markdown])

  // 轻量节流的字数统计：在用户停止输入一小段时间后上报当前文档的总字数
  useEffect(() => {
    if (!onDocumentStatsChange) return

    // PDF 标签：当前编辑器内容对应的是笔记，而不是正文，这里不统计
    if (isPdfActive) {
      onDocumentStatsChange({ charCount: null })
      return
    }

    const textForCount = markdown
    let cancelled = false

    const timer = window.setTimeout(() => {
      if (cancelled) return
      const count = countDocumentChars(textForCount)
      onDocumentStatsChange({ charCount: count })
    }, 500)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [markdown, isPdfActive, onDocumentStatsChange])

  const applyOpenedContent = useCallback((content: string) => {
    setMarkdown(content)
    setPreviewValue(content)
    setActiveLine(1)
    // 注意：不再调用 updateActiveContent。调用方 (open_file 命令) 在此之前已通过
    // createTab({ path, content }) 创建了新标签并设置了内容。而 updateActiveContent
    // 闭包中的 activeId 仍指向旧标签，会误将旧标签内容覆写为新文件内容。
  }, [])

  const saveWithPdfGuard = useCallback(async () => {
    if (isPdfActive) {
      setStatusMessage('当前为 PDF 标签，保存命令仅适用于 Markdown 文档')
      return { ok: false as const, error: { code: 'UNSUPPORTED', message: '当前标签为 PDF，不支持保存', traceId: undefined } }
    }
    return await save()
  }, [isPdfActive, save, setStatusMessage])

  const saveAsWithPdfGuard = useCallback(async () => {
    if (isPdfActive) {
      setStatusMessage('当前为 PDF 标签，保存命令仅适用于 Markdown 文档')
      return { ok: false as const, error: { code: 'UNSUPPORTED', message: '当前标签为 PDF，不支持另存为', traceId: undefined } }
    }
    return await saveAs()
  }, [isPdfActive, saveAs, setStatusMessage])

  const markPendingRestoreRef = useRef<((tabId: string) => void) | null>(null)

  const openFileInNewTab = useCallback(async (path: string) => {
    if (isCreatingTab) return { ok: false } as any

    const isPdf = path.toLowerCase().endsWith('.pdf')

    if (isPdf) {
      // PDF 文件：不通过文本读取管线，直接新建只读标签，由 PdfViewer 负责展示
      const tab = createTab({ path, content: '' })
      // 对于 PDF，不更新 markdown/preview 内容，保持当前文档内容不变
      setActiveTab(tab.id)
      return { ok: true, data: { path } } as any
    }

    const resp = await openFromPath(path)
    if (resp.ok) {
      const tab = createTab({ path: resp.data.path, content: '' })
      updateTabContent(tab.id, resp.data.content, { markDirty: false })
      setMarkdown(resp.data.content)
      setPreviewValue(resp.data.content)
      // 标记该标签页需要在编辑器就绪时恢复光标位置
      markPendingRestoreRef.current?.(tab.id)
    }
    return resp
  }, [isCreatingTab, openFromPath, createTab, updateTabContent, setMarkdown, setPreviewValue, setActiveTab])

  const openFileFromSidebar = useCallback(async (path: string) => {
    if (isCreatingTab) return { ok: false } as any
    // 点击文件时，清空文件夹选中状态
    setSelectedFolderPath(null)
    const existing = tabs.find(t => t.path === path)
    if (existing) {
      setActiveTab(existing.id)
      return { ok: true, data: { path: existing.path } } as any
    }
    return await openFileInNewTab(path)
  }, [isCreatingTab, tabs, setActiveTab, openFileInNewTab])

  const openRecentFileInNewTab = useCallback(async (path: string) => {
    // 复用 Sidebar 打开逻辑：如果已存在同路径标签，只激活，不新建
    const resp = await openFileFromSidebar(path)
    if (resp?.ok) sidebar.addStandaloneFile(resp.data.path)
    return resp
  }, [openFileFromSidebar, sidebar])

  const openFolderInSidebar = useCallback(async () => {
    if (!isTauriEnv()) return
    const selected = await openDialog({ directory: true, multiple: false })
    if (selected) {
      const path = Array.isArray(selected) ? selected[0] : selected
      await sidebar.openFolderAsRoot(path as string)
    }
  }, [isTauriEnv, sidebar])

  const closeTabsByPath = useCallback((path: string) => {
    tabs.forEach(t => { if (t.path === path) closeTabWithAiSession(t.id) })
  }, [tabs, closeTabWithAiSession])

  const normalizeDirPath = (dir: string): string => {
    if (!dir) return dir
    return dir.replace(/\\/g, '/').replace(/[\\/]+$/, '')
  }

  const generateUniqueMarkdownPath = async (baseFolder: string, rawName: string): Promise<string | null> => {
    const trimmed = rawName.trim()
    if (!trimmed) return null

    if (/[\\/]/.test(trimmed)) {
      setStatusMessage('文件名中不能包含路径分隔符')
      return null
    }

    // 规则：
    // - 输入 demo       → demo.md
    // - 输入 demo.html → demo.html
    // - 输入 demo.md   → demo.md
    const fileName = trimmed
    const dotIndex = fileName.lastIndexOf('.')
    const hasExt = dotIndex > 0 && dotIndex < fileName.length - 1
    const baseName = hasExt ? fileName.slice(0, dotIndex) : fileName
    const ext = hasExt ? fileName.slice(dotIndex) : '.md'

    const normalizedFolder = normalizeDirPath(baseFolder)

    const resp = await listFolder(normalizedFolder)
    if (!resp.ok) {
      setStatusMessage(resp.error.message)
      return null
    }

    const usedNames = new Set(resp.data.map((e) => e.name.toLowerCase()))

    let index = 1
    let candidateName = ''
    while (true) {
      candidateName = index === 1 ? `${baseName}${ext}` : `${baseName}${index}${ext}`
      if (!usedNames.has(candidateName.toLowerCase())) break
      index += 1
    }

    return `${normalizedFolder}/${candidateName}`
  }

  const generateUniqueFolderPath = async (baseFolder: string, rawName: string): Promise<string | null> => {
    const trimmed = rawName.trim()
    console.log('[WorkspaceShell.generateUniqueFolderPath] start', { baseFolder, rawName, trimmed })
    if (!trimmed) {
      console.log('[WorkspaceShell.generateUniqueFolderPath] empty-name, abort')
      return null
    }

    if (/[\\/]/.test(trimmed)) {
      console.log('[WorkspaceShell.generateUniqueFolderPath] invalid-name-has-separator', { trimmed })
      setStatusMessage('文件夹名中不能包含路径分隔符')
      return null
    }

    const normalizedFolder = normalizeDirPath(baseFolder)
    console.log('[WorkspaceShell.generateUniqueFolderPath] normalizedFolder =', normalizedFolder)

    const resp = await listFolder(normalizedFolder)
    console.log('[WorkspaceShell.generateUniqueFolderPath] listFolder resp =', resp)
    if (!resp.ok) {
      setStatusMessage(resp.error.message)
      return null
    }

    const usedNames = new Set(resp.data.map((e) => e.name.toLowerCase()))

    let index = 1
    let candidateName = ''
    while (true) {
      candidateName = index === 1 ? trimmed : `${trimmed} ${index}`
      if (!usedNames.has(candidateName.toLowerCase())) break
      index += 1
    }

    const fullPath = `${normalizedFolder}/${candidateName}`
    console.log('[WorkspaceShell.generateUniqueFolderPath] resolved fullPath =', fullPath)
    return fullPath
  }

  const computeDirFromPath = (targetPath: string): string => {
    if (!targetPath) return targetPath

    const hasBackslash = targetPath.includes('\\')
    const normalized = targetPath.replace(/[\\/]/g, '/')
    const lastSlash = normalized.lastIndexOf('/')

    if (lastSlash <= 0) {
      return targetPath
    }

    let dir = normalized.slice(0, lastSlash)
    if (hasBackslash) {
      dir = dir.replace(/\//g, '\\')
    }

    return dir
  }

  const getCurrentFolderForNewFile = (): string | null => {
    // 优先使用选中的文件夹
    if (selectedFolderPath) {
      return selectedFolderPath
    }
    // 否则使用当前文件的父目录
    if (activeTab?.path) {
      return computeDirFromPath(activeTab.path)
    }
    // 最后使用第一个根文件夹
    if (sidebar.folderRoots.length > 0) {
      return sidebar.folderRoots[0]
    }
    setStatusMessage('请先打开一个文件或文件夹')
    return null
  }

  const getTargetFolderForNewFolder = (): string | null => {
    // 选中文件夹 → 在其内部创建子文件夹
    if (selectedFolderPath) {
      return selectedFolderPath
    }
    // 选中文件 → 在同级目录创建文件夹
    if (activeTab?.path) {
      return computeDirFromPath(activeTab.path)
    }
    // 默认使用第一个根文件夹
    if (sidebar.folderRoots.length > 0) {
      return sidebar.folderRoots[0]
    }
    setStatusMessage('请先打开一个文件或文件夹')
    return null
  }

  const handleDirClick = useCallback((path: string) => {
    setSelectedFolderPath(path)
  }, [])

  const handleToolbarNewFileInCurrentFolder = useCallback(() => {
    if (isCreatingTab) {
      setStatusMessage('正在创建新标签，请稍候…')
      return
    }

    const baseFolder = getCurrentFolderForNewFile()
    if (!baseFolder) return

    // 确保目标文件夹展开
    sidebar.expandPath(baseFolder)
    setInlineNewFileDir(baseFolder)
  }, [isCreatingTab, getCurrentFolderForNewFile, setStatusMessage, sidebar])

  const handleInlineNewFileConfirm = useCallback((rawName: string) => {
    if (!inlineNewFileDir) return

    void (async () => {
      const fullPath = await generateUniqueMarkdownPath(inlineNewFileDir, rawName)
      if (!fullPath) {
        setInlineNewFileDir(null)
        return
      }

      const writeResp = await writeFile({ path: fullPath, content: '' })
      if (!writeResp.ok) {
        setStatusMessage(writeResp.error.message)
        return
      }

      const existingTab = tabs.find((t) => t.path === fullPath)
      if (existingTab) {
        setActiveTab(existingTab.id)
      } else {
        const tab = createTab({ path: fullPath, content: '' })
        setActiveTab(tab.id)
      }

      // 清空文件夹选中状态，让侧边栏高亮显示新建的文件
      setSelectedFolderPath(null)

      const normalized = fullPath.replace(/\\/g, '/')
      const root = sidebar.folderRoots.find((rootPath) => {
        const rootNorm = rootPath.replace(/\\/g, '/')
        return normalized === rootNorm || normalized.startsWith(rootNorm + '/')
      }) ?? sidebar.folderRoots[0]

      if (root) {
        void sidebar.refreshFolderTree(root)
      }

      setInlineNewFileDir(null)
    })()
  }, [inlineNewFileDir, tabs, setActiveTab, createTab, setStatusMessage, sidebar.folderRoots, sidebar])

  const handleInlineNewFileCancel = useCallback(() => {
    setInlineNewFileDir(null)
  }, [])

  const handleToolbarNewFolderInCurrentFolder = useCallback(() => {
    if (isCreatingTab) {
      setStatusMessage('正在创建新标签，请稍候…')
      return
    }

    const targetFolder = getTargetFolderForNewFolder()
    if (!targetFolder) return

    // 确保目标文件夹展开
    sidebar.expandPath(targetFolder)
    setInlineNewFolderDir(targetFolder)
  }, [isCreatingTab, getTargetFolderForNewFolder, setStatusMessage, sidebar])

  const handleInlineNewFolderConfirm = useCallback((rawName: string) => {
    console.log('[WorkspaceShell.handleInlineNewFolderConfirm] called', { rawName, inlineNewFolderDir })
    if (!inlineNewFolderDir) {
      console.log('[WorkspaceShell.handleInlineNewFolderConfirm] no inlineNewFolderDir, abort')
      return
    }

    void (async () => {
      const folderPath = await generateUniqueFolderPath(inlineNewFolderDir, rawName)
      console.log('[WorkspaceShell.handleInlineNewFolderConfirm] folderPath =', folderPath)
      if (!folderPath) {
        console.log('[WorkspaceShell.handleInlineNewFolderConfirm] folderPath null, clear inlineNewFolderDir')
        setInlineNewFolderDir(null)
        return
      }

      const resp = await createFolder(folderPath)
      console.log('[WorkspaceShell.handleInlineNewFolderConfirm] createFolder resp =', resp)
      if (!resp.ok) {
        setStatusMessage(resp.error.message)
        return
      }

      // 选中新建的文件夹
      setSelectedFolderPath(folderPath)

      // 刷新父文件夹树
      const normalized = folderPath.replace(/\\/g, '/')
      const root = sidebar.folderRoots.find((rootPath) => {
        const rootNorm = rootPath.replace(/\\/g, '/')
        return normalized.startsWith(rootNorm + '/')
      }) ?? sidebar.folderRoots[0]

      console.log('[WorkspaceShell.handleInlineNewFolderConfirm] refresh root =', root)
      if (root) {
        void sidebar.refreshFolderTree(root)
      }

      setInlineNewFolderDir(null)
    })()
  }, [inlineNewFolderDir, setStatusMessage, sidebar.folderRoots, sidebar])

  const handleInlineNewFolderCancel = useCallback(() => {
    setInlineNewFolderDir(null)
  }, [])

  const handleToolbarRefreshCurrentFolder = useCallback(() => {
    const baseFolder = getCurrentFolderForNewFile()
    if (!baseFolder) return

    const normalizedBase = baseFolder.replace(/\\/g, '/')
    const root = sidebar.folderRoots.find((rootPath) => {
      const rootNorm = rootPath.replace(/\\/g, '/')
      return normalizedBase === rootNorm || normalizedBase.startsWith(rootNorm + '/')
    }) ?? sidebar.folderRoots[0]

    if (root) {
      void sidebar.refreshFolderTree(root)
    }
  }, [getCurrentFolderForNewFile, sidebar.folderRoots, sidebar])

  const handleSidebarContextAction = useCallback(async (payload: SidebarContextActionPayload) => {
    const { path, kind, action } = payload
    if (action === 'open') {
      await openFileFromSidebar(path)
    } else if (action === 'remove') {
      if (kind === 'standalone-file') sidebar.removeStandaloneFile(path)
      else sidebar.removeFolderRoot(path)
    } else if (action === 'delete') {
      setConfirmDialog({
        title: 'Confirm Delete',
        message: `Are you sure you want to delete ${path}?`,
        confirmText: 'Delete',
        onConfirm: async () => {
          setConfirmDialog(null)
          const resp = await deleteFsEntry(path)
          if (resp.ok) {
            // 根据文件类型执行不同的刷新逻辑
            if (kind === 'standalone-file') {
              // 独立文件：从列表中移除
              sidebar.removeStandaloneFile(path)
            } else if (kind === 'tree-file' || kind === 'tree-dir') {
              // 文件夹中的文件/文件夹：找到所属根目录并刷新
              const normalizedPath = path.replace(/\\/g, '/')
              const parentRoot = sidebar.folderRoots.find((root) => {
                const rootNorm = root.replace(/\\/g, '/')
                return normalizedPath.startsWith(rootNorm + '/')
              })
              if (parentRoot) {
                await sidebar.refreshFolderTree(parentRoot)
              }
            } else if (kind === 'folder-root') {
              // 根文件夹：从 folderRoots 中移除
              sidebar.removeFolderRoot(path)
            }

            // 关闭相关标签页
            closeTabsByPath(path)
          }
        }
      })
    } else if (action === 'open-terminal') {
      // 对文件：取所在目录；对文件夹：直接使用其自身路径
      const cwd = kind === 'standalone-file' || kind === 'tree-file'
        ? computeDirFromPath(path)
        : path

      const result = await openTerminalAt(cwd)
      if (!result.ok && result.message) {
        setStatusMessage(result.message)
      }
    } else if (action === 'open-in-file-manager') {
      const targetPath = kind === 'standalone-file' || kind === 'tree-file'
        ? computeDirFromPath(path)
        : path

      const result = await openInFileManager(targetPath)
      if (!result.ok && result.message) {
        setStatusMessage(result.message)
      }
    }
  }, [openFileFromSidebar, sidebar, closeTabsByPath, setStatusMessage])

  useEffect(() => {
    const unlisten = onOpenRecentFile(({ path, isFolder }) => {
      if (isFolder) {
        void sidebar.openFolderAsRoot(path)
      } else {
        void openRecentFileInNewTab(path)
      }
    })
    return () => unlisten()
  }, [openRecentFileInNewTab, sidebar])

  const isExportingHtmlRef = useRef(false)
  const isExportingPdfRef = useRef(false)
  const activeTabPathRef = useRef<string | null>(null)

  // 同步 Ref 以保持回调函数稳定
  useEffect(() => {
    activeTabPathRef.current = activeTab?.path ?? null
  }, [activeTab?.path])

  const handleExportHtml = useCallback(async () => {
    // 防重入
    if (isExportingHtmlRef.current) {
      setStatusMessage('正在准备导出，请稍候...')
      return
    }

    isExportingHtmlRef.current = true
    try {
      // --- 关键优化：动态加载整个导出模块 ---
      // 这样生成的代码体积和运行时开销在不点击导出时为 0
      const { exportToHtml: dynamicExport } = await import('../modules/export/html')

      await dynamicExport({
        setStatusMessage,
        getCurrentMarkdown,
        getCurrentFileName,
        getFilePath: () => activeTabPathRef.current
      })
    } catch (e) {
      console.error('[Export] 动态加载失败:', e)
      setStatusMessage('导出功能加载失败，请重试')
    } finally {
      isExportingHtmlRef.current = false
    }
  }, [setStatusMessage, getCurrentMarkdown, getCurrentFileName])

  const handleExportPdf = useCallback(async () => {
    console.log('[WorkspaceShell] 预备导出 PDF...')
    // 防重入
    if (isExportingPdfRef.current) {
      setStatusMessage('正在准备导出，请稍候...')
      return
    }

    isExportingPdfRef.current = true
    try {
      const { exportToPdf: dynamicPdfExport } = await import('../modules/export/pdf')

      await dynamicPdfExport({
        setStatusMessage,
        getCurrentMarkdown,
        getCurrentFileName,
        getFilePath: () => activeTabPathRef.current
      })
    } catch (e) {
      console.error('[Export PDF] 动态加载失败:', e)
      setStatusMessage('PDF 导出加载失败，请重试')
    } finally {
      isExportingPdfRef.current = false
    }
  }, [setStatusMessage, getCurrentMarkdown, getCurrentFileName])

  const openInsertTableDialog = useCallback(() => {
    if (isPdfActive) {
      setStatusMessage('当前为 PDF 标签，暂不支持插入 Markdown 表格')
      return
    }
    setIsInsertTableDialogOpen(true)
  }, [isPdfActive, setStatusMessage])

  const generateMarkdownTable = useCallback((rows: number, cols: number): string => {
    const safeRows = Math.max(1, rows)
    const safeCols = Math.max(1, cols)

    const headerCells = Array.from({ length: safeCols }, (_, i) => `Col ${i + 1}`)
    const header = `| ${headerCells.join(' | ')} |`

    const separatorCells = Array.from({ length: safeCols }, () => '---')
    const separator = `| ${separatorCells.join(' | ')} |`

    const bodyRow = `| ${Array.from({ length: safeCols }, () => '').join(' | ')} |`
    const body = Array.from({ length: safeRows }, () => bodyRow).join('\n')

    return `${header}\n${separator}\n${body}\n`
  }, [])

  const handleInsertTableConfirm = useCallback(
    async (rows: number, cols: number) => {
      setIsInsertTableDialogOpen(false)

      if (isPdfActive) {
        setStatusMessage('当前为 PDF 标签，暂不支持插入 Markdown 表格')
        return
      }

      const tableMarkdown = generateMarkdownTable(rows, cols)
      await insertMarkdownAtCursorBelow(tableMarkdown)
    },
    [generateMarkdownTable, insertMarkdownAtCursorBelow, isPdfActive, setStatusMessage],
  )

  const { dispatchAction } = useCommandSystem({
    layout, setLayout: setLayout as any, setShowPreview, setStatusMessage,
    aiChatMode, setAiChatMode, aiChatDockSide, setAiChatDockSide, aiChatOpen,
    editorZoom, setEditorZoom,
    confirmLoseChanges, hasUnsavedChanges, newDocument, setFilePath, applyOpenedContent,
    openFile, save: saveWithPdfGuard, saveAs: saveAsWithPdfGuard, handleShowRecent: undefined, clearRecentAll,
    createTab, updateActiveMeta, openFolderInSidebar, closeCurrentTab,
    openSearch: () => setIsSearchOpen(true),
    openInsertTableDialog,
    openAiChatDialog: (options: any) => openAiChatDialog(options as any),
    closeAiChatDialog,
    openGlobalMemoryDialog,
    openAboutDialog,
    getCurrentMarkdown, getCurrentFileName, getCurrentSelectionText, getCurrentFilePath,
    onRequestCloseCurrentTab: () => closeCurrentTabRef.current?.(),
    onRequestQuit: handleQuit, isTauriEnv,
    addStandaloneFile: sidebar.addStandaloneFile,
    openDocConversationsHistory: (docPath: string) => openDocHistoryDialog(docPath),
    refreshPdfRecent,
    exportHtml: handleExportHtml,
    exportPdf: handleExportPdf,
    openRecentDialog: () => setRecentDialogOpen(true),
  } as any)

  const aiChatCommandBridge = useMemo(
    () => ({
      runAppCommand: (id: string) => dispatchAction(id),
    }),
    [dispatchAction],
  )

  useNativePaste(editorViewRef, setStatusMessage)

  // 粘贴图片：通过 native://paste_image 事件桥接（Cmd/Ctrl+V），保存到 images 目录并插入 Markdown 链接
  useEffect(() => {
    console.log('[WorkspaceShell] image paste effect mounted')
    const unlisten = onNativePasteImage(async () => {
      console.log('[WorkspaceShell] onNativePasteImage fired')
      const view = editorViewRef.current
      if (!view) {
        console.warn('[WorkspaceShell] onNativePasteImage: no editor view')
        return
      }

      // 仅当焦点在编辑器内部时才处理粘贴，避免与其他输入框冲突
      if (typeof document !== 'undefined') {
        const active = document.activeElement
        const contains = active ? view.dom.contains(active) : false
        console.log('[WorkspaceShell] onNativePasteImage: active in editor =', contains)
        if (active && !contains) {
          return
        }
      }

      if (!filePath || filePath === 'untitled.md') {
        console.warn('[WorkspaceShell] onNativePasteImage: no filePath, cannot determine images dir')
        setConfirmDialogRef.current({
          title: 'Cannot Insert Image',
          message: 'Please save the file first (Ctrl/Cmd+S) before inserting images.',
          confirmText: 'OK',
          onConfirm: () => setConfirmDialogRef.current(null),
        })
        return
      }

      const cfg = loadDefaultImagePathStrategyConfig()
      const { targetDir, relDir } = resolveImageTarget(filePath, null, cfg)
      console.log('[WorkspaceShell] onNativePasteImage: resolved targetDir=', targetDir, 'relDir=', relDir)

      // 根据当前文件名构造图片命名前缀：image_当前文件名（去掉扩展名）
      const fileBaseName = (() => {
        const pathPart = filePath.split(/[/\\]/).pop() || ''
        const withoutExt = pathPart.replace(/\.[^./\\]+$/, '')
        return withoutExt || 'untitled'
      })()
      const suggestedName = `image_${fileBaseName}`
      console.log('[WorkspaceShell] onNativePasteImage: suggestedName =', suggestedName)

      try {
        const result = await invoke('save_clipboard_image_to_dir', {
          targetDir,
          suggestedName,
        }) as any
        console.log('[WorkspaceShell] onNativePasteImage: invoke result =', result)

        // 后端返回的是 ResultPayload<T>，形如 { Ok: { data: { file_name }, trace_id }, Err: { error } }
        const okPart = result && 'Ok' in result ? result.Ok : null
        if (!okPart) {
          console.error('[WorkspaceShell] onNativePasteImage: backend returned Err', result?.Err)
          setStatusMessage(result?.Err?.error?.message || '粘贴图片失败：后端错误')
          return
        }

        const fileName = okPart?.data?.file_name as string | undefined
        if (!fileName) {
          console.error('[WorkspaceShell] onNativePasteImage: missing file_name in Ok.data')
          setStatusMessage('粘贴图片失败：后端未返回文件名')
          return
        }

        const relPath = `${relDir}/${fileName}`
        const snippet = `
![图片](${relPath})
`
        console.log('[WorkspaceShell] onNativePasteImage: inserting snippet', snippet)

        const { state } = view
        const { from, to } = state.selection.main
        view.dispatch(state.update({
          changes: { from, to, insert: snippet },
          selection: { anchor: from + snippet.length },
          scrollIntoView: true,
        }))
      } catch (err) {
        console.error('[WorkspaceShell] onNativePasteImage: invoke failed', err)
        setStatusMessage(`粘贴图片失败：${String(err)}`)
      }
    })

    return () => {
      unlisten()
    }
  }, [editorViewRef, filePath, setStatusMessage])

  const saveCursorPositionRef = useRef<((globalLine: number) => void) | null>(null)

  const handleCursorChange = useCallback((localLine: number) => {
    // 程序性滚动期间不更新 activeLine，避免触发大文档 effect 重算 chunk
    if (isProgrammaticScrollRef.current) return

    const globalLine = localToGlobal(localLine)
    setActiveLine(globalLine)

    saveCursorPositionRef.current?.(globalLine)
  }, [localToGlobal, setActiveLine])

  const focusEditorOnGlobalLine = useCallback((globalLine: number, searchText?: string) => {
    const safeGlobal = globalLine > 0 ? globalLine : 1
    const result = focusOnGlobalLine(safeGlobal, searchText)
    setActiveLine(safeGlobal)
    setFocusRequest(result)
  }, [focusOnGlobalLine])

  // Cursor memory hook
  const {
    saveCursorPosition,
    restoreCursorForPath,
    handleEditorReady,
    markPendingRestore,
  } = useCursorMemory({
    activeId,
    tabs,
    isPdfActive,
    getCurrentFilePath,
    focusEditorOnGlobalLine,
  })
  restoreCursorRef.current = restoreCursorForPath
  saveCursorPositionRef.current = saveCursorPosition
  markPendingRestoreRef.current = markPendingRestore

  const handlePreviewLineClick = useCallback((line: number) => {
    focusEditorOnGlobalLine(line)
  }, [focusEditorOnGlobalLine])

  const handleOutlineSelect = useCallback((item: OutlineItem) => {
    setActiveOutlineId(item.id)
    if (effectiveLayout === 'preview-only') setLayout('preview-left')
    focusEditorOnGlobalLine(item.line, item.searchText)
  }, [effectiveLayout, setLayout, focusEditorOnGlobalLine])

  const handleTabSaveAndClose = useCallback(async (id: string) => {
    const isActive = id === activeId
    const tab = tabs.find(t => t.id === id)
    if (!isActive) {
      setConfirmDialog({
        title: 'Cannot save background tab',
        message: `Close ${tab?.title} and discard changes?`,
        confirmText: 'Discard and Close',
        onConfirm: () => { setConfirmDialog(null); closeTabWithAiSession(id); }
      })
    } else {
      handleCurrentTabClose()
    }
  }, [activeId, tabs, closeTabWithAiSession, handleCurrentTabClose])

  const initialActionHandledRef = useRef(false)
  useEffect(() => {
    if (!initialAction || initialActionHandledRef.current) return
    if (initialAction === 'new') createTab()
    else if (initialAction === 'open') openFile()
    else if (initialAction === 'open_folder') openFolderInSidebar()
    else if (initialAction === 'open_recent' && initialOpenRecentPath) {
      if (initialOpenRecentIsFolder) {
        void sidebar.openFolderAsRoot(initialOpenRecentPath)
      } else {
        void openRecentFileInNewTab(initialOpenRecentPath)
      }
    }
    initialActionHandledRef.current = true
    onInitialActionHandled?.()
  }, [
    initialAction,
    initialOpenRecentPath,
    initialOpenRecentIsFolder,
    createTab,
    openFile,
    openFolderInSidebar,
    openRecentFileInNewTab,
    sidebar,
    onInitialActionHandled,
  ])

  return (
    <AiChatCommandBridgeContext.Provider value={aiChatCommandBridge}>
      <>
        {activeLeftPanel === 'files' && (
          <Sidebar
            standaloneFiles={sidebar.standaloneFiles} folderRoots={sidebar.folderRoots}
            treesByRoot={sidebar.treesByRoot} expanded={sidebar.expanded}
            onToggle={sidebar.toggleNode} onFileClick={openFileFromSidebar}
            onDirClick={handleDirClick}
            onContextAction={handleSidebarContextAction} activePath={selectedFolderPath ?? activeTab?.path ?? null}
            panelWidth={sidebarWidth}
            highlightedPaths={sidebar.highlightedFiles}
            onFileVisited={sidebar.markFileVisited}
            onToolbarNewFileInCurrentFolder={handleToolbarNewFileInCurrentFolder}
            onToolbarNewFolderInCurrentFolder={handleToolbarNewFolderInCurrentFolder}
            onToolbarRefreshCurrentFolder={handleToolbarRefreshCurrentFolder}
            inlineNewFileDir={inlineNewFileDir}
            onInlineNewFileConfirm={handleInlineNewFileConfirm}
            onInlineNewFileCancel={handleInlineNewFileCancel}
            inlineNewFolderDir={inlineNewFolderDir}
            onInlineNewFolderConfirm={handleInlineNewFolderConfirm}
            onInlineNewFolderCancel={handleInlineNewFolderCancel}
            onRequestConfirmDeleteFileVirtualFolder={({ folder, onConfirm }) => {
              setConfirmDialog({
                title: '删除虚拟文件夹',
                message: `确认删除虚拟文件夹 “${folder.name}”？其中的文件会移回根列表。`,
                confirmText: '删除',
                cancelText: '取消',
                onConfirm: () => {
                  setConfirmDialog(null)
                  onConfirm()
                },
              })
            }}
            onNotify={setStatusMessage}
          />
        )}
        {activeLeftPanel === 'outline' && (
          <OutlinePanel items={outlineItems} activeId={activeOutlineId} onSelect={handleOutlineSelect} panelWidth={sidebarWidth} />
        )}
        {activeLeftPanel === 'pdf' && (
          <div className="pdf-panel" style={{ width: sidebarWidth }}>
            <div className="pdf-panel-header">
              <span>PDF</span>
              <button
                type="button"
                className="pdf-folder-add-btn"
                title="新建虚拟文件夹"
                onClick={() => handleCreatePdfFolder()}
              >
                +
              </button>
            </div>
            <div className="pdf-panel-content">
              {creatingPdfFolder && (
                <div className="pdf-folder-inline-create sidebar-virtual-folder-inline-create">
                  <input
                    type="text"
                    className="pdf-folder-inline-input sidebar-virtual-folder-inline-input"
                    placeholder="输入虚拟文件夹名称后按回车确认，Esc 取消"
                    autoFocus
                    value={creatingPdfFolderName}
                    onChange={(e) => handlePdfFolderInlineNameChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handlePdfFolderInlineConfirm()
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        handlePdfFolderInlineCancel()
                      }
                    }}
                  />
                </div>
              )}
              {pdfRecentLoading && (
                <p style={{ color: '#9ca3af', padding: '12px', fontSize: '13px' }}>正在加载最近的 PDF...</p>
              )}
              {!pdfRecentLoading && pdfRecentError && (
                <p style={{ color: '#f97373', padding: '12px', fontSize: '13px' }}>{pdfRecentError}</p>
              )}
              {!pdfRecentLoading && !pdfRecentError && pdfRecent.length === 0 && (
                <p style={{ color: '#9ca3af', padding: '12px', fontSize: '13px' }}>
                  No recent PDFs. Use File → Open to open a PDF file.
                </p>
              )}
              {!pdfRecentLoading && !pdfRecentError && pdfRecent.length > 0 && (
                <>
                  {/* 根列表：未分配虚拟文件夹的 PDF */}
                  {pdfRecent.filter((item) => !item.folderId).length > 0 && (
                    <ul className="pdf-recent-list">
                      {pdfRecent.filter((item) => !item.folderId).map((item) => {
                        const name = item.displayName || item.path.split(/[/\\]/).pop() || item.path
                        const isActive = activeTab?.path === item.path
                        return (
                          <li
                            key={item.path}
                            className={`pdf-recent-item ${isActive ? 'active' : ''}`}
                            onClick={() => { void openRecentFileInNewTab(item.path) }}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              setPdfMenuState({
                                visible: true,
                                x: e.clientX,
                                y: e.clientY,
                                targetPath: item.path,
                              })
                            }}
                          >
                            <div className="pdf-recent-title">{name}</div>
                          </li>
                        )
                      })}
                    </ul>
                  )}

                  {/* 虚拟文件夹分组 */}
                  {pdfFolders.map((folder) => {
                    const items = pdfRecent.filter((item) => item.folderId === folder.id)
                    const isCollapsed = collapsedPdfFolders[folder.id] ?? false
                    const isRenaming = renamingPdfFolderId === folder.id
                    return (
                      <div key={folder.id} className="pdf-folder-section">
                        <div
                          className="pdf-folder-header"
                          onClick={() => {
                            if (!isRenaming) {
                              togglePdfFolderCollapse(folder.id)
                            }
                          }}
                        >
                          {isRenaming ? (
                            <input
                              className="pdf-folder-rename-input"
                              autoFocus
                              value={renamingPdfFolderName}
                              onChange={(e) => handlePdfFolderRenameChange(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  handlePdfFolderRenameConfirm()
                                } else if (e.key === 'Escape') {
                                  e.preventDefault()
                                  handlePdfFolderRenameCancel()
                                }
                              }}
                              onBlur={() => handlePdfFolderRenameCancel()}
                            />
                          ) : (
                            <>
                              <span className="pdf-folder-toggle-icon">{isCollapsed ? '▸' : '▾'}</span>
                              <span
                                className="pdf-folder-name"
                                onDoubleClick={(e) => {
                                  e.stopPropagation()
                                  startPdfFolderRename(folder)
                                }}
                              >
                                {folder.name}
                              </span>
                              <button
                                type="button"
                                className="pdf-folder-delete-btn"
                                title="删除虚拟文件夹"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleDeletePdfFolder(folder)
                                }}
                              >
                                x
                              </button>
                            </>
                          )}
                        </div>
                        {isCollapsed ? null : (
                          items.length === 0 ? (
                            <div className="pdf-folder-empty" style={{ padding: '4px 12px', fontSize: '12px', color: '#9ca3af' }}>
                              No PDFs yet. Move recent files into this virtual folder to show them here.
                            </div>
                          ) : (
                            <ul className="pdf-recent-list">
                              {items.map((item) => {
                                const name = item.displayName || item.path.split(/[/\\]/).pop() || item.path
                                const isActive = activeTab?.path === item.path
                                return (
                                  <li
                                    key={item.path}
                                    className={`pdf-recent-item ${isActive ? 'active' : ''}`}
                                    onClick={() => { void openRecentFileInNewTab(item.path) }}
                                    onContextMenu={(e) => {
                                      e.preventDefault()
                                      e.stopPropagation()
                                      setPdfMenuState({
                                        visible: true,
                                        x: e.clientX,
                                        y: e.clientY,
                                        targetPath: item.path,
                                      })
                                    }}
                                  >
                                    <div className="pdf-recent-title">{name}</div>
                                  </li>
                                )
                              })}
                            </ul>
                          )
                        )}
                      </div>
                    )
                  })}
                </>
              )}
              {pdfMenuState.visible && pdfMenuState.targetPath && (
                <FileContextMenu
                  x={pdfMenuState.x}
                  y={pdfMenuState.y}
                  onRequestClose={closePdfMenu}
                  items={[
                    {
                      id: 'open',
                      label: 'Open',
                      onClick: () => {
                        void openRecentFileInNewTab(pdfMenuState.targetPath!)
                        closePdfMenu()
                      },
                    },
                    {
                      id: 'move-to-folder-menu',
                      label: 'Move to Virtual Folder…',
                      onClick: () => {
                        const targetPath = pdfMenuState.targetPath!
                        const offsetX = 180
                        setPdfFolderMenuState({
                          visible: true,
                          x: pdfMenuState.x + offsetX,
                          y: pdfMenuState.y,
                          targetPath,
                        })
                        closePdfMenu()
                      },
                    },
                    {
                      id: 'open-in-file-manager',
                      label: 'Open in File Manager',
                      onClick: () => {
                        const dir = computeDirFromPath(pdfMenuState.targetPath!)
                        void (async () => {
                          const result = await openInFileManager(dir)
                          if (!result.ok && result.message) {
                            setStatusMessage(result.message)
                          }
                        })()
                        closePdfMenu()
                      },
                    },
                    {
                      id: 'remove-from-recent',
                      label: 'Remove from Recent',
                      onClick: () => {
                        handleRemovePdfFromRecent(pdfMenuState.targetPath!)
                        closePdfMenu()
                      },
                    },
                  ]}
                />
              )}

              {pdfFolderMenuState.visible && pdfFolderMenuState.targetPath && (
                <FileContextMenu
                  x={pdfFolderMenuState.x}
                  y={pdfFolderMenuState.y}
                  onRequestClose={closePdfFolderMenu}
                  items={[
                    {
                      id: 'move-to-root',
                      label: 'Move to Root (No Folder)',
                      onClick: () => {
                        const targetPath = pdfFolderMenuState.targetPath!
                        movePdfToFolder(targetPath, null)
                        closePdfFolderMenu()
                      },
                    },
                    ...pdfFolders.map((folder) => ({
                      id: `move-to-folder-${folder.id}`,
                      label: folder.name,
                      onClick: () => {
                        const targetPath = pdfFolderMenuState.targetPath!
                        movePdfToFolder(targetPath, folder.id)
                        closePdfFolderMenu()
                      },
                    })),
                  ]}
                />
              )}
            </div>
          </div>
        )}
        {(activeLeftPanel === 'files' || activeLeftPanel === 'outline' || activeLeftPanel === 'pdf' || activeLeftPanel === 'sessions') && (
          <div className={`sidebar-resizer ${isSidebarResizing ? 'active' : ''}`} onMouseDown={handleSidebarResizeStart} />
        )}

        <div className="workspace-column">
          {tabs.length === 0 ? (
            <Welcome
              onNewFile={() => createTab()}
              onOpenFile={() => openFile()}
              onOpenAiChat={() => {
                // 在没有任何标签时，优先使用浮窗模式打开 AI Chat
                if (aiChatMode !== 'floating') {
                  setAiChatMode('floating')
                }
                openAiChatDialog({ entryMode: 'chat' })
              }}
            />
          ) : (
            <>
              <TabBar tabs={tabs} activeId={activeId} onTabClick={setActiveTab} onTabClose={closeTabWithAiSession} onRequestSaveAndClose={handleTabSaveAndClose} />
              <main className={`workspace ${dragging ? 'dragging' : ''}`} style={{ gridTemplateColumns: outerGridTemplateColumns }}>
                {aiChatMode === 'docked' && aiChatOpen && aiChatState && (
                  <>
                    {aiChatDockSide === 'left' && (
                      <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4, fontSize: 13, height: '100%' }}>加载 AI 面板…</div>}>
                        <AiChatPaneLazy
                          sessionKey={aiChatSessionKey}
                          entryMode={aiChatState.entryMode}
                          initialContext={aiChatState.initialContext}
                          onClose={closeAiChatDialog}
                          currentFilePath={aiChatFilePath}
                          sourceTabId={activeTab?.id ?? null}
                        />
                      </Suspense>
                    )}
                    <div className="divider-hotzone vertical" style={{ position: 'absolute', left: aiChatDockSide === 'left' ? aiChatWidth : `calc(100% - ${aiChatWidth}px)`, height: '100%', zIndex: 100, cursor: 'col-resize' }} onMouseDown={handleAiChatResizeStart}>
                      <div className="divider-rail"><span className="divider-handle" /></div>
                    </div>
                  </>
                )}
                <section className="pane-group editor-preview-group" style={{ gridTemplateColumns }} ref={workspaceRef}>
                  <section
                    className={`pane ${effectiveLayout === 'preview-only' ? '' : 'editor-pane'}`}
                    style={
                      effectiveLayout === 'preview-only'
                        ? { display: 'none' }
                        : effectiveLayout === 'preview-left'
                          ? { gridColumn: '2/3' }
                          : effectiveLayout === 'preview-right'
                            ? { gridColumn: '1/2' }
                            : { gridColumn: '1/-1' }
                    }
                  >
                    <Suspense fallback={<div className="code-editor" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4, fontSize: 13 }}>加载编辑器…</div>}>
                      {isSearchOpen && (
                        <SearchBar
                          view={editorViewRef.current}
                          onClose={() => setIsSearchOpen(false)}
                        />
                      )}
                      <EditorPaneLazy
                        markdown={editorMarkdown}
                        onChange={handleEditorChange}
                        onCursorChange={handleCursorChange}
                        showPreview={showPreview}
                        setShowPreview={setShowPreview}
                        editorViewRef={editorViewRef}
                        onFoldRegionsChange={setFoldRegions}
                        focusRequest={focusRequest}
                        onFocusHandled={() => setFocusRequest(null)}
                        onProgrammaticScrollStart={() => { isProgrammaticScrollRef.current = true }}
                        onProgrammaticScrollEnd={() => { isProgrammaticScrollRef.current = false }}
                        editorZoom={editorZoom}
                        onEditorReady={handleEditorReady}
                      />
                    </Suspense>
                  </section>

                  <PreviewErrorBoundary>
                  <Suspense fallback={<section className="pane preview"><div className="preview-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4, fontSize: 13 }}>加载预览…</div></section>}>
                    {isPdfActive ? (
                      <section
                        className="pane preview"
                        style={
                          effectiveLayout === 'preview-only'
                            ? { gridColumn: '1 / -1', gridRow: '1 / 2' }
                            : effectiveLayout === 'preview-left'
                              ? { gridColumn: '1 / 2', gridRow: '1 / 2' }
                              : effectiveLayout === 'preview-right'
                                ? { gridColumn: '2 / 3', gridRow: '1 / 2' }
                                : effectiveLayout === 'editor-only'
                                  ? { display: 'none' }
                                  : undefined
                        }
                      >
                        {activeTab?.path && (
                          <PdfViewerLazy
                            filePath={activeTab.path}
                            onRegisterSelectionGetter={(getter) => {
                              pdfSelectionGetterRef.current = getter
                            }}
                          />
                        )}
                      </section>
                    ) : (
                      <PreviewPaneLazy
                        value={previewValue}
                        activeLine={previewActiveLine}
                        previewWidth={previewWidthForRender}
                        effectiveLayout={effectiveLayout}
                        filePath={filePath}
                        foldRegions={foldRegions}
                        onPreviewLineClick={handlePreviewLineClick}
                        onSelectionChange={setPreviewSelectionText}
                      />
                    )}
                  </Suspense>
                  </PreviewErrorBoundary>

                  {(effectiveLayout === 'preview-left' || effectiveLayout === 'preview-right') && (
                    <div className={`divider-hotzone ${dragging ? 'active' : ''}`} style={{ left: effectiveLayout === 'preview-left' ? `${previewWidthForRender}%` : `${100 - previewWidthForRender}%` }} onMouseDown={startDragging}>
                      <div className="divider-rail"><span className="divider-handle" /></div>
                    </div>
                  )}
                </section>
                {aiChatMode === 'docked' && aiChatOpen && aiChatState && aiChatDockSide === 'right' && (
                  <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4, fontSize: 13, height: '100%' }}>加载 AI 面板…</div>}>
                    <AiChatPaneLazy
                      sessionKey={aiChatSessionKey}
                      entryMode={aiChatState.entryMode}
                      initialContext={aiChatState.initialContext}
                      onClose={closeAiChatDialog}
                      currentFilePath={aiChatFilePath}
                      sourceTabId={activeTab?.id ?? null}
                    />
                  </Suspense>
                )}
              </main>
            </>
          )}
        </div>

        {conflictError && (
          <ConflictModal
            error={conflictError}
            onRetrySave={async () => {
              await save()
            }}
            onCancel={() => setConflictError(null)}
          />
        )}
        {confirmDialog && <ConfirmDialog title={confirmDialog.title} message={confirmDialog.message} confirmText={confirmDialog.confirmText} cancelText={confirmDialog.cancelText} extraText={confirmDialog.extraText} variant={confirmDialog.variant} onConfirm={confirmDialog.onConfirm} onExtra={confirmDialog.onExtra} onCancel={() => setConfirmDialog(null)} />}
        {quitConfirmDialog && <ConfirmDialog title={quitConfirmDialog.unsavedCount === 1 ? 'Save changes?' : `Save ${quitConfirmDialog.unsavedCount} files?`} message="Your changes will be lost." confirmText="Save All" cancelText="Cancel" extraText="Don't Save" variant="stacked" onConfirm={quitConfirmDialog.onSaveAll} onExtra={quitConfirmDialog.onQuitWithoutSaving} onCancel={() => setQuitConfirmDialog(null)} />}

        <InsertTableDialog
          open={isInsertTableDialogOpen}
          onConfirm={handleInsertTableConfirm}
          onCancel={() => setIsInsertTableDialogOpen(false)}
        />

        {aiChatMode === 'floating' && aiChatOpen && aiChatState?.open && (
          <Suspense fallback={null}>
            <AiChatDialogLazy
              open={aiChatOpen}
              entryMode={aiChatState.entryMode}
              initialContext={aiChatState.initialContext}
              onClose={closeAiChatDialog}
              currentFilePath={aiChatFilePath}
              tabId={aiChatState.tabId}
            />
          </Suspense>
        )}

        {recentDialogOpen && (
          <Suspense fallback={null}>
            <RecentFilesDialogLazy
              open={recentDialogOpen}
              onClose={() => setRecentDialogOpen(false)}
              onOpenFile={(path: string) => {
                void openRecentFileInNewTab(path)
                setRecentDialogOpen(false)
              }}
            />
          </Suspense>
        )}

        {docHistoryState.open && docHistoryState.docPath && (
          <Suspense fallback={null}>
            <DocConversationHistoryDialogLazy
              open={docHistoryState.open}
              docPath={docHistoryState.docPath}
              onClose={closeDocHistoryDialog}
            />
          </Suspense>
        )}

        {globalMemoryState.open && (
          <Suspense fallback={null}>
            <GlobalMemoryDialogLazy
              open={globalMemoryState.open}
              initialTab={globalMemoryState.initialTab}
              onClose={closeGlobalMemoryDialog}
            />
          </Suspense>
        )}

        <AboutDialog open={aboutOpen} onClose={closeAboutDialog} />
        <Toast message={statusMessage} onDismiss={() => setStatusMessage('')} />
      </>
    </AiChatCommandBridgeContext.Provider>
  )
}

export default WorkspaceShell
