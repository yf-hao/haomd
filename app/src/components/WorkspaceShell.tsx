import { lazy, Suspense, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { EditorView } from '@codemirror/view'
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { ConflictModal } from './ConflictModal'
import { ConfirmDialog } from './ConfirmDialog'
import PreviewErrorBoundary from './PreviewErrorBoundary'
import { InsertTableDialog } from './InsertTableDialog'
import { AlarmDialog } from './AlarmDialog'
import { AlarmRingDialog } from './AlarmRingDialog'
import { MathSymbolDialog } from './MathSymbolDialog'
import { CalendarDialog } from './CalendarDialog'
import { ReminderToolDialog } from './ReminderToolDialog'
import { PomodoroDialog } from './PomodoroDialog'
import { MusicPlayerDialog } from './MusicPlayerDialog'
import { AboutDialog } from './AboutDialog'
import { IssueReportDialog } from './IssueReportDialog'
import { ReleaseNotesDialog } from './ReleaseNotesDialog'
import { TextColorDialog } from './TextColorDialog'
import { TabBar } from './TabBar'
import { FileContextMenu } from './FileContextMenu'
import { Sidebar, type SidebarContextActionPayload, type SidebarContextTargetKind } from './Sidebar'
import { OutlinePanel } from './OutlinePanel'
import { GlobalSearchPanel } from './GlobalSearchPanel'
import { SessionsPanel } from './SessionsPanel'
import { NotesPanel } from './NotesPanel'
import { SkillsPanel } from './SkillsPanel'
import { WorkflowsPanel } from './WorkflowsPanel'
import { SidebarBackgroundShell } from './SidebarBackgroundShell'
import { Welcome } from './Welcome'
import { SearchBar } from './Editor/SearchBar'
import type { EditorTransientSearchQuery } from './EditorPane'
import { buildSearchScope } from '../modules/search/searchScopeService'
import type { SearchScope } from '../modules/search/types'
import { useOutlineModel } from '../hooks/useOutlineModel'
import type { OutlineItem } from '../modules/outline/parser'
import type { OutlineHeading } from '../modules/outline/outlineSource'
import { getMarkdownOutlineFallbackTarget, getWysiwygOutlineNavigationTarget } from '../modules/outline/outlineNavigation'
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
import { createFolder, deleteFsEntry, listFolder, writeFile, renameFsEntry } from '../modules/files/service'
import { usePdfPanel } from '../hooks/usePdfPanel'
import { useAiChatPanel } from '../hooks/useAiChatPanel'
import { useHugeDoc } from '../hooks/useHugeDoc'
import { useCursorMemory } from '../hooks/useCursorMemory'
import { useSidebarResize } from '../hooks/useSidebarResize'
import { useNativeBridge } from '../hooks/useNativeBridge'
import { useNativePaste } from '../hooks/useNativePaste'
import { usePomodoroController } from '../modules/tools/pomodoro/usePomodoroController'
import { useAlarmScheduler } from '../modules/tools/alarm/useAlarmScheduler'
import { useAlarmMusicPauseSync } from '../modules/tools/alarm/useAlarmMusicPauseSync'
import { onNativePasteImage } from '../modules/platform/clipboardEvents'
import { openTerminalAt } from '../modules/platform/terminalService'
import { openInFileManager } from '../modules/platform/fileExplorerService'
import { getFilePathIdentity } from '../modules/files/filePathState'
import { FileOpenCoordinator } from '../modules/files/fileOpenCoordinator'
import { loadDefaultImagePathStrategyConfig, resolveImageTarget } from '../modules/images/imagePasteStrategy'
import {
  buildImportedWordTabTitle,
  cleanupImportedWordTemp,
  cleanupStaleImportedWordTemps,
  finalizeImportedWordDocument,
  importWordDocxToTempMarkdown,
  isWordDocxPath,
  pickWordDocxImportPath,
  pickImportedWordSavePath,
} from '../modules/import/word/service'
import type { ImportedWordState } from '../modules/import/word/types'
import {
  registerApplyHeadingLevel,
  registerResetHeadingToParagraph,
  registerEmphasizeSelection,
  registerToggleStrikethrough,
  registerInsertCodeBlock,
  registerInsertMathSymbol,
  registerApplyTextColor,
  registerClearTextColor,
  registerGetCurrentTextColor,
  registerGetCurrentTextColorTarget,
  registerApplyTextColorToTarget,
  applyTextColor,
  clearTextColor,
} from '../modules/editor/formatService'
import { useI18n } from '../modules/i18n/I18nContext'
import { useThemeContext } from '../modules/theme/ThemeContext'
import { buildBackgroundImageVars, resolveManagedBackgroundImageUrl } from '../modules/theme/backgroundImageRuntime'
import {
  applyTextColorSyntax,
  clearTextColorSyntax,
  getEnclosingTextColorBlock,
  getTextColorAtRange,
  normalizeTextColor,
} from '../modules/markdown/extensions/colorMark'
import { extractFrontMatter, upsertFrontMatterValue } from '../modules/markdown/frontMatter'
import { MAX_RECENT_TEXT_COLORS, RECENT_TEXT_COLORS_STORAGE_KEY } from '../modules/editor/textColorPalette'
import { createTextColorTarget, isTextColorTargetActive, type TextColorTarget } from '../modules/editor/textColorTarget'
import { setWorkspaceMountedRoots } from '../modules/workspace/workspaceMountedRoots'
import { setActiveWorkspaceDirectory } from '../modules/workspace/workspaceActiveDirectory'
import { computeDirFromPath, resolveSelectionBaseDirectory } from '../modules/workspace/selectionBaseDirectory'
import { resolveCurrentWorkspaceRoot, resolveWorkspaceEntryByName, type WorkspaceEntryKind } from '../modules/workspace/workspaceEntryResolver'
import { isTransientFilePath } from '../modules/files/filePathState'
import { renameCurrentDocument } from '../modules/document/application/documentRenameService'
import { createDirectoryFromSelection } from '../modules/document/application/createDirectoryFromSelectionService'
import { createDirectoryInWorkspace } from '../modules/document/application/createDirectoryInWorkspaceService'
import { renameWorkspaceEntry } from '../modules/document/application/renameWorkspaceEntryService'
import type { WysiwygFormatActions } from './Wysiwyg/WysiwygPane'
import { buildPdfAiChatDocPathKey } from '../modules/ai/domain/aiChatDocPathKey'
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

const RecentFilesDialogLazy = lazy(() =>
  import('./RecentFilesDialog').then((m) => ({ default: m.RecentFilesDialog }))
)

const WysiwygPaneLazy = lazy(() =>
  import('./Wysiwyg/WysiwygPane').then((m) => ({ default: m.WysiwygPane }))
)

export type EditMode = 'source' | 'wysiwyg'
const STORAGE_EDIT_MODE = 'haomd:editMode'

/** 阻止 overflow:hidden 容器被浏览器焦点跟随自动滚动 */
const preventContainerScroll = (e: React.UIEvent<HTMLElement>) => {
  const el = e.currentTarget
  if (el.scrollTop !== 0 || el.scrollLeft !== 0) {
    el.scrollTop = 0
    el.scrollLeft = 0
  }
}

export type LeftPanelId = 'files' | 'search' | 'outline' | 'pdf' | 'sessions' | 'notes' | 'skills' | 'workflows' | null
export type InitialWorkspaceAction = 'new' | 'open' | 'open_folder' | 'open_recent' | null

export interface WorkspaceShellProps {
  activeLeftPanel: LeftPanelId
  toggleSidebarVisible: () => void
  isTauriEnv: () => boolean
  initialAction: InitialWorkspaceAction
  initialOpenRecentPath?: string | null
  initialOpenRecentIsFolder?: boolean | null
  onInitialActionHandled?: () => void
  onDocumentStatsChange?: (stats: { charCount: number | null }) => void
  /** 将 WorkspaceShell 内部的 statusMessage 透出给上层 App 用于状态栏展示 */
  onStatusMessageChange?: (msg: string) => void
  onSearchScopeChange?: (scope: SearchScope) => void
}

const countDocumentChars = (text: string): number => {
  if (!text) return 0
  // 简单实现：统计非空白字符数，汉字/字母/数字/标点都计入
  const noWhitespace = text.replace(/\s/g, '')
  return noWhitespace.length
}

const seed = ''

function findOutlineItemByPage(items: OutlineItem[], page: number): OutlineItem | null {
  for (const item of items) {
    const childMatch = item.children ? findOutlineItemByPage(item.children, page) : null
    if (childMatch) return childMatch
    if (item.page === page) return item
  }
  return null
}

export function WorkspaceShell({
  activeLeftPanel,
  toggleSidebarVisible,
  isTauriEnv,
  initialAction,
  initialOpenRecentPath,
  initialOpenRecentIsFolder,
  onInitialActionHandled,
  onDocumentStatsChange,
  onStatusMessageChange,
  onSearchScopeChange,
}: WorkspaceShellProps) {
  const { t } = useI18n()
  const { themeSettings } = useThemeContext()
  const [markdown, setMarkdown] = useState(seed)
  const [editorMarkdown, setEditorMarkdown] = useState(seed)
  const [previewValue, setPreviewValue] = useState(seed)
  const [activeLine, setActiveLine] = useState(1)
  // 预览专用的行号：对 activeLine 做轻量节流后再驱动 Preview，降低重渲染频率
  const [previewActiveLine, setPreviewActiveLine] = useState(1)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(null)
  const [activeWorkspaceDirectoryPath, setActiveWorkspaceDirectoryPath] = useState<string | null>(null)
  const markdownRef = useRef(markdown)
  const lastActiveIdForPreviewRef = useRef<string | null>(null)
  const textColorTargetRef = useRef<TextColorTarget | null>(null)
  const preserveTextColorTargetOnNextChangeRef = useRef(false)

  const [aboutOpen, setAboutOpen] = useState(false)
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false)
  const [issueReportOpen, setIssueReportOpen] = useState(false)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [aiChatSessionKey, setAiChatSessionKey] = useState<AiChatSessionKey>('global')

  // Reset session key when switching away from the sessions panel
  useEffect(() => {
    if (activeLeftPanel !== 'sessions' && aiChatSessionKey.startsWith('session:')) {
      setAiChatSessionKey('global')
    }
  }, [activeLeftPanel])

  useEffect(() => {
    if (activeLeftPanel !== 'search') {
      setTransientSearchQuery(null)
    }
  }, [activeLeftPanel])

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
  const [wysiwygOutlineHeadings, setWysiwygOutlineHeadings] = useState<OutlineHeading[]>([])
  const [pdfOutlineItems, setPdfOutlineItems] = useState<OutlineItem[]>([])
  const [pdfOutlineLoading, setPdfOutlineLoading] = useState(false)
  const [pdfCurrentPage, setPdfCurrentPage] = useState<number | null>(null)
  const [pdfOutlineRequestedPage, setPdfOutlineRequestedPage] = useState<{ page: number } | null>(null)
  const [isCreatingTab, setIsCreatingTab] = useState(false)
  const [foldRegions, setFoldRegions] = useState<{ fromLine: number; toLine: number }[]>([])
  const [inlineNewFileDir, setInlineNewFileDir] = useState<string | null>(null)
  const [inlineNewFolderDir, setInlineNewFolderDir] = useState<string | null>(null)
  const [inlineRenamePath, setInlineRenamePath] = useState<string | null>(null)
  const [focusRequest, setFocusRequest] = useState<{ localLine: number; columnStart?: number } | null>(null)
  const [transientSearchQuery, setTransientSearchQuery] = useState<EditorTransientSearchQuery | null>(null)
  const [previewSelectionText, setPreviewSelectionText] = useState<string | null>(null)
  const pdfSelectionGetterRef = useRef<(() => string | null) | null>(null)
  const pdfZoomActionsRef = useRef<{
    zoomIn: () => number | null
    zoomOut: () => number | null
    zoomReset: () => number | null
  } | null>(null)
  const pdfShortcutActionsRef = useRef<{
    selectTool: () => void
    activateMarkupTool: (tool: 'highlight' | 'underline' | 'strikeout' | 'squiggly') => void
    activateShapeTool: (tool: 'square' | 'circle' | 'line' | 'arrow') => void
    activateStampTool: () => void
    activateFreeTextTool: () => void
    addNote: () => void
    addDetachedNote: () => void
    deleteSelected: () => void
    selectColorIndex: (index: number) => void
  } | null>(null)
  const wysiwygSelectionGetterRef = useRef<(() => string | null) | null>(null)
  const wysiwygMarkdownGetterRef = useRef<(() => string) | null>(null)
  const wysiwygOutlineNavigatorRef = useRef<((target: { headingIndex: number; text: string; level: 1 | 2 | 3 | 4 | 5 | 6 }) => boolean) | null>(null)
  const wysiwygFormatActionsRef = useRef<WysiwygFormatActions | null>(null)
  type MarkdownSyncOptions = { markDirty?: boolean; immediate?: boolean; syncEditor?: boolean }
  const syncWysiwygMarkdownRef = useRef<((markdown: string, options?: MarkdownSyncOptions) => void) | null>(null)
  const skipWysiwygUnmountFlushRef = useRef(false)
  const guardedSaveRef = useRef<(() => Promise<any>) | null>(null)
  // Holds the flush function from WysiwygPane for forcing serialization before save
  const wysiwygFlushRef = useRef<(() => void) | null>(null)
  // Tracks the original markdown at the moment WYSIWYG mode was entered, per tab
  const wysiwygEntryMarkdownRef = useRef<string | null>(null)
  // Tracks whether the user has actually made edits while in WYSIWYG mode
  const wysiwygIsDirtyRef = useRef(false)
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

  // 编辑模式：source（CodeMirror + 预览）或 wysiwyg（Milkdown 所见即所得）
  const [editMode, setEditMode] = useState<EditMode>(() => {
    if (typeof localStorage === 'undefined') return 'source'
    return (localStorage.getItem(STORAGE_EDIT_MODE) as EditMode) || 'source'
  })
  const editModeRef = useRef<EditMode>(editMode)
  const editorMarkdownRef = useRef(markdownRef.current)
  useEffect(() => {
    editModeRef.current = editMode
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_EDIT_MODE, editMode)
    }
  }, [editMode])

  useEffect(() => {
    if (!isTauriEnv()) return
    void invoke('set_wysiwyg_menu_checked', { checked: editMode === 'wysiwyg' }).catch((error) => {
      console.warn('[WorkspaceShell] failed to sync WYSIWYG menu state:', error)
    })
  }, [editMode, isTauriEnv])

  const setEditModeWithFlush = useCallback((next: EditMode) => {
    if (editMode === 'source' && next === 'wysiwyg') {
      // Save original markdown and reset dirty flag when entering WYSIWYG
      wysiwygEntryMarkdownRef.current = editorMarkdownRef.current
      wysiwygIsDirtyRef.current = false
    }
    if (editMode === 'wysiwyg' && next === 'source') {
      skipWysiwygUnmountFlushRef.current = true
      if (!wysiwygIsDirtyRef.current && wysiwygEntryMarkdownRef.current !== null) {
        // No edits were made — restore the original source to avoid
        // serializer escaping side effects (e.g. \= for lines starting with =)
        flushSync(() => {
          syncWysiwygMarkdownRef.current?.(wysiwygEntryMarkdownRef.current!, { markDirty: false })
        })
      } else {
        const latest = wysiwygMarkdownGetterRef.current?.()
        if (latest !== undefined) {
          // Read directly from the WYSIWYG instance before source mode mounts,
          // so the source editor never boots from stale React state.
          flushSync(() => {
            syncWysiwygMarkdownRef.current?.(latest, { markDirty: false })
          })
        } else if (wysiwygFlushRef.current) {
          flushSync(() => {
            wysiwygFlushRef.current?.()
          })
        }
      }
    }
    setEditMode(next)
  }, [editMode])

  const isPreviewVisible = effectiveLayout !== 'editor-only'
  const prevIsPreviewVisibleRef = useRef(isPreviewVisible)
  const previewSyncTimerRef = useRef<number | null>(null)
  const skipNextPreviewThrottleRef = useRef(false)

  const clearPreviewSyncTimer = useCallback(() => {
    if (previewSyncTimerRef.current != null) {
      window.clearTimeout(previewSyncTimerRef.current)
      previewSyncTimerRef.current = null
    }
  }, [])

  // 在 editor/preview 区域统一处理滚轮：如果鼠标横坐标落在编辑器列内，就把滚动量转发给编辑器的 .cm-scroller
  useEffect(() => {
    const root = workspaceRef.current as HTMLElement | null
    if (!root) return

    const handleWheel = (e: WheelEvent) => {
      const editorPane = root.querySelector<HTMLElement>('.pane.editor-pane')
      if (!editorPane) return

      const rect = editorPane.getBoundingClientRect()
      const x = e.clientX

      // 只有当鼠标在编辑器这一列（包括右侧空白、分割线附近）时才处理
      if (x < rect.left || x > rect.right) return

      const scroller = editorPane.querySelector<HTMLElement>('.cm-scroller')
      if (!scroller) return

      if (e.deltaY === 0) return
      const prevTop = scroller.scrollTop
      scroller.scrollTop += e.deltaY
      if (scroller.scrollTop !== prevTop) {
        e.preventDefault()
      }
    }

    root.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      root.removeEventListener('wheel', handleWheel as EventListener)
    }
  }, [workspaceRef])

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
    updateTabsPathByPath,
    markActiveTabDirty,
  } = useTabs({
    onRequestCloseCurrentTab: () => {
      if (closeCurrentTabRef.current) {
        closeCurrentTabRef.current()
      }
    },
  })

  const openingPathsRef = useRef(new FileOpenCoordinator())
  const tabIdsByPathRef = useRef(new Map<string, string>())
  tabIdsByPathRef.current = new Map(
    tabs
      .filter((tab) => tab.path && tab.path !== 'untitled')
      .map((tab) => [getFilePathIdentity(tab.path), tab.id]),
  )

  const [importedWordTabs, setImportedWordTabs] = useState<Record<string, ImportedWordState>>({})
  const importedWordTabsRef = useRef<Record<string, ImportedWordState>>({})

  useEffect(() => {
    importedWordTabsRef.current = importedWordTabs
  }, [importedWordTabs])

  useEffect(() => {
    void cleanupStaleImportedWordTemps().catch((error) => {
      console.warn('[word-import] cleanup stale temp failed', error)
    })
  }, [])

  const registerImportedWordTab = useCallback((tabId: string, state: ImportedWordState) => {
    setImportedWordTabs((prev) => ({ ...prev, [tabId]: state }))
  }, [])

  const clearImportedWordTab = useCallback((tabId: string) => {
    setImportedWordTabs((prev) => {
      if (!prev[tabId]) return prev
      const next = { ...prev }
      delete next[tabId]
      return next
    })
  }, [])

  const findImportedWordTabBySourcePath = useCallback((path: string) => {
    return tabs.find((tab) => importedWordTabs[tab.id]?.sourceDocxPath === path) ?? null
  }, [importedWordTabs, tabs])

  const activeImportedWordState = activeId ? (importedWordTabs[activeId] ?? null) : null

  const isPdfActive = !!activeTab?.path && activeTab.path.toLowerCase().endsWith('.pdf')
  const [isAiChatInputFocused, setIsAiChatInputFocused] = useState(false)
  const shouldSuspendPdfViewer = isPdfActive && isAiChatInputFocused

  // AI Chat hook
  const {
    aiChatState,
    aiChatMode, effectiveAiChatMode, setAiChatMode,
    aiChatOpen, aiChatOpenRef,
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

  useEffect(() => {
    if (aiChatOpen || aiChatSessionKey.startsWith('session:')) return
    setIsAiChatInputFocused(false)
  }, [aiChatOpen, aiChatSessionKey])

  const handlePdfRegisterSelectionGetter = useCallback((getter: (() => string | null) | null) => {
    pdfSelectionGetterRef.current = getter
  }, [])
  const handlePdfRegisterZoomActions = useCallback((actions: {
    zoomIn: () => number | null
    zoomOut: () => number | null
    zoomReset: () => number | null
  } | null) => {
    pdfZoomActionsRef.current = actions
  }, [])
  const handlePdfRegisterShortcutActions = useCallback((actions: {
    selectTool: () => void
    activateMarkupTool: (tool: 'highlight' | 'underline' | 'strikeout' | 'squiggly') => void
    activateShapeTool: (tool: 'square' | 'circle' | 'line' | 'arrow') => void
    activateStampTool: () => void
    activateFreeTextTool: () => void
    addNote: () => void
    addDetachedNote: () => void
    deleteSelected: () => void
    selectColorIndex: (index: number) => void
  } | null) => {
    pdfShortcutActionsRef.current = actions
  }, [])
  const handlePdfRequestedOutlinePageHandled = useCallback(() => {
    setPdfOutlineRequestedPage(null)
  }, [])

  const activeIdRef = useRef<string | null>(null)
  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  const getActiveTextColorDocKey = useCallback(() => activeIdRef.current ?? null, [])

  useEffect(() => {
    textColorTargetRef.current = null
  }, [activeId, editMode])

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
    const imported = importedWordTabsRef.current[id]
    if (imported) {
      void cleanupImportedWordTemp(imported.tempDir).catch((error) => {
        console.warn('[word-import] cleanup temp failed on tab close', error)
      })
      setImportedWordTabs((prev) => {
        if (!prev[id]) return prev
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
    closeTab(id)
  }, [closeTab])

  const cleanupAllImportedWordTemps = useCallback(() => {
    const importedStates = Object.values(importedWordTabsRef.current)
    for (const imported of importedStates) {
      void cleanupImportedWordTemp(imported.tempDir).catch((error) => {
        console.warn('[word-import] cleanup temp failed on quit', error)
      })
    }
    if (importedStates.length > 0) {
      setImportedWordTabs({})
    }
  }, [])

  const sidebar = useSidebar()
  const editorViewRef = useRef<EditorView | null>(null)

  const openAboutDialog = useCallback(() => {
    setAboutOpen(true)
  }, [])

  const closeAboutDialog = useCallback(() => {
    setAboutOpen(false)
  }, [])

  const openReleaseNotesDialog = useCallback(() => {
    setReleaseNotesOpen(true)
  }, [])

  const closeReleaseNotesDialog = useCallback(() => {
    setReleaseNotesOpen(false)
  }, [])

  const openIssueReportDialog = useCallback(() => {
    setIssueReportOpen(true)
  }, [])

  const closeIssueReportDialog = useCallback(() => {
    setIssueReportOpen(false)
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

    if (editMode === 'wysiwyg') {
      const getter = wysiwygSelectionGetterRef.current
      if (getter) {
        const text = getter()
        if (text && text.trim()) {
          return text
        }
      }
    }

    // 非 PDF：优先使用 Markdown 预览的选区
    if (previewSelectionText && previewSelectionText.trim()) {
      return previewSelectionText
    }

    // 回退到编辑器选区
    const view = editorViewRef.current
    if (!view || view.state.selection.main.empty) return null
    return view.state.doc.sliceString(view.state.selection.main.from, view.state.selection.main.to)
  }, [editMode, isPdfActive, previewSelectionText])

  const isOutlinePanelVisible = activeLeftPanel === 'outline'
  const outlineItems = useOutlineModel({
    mode: editMode,
    markdown,
    wysiwygHeadings: wysiwygOutlineHeadings,
    enabled: isOutlinePanelVisible && !isPdfActive,
  })

  const activePdfOutlineId = useMemo(() => {
    if (!isPdfActive || pdfCurrentPage == null) return null
    return findOutlineItemByPage(pdfOutlineItems, pdfCurrentPage)?.id ?? null
  }, [isPdfActive, pdfCurrentPage, pdfOutlineItems])

  const outlineItemsForPanel = isPdfActive ? pdfOutlineItems : outlineItems
  const outlineActiveId = isPdfActive ? activePdfOutlineId : activeOutlineId
  const outlineEmptyTitle = isPdfActive
    ? (pdfOutlineLoading ? t('pdf.loadingOutline') : t('pdf.noOutline'))
    : t('outline.noHeadings')
  const outlineEmptyHint = isPdfActive
    ? (pdfOutlineLoading ? t('pdf.loadingOutlineHint') : t('pdf.noOutlineHint'))
    : t('outline.noHeadingsHint')

  const handleWysiwygOutlineItemsChange = useCallback((items: OutlineHeading[]) => {
    setWysiwygOutlineHeadings((prev) => {
      if (prev.length === items.length) {
        let isSame = true
        for (let index = 0; index < prev.length; index += 1) {
          const current = prev[index]
          const next = items[index]
          if (
            current.id !== next.id ||
            current.text !== next.text ||
            current.level !== next.level ||
            current.source !== next.source ||
            current.line !== next.line ||
            current.searchText !== next.searchText ||
            current.headingIndex !== next.headingIndex
          ) {
            isSame = false
            break
          }
        }
        if (isSame) {
          return prev
        }
      }
      return items
    })
  }, [])

  useEffect(() => {
    if (editMode !== 'wysiwyg') {
      setWysiwygOutlineHeadings([])
    }
  }, [editMode])

  useEffect(() => {
    setWysiwygOutlineHeadings([])
  }, [activeId])

  const [confirmDialog, setConfirmDialog] = useState<any>(null)
  const [searchPrefillText, setSearchPrefillText] = useState('')
  const [searchPrefillVersion, setSearchPrefillVersion] = useState(0)
  const [quitConfirmDialog, setQuitConfirmDialog] = useState<any>(null)
  const [isInsertTableDialogOpen, setIsInsertTableDialogOpen] = useState(false)
  const [mathSymbolDialog, setMathSymbolDialog] = useState<{ open: boolean; categoryKey: string }>({ open: false, categoryKey: 'greek' })
  const [calendarDialogOpen, setCalendarDialogOpen] = useState(false)
  const [alarmDialogOpen, setAlarmDialogOpen] = useState(false)
  const [reminderToolDialogOpen, setReminderToolDialogOpen] = useState(false)
  const [musicPlayerDialogOpen, setMusicPlayerDialogOpen] = useState(false)
  const [recentDialogOpen, setRecentDialogOpen] = useState(false)
  const [isTextColorDialogOpen, setIsTextColorDialogOpen] = useState(false)
  const pomodoro = usePomodoroController()
  const alarmScheduler = useAlarmScheduler()
  const [recentTextColors, setRecentTextColors] = useState<string[]>(() => {
    try {
      if (typeof localStorage === 'undefined') return []
      const raw = localStorage.getItem(RECENT_TEXT_COLORS_STORAGE_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed
        .map((value) => normalizeTextColor(String(value)))
        .filter((value): value is string => Boolean(value))
        .slice(0, MAX_RECENT_TEXT_COLORS)
    } catch {
      return []
    }
  })

  useAlarmMusicPauseSync(alarmScheduler.activeAlarm)

  const workspaceBackground = themeSettings.workspaceBackground
  const workspaceBackgroundUrl = useMemo(
    () => resolveManagedBackgroundImageUrl(workspaceBackground?.path),
    [workspaceBackground?.path],
  )
  const workspaceBackgroundStyle = useMemo(
    () => buildBackgroundImageVars(workspaceBackground, { maxOpacity: 0.4 }),
    [workspaceBackground],
  )
  const hasWorkspaceBackground = Boolean(workspaceBackground?.enabled && workspaceBackgroundUrl)
  const workspaceBackgroundIncludesSidebar = Boolean(
    hasWorkspaceBackground && themeSettings.workspaceBackgroundIncludeSidebar,
  )
  const workspaceBackgroundFitClass = workspaceBackground?.enabled
    ? workspaceBackground.size === 'contain'
      ? 'workspace-bg-fit-contain'
      : workspaceBackground.size === 'height-fill'
        ? 'workspace-bg-fit-height-fill'
        : workspaceBackground.size === 'width-fill'
          ? 'workspace-bg-fit-width-fill'
          : workspaceBackground.size === 'auto'
            ? 'workspace-bg-fit-auto'
            : ''
    : ''

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
      markdownRef.current = tab.content
      editorMarkdownRef.current = tab.content
      setEditorMarkdown(tab.content)
      setMarkdown(tab.content)
      if (isTabSwitch && isPreviewVisible) {
        clearPreviewSyncTimer()
        skipNextPreviewThrottleRef.current = true
        setIsPreviewLoading(true)
        requestAnimationFrame(() => {
          previewSyncTimerRef.current = window.setTimeout(() => {
            previewSyncTimerRef.current = null
            setPreviewValue(tab.content)
            setIsPreviewLoading(false)
          }, 0)
        })
      } else {
        setPreviewValue(tab.content)
        setIsPreviewLoading(false)
      }

      if (isTabSwitch) {
        lastActiveIdForPreviewRef.current = activeId
        restoreCursorRef.current?.(tab.path ?? null)
      }
    }
  }, [activeId, tabs, isPreviewVisible, clearPreviewSyncTimer])

  // Window Title：不再显示文件名，保持标题栏空白
  useEffect(() => {
    const title = ''
    if (isTauriEnv()) {
      void invoke('set_title', { title }).catch(() => { })
    }
  }, [activeTab, isTauriEnv])

  useEffect(() => {
    setWorkspaceMountedRoots(sidebar.folderRoots)
  }, [sidebar.folderRoots])

  useEffect(() => {
    setActiveWorkspaceDirectory(activeWorkspaceDirectoryPath)
    return () => {
      setActiveWorkspaceDirectory(null)
    }
  }, [activeWorkspaceDirectoryPath])

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

  useNativeBridge({
    activeTab,
    isTauriEnv,
    sidebar,
    openRecentFileInNewTab: async (path: string) => await openRecentFileInNewTab(path),
  })

  // 将内部 statusMessage 同步到上层 App 的状态栏
  useEffect(() => {
    if (typeof onStatusMessageChange === 'function') {
      onStatusMessageChange(statusMessage)
    }
  }, [statusMessage, onStatusMessageChange])

  useEffect(() => {
    if (typeof onSearchScopeChange !== 'function') return
    onSearchScopeChange(
      buildSearchScope({
        folderRoots: sidebar.folderRoots,
        standaloneFiles: sidebar.standaloneFiles,
      }),
    )
  }, [sidebar.folderRoots, sidebar.standaloneFiles, onSearchScopeChange])

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

  const handleMarkdownChange = useCallback((val: string, options?: MarkdownSyncOptions) => {
    const shouldMarkDirty = options?.markDirty ?? true
    const shouldSyncEditor = options?.syncEditor ?? true
    const syncContent = (next: string) => {
      setMarkdown(next)
      editorMarkdownRef.current = next
      updateActiveContent(next, { markDirty: shouldMarkDirty })
    }

    const patchedDoc = applyChunkEdit(val)
      if (patchedDoc !== null) {
        if (patchedDoc === markdownRef.current) {
          return
        }
        markdownRef.current = patchedDoc
        if (shouldSyncEditor) {
          editorMarkdownRef.current = patchedDoc
          setEditorMarkdown(patchedDoc)
        }
      if (options?.immediate) {
        syncContent(patchedDoc)
      } else {
        startTransition(() => syncContent(patchedDoc))
      }
      if (shouldMarkDirty) markDirty()
      return
    }

    // 普通模式：直接用整篇文档更新
    if (val === markdownRef.current) {
      return
    }
    markdownRef.current = val
    if (shouldSyncEditor) {
      editorMarkdownRef.current = val
      setEditorMarkdown(val)
    }
    if (options?.immediate) {
      syncContent(val)
    } else {
      startTransition(() => syncContent(val))
    }
    if (shouldMarkDirty) markDirty()
  }, [applyChunkEdit, markDirty, updateActiveContent])

  const handleWysiwygChange = useCallback((sourceTabId: string, val: string) => {
    if (activeIdRef.current !== sourceTabId) {
      return
    }
    if (preserveTextColorTargetOnNextChangeRef.current) {
      preserveTextColorTargetOnNextChangeRef.current = false
    } else {
      textColorTargetRef.current = null
    }
    handleMarkdownChange(val, { syncEditor: false })
  }, [handleMarkdownChange])
  syncWysiwygMarkdownRef.current = handleMarkdownChange

  const getLatestWysiwygMarkdown = useCallback(() => {
    if (editMode !== 'wysiwyg' || isPdfActive) return null
    return wysiwygMarkdownGetterRef.current?.() ?? null
  }, [editMode, isPdfActive])

  const insertDefaultWordTemplateFrontMatter = useCallback(() => {
    if (isPdfActive) {
      setStatusMessage(t('workspace.insertFrontMatterUnsupportedPdf'))
      return
    }

    const current = getLatestWysiwygMarkdown() ?? markdownRef.current
    const next = upsertFrontMatterValue(current, 'word_template', 'default_plan')
    if (next === current) {
      return
    }
    handleMarkdownChange(next)
  }, [getLatestWysiwygMarkdown, handleMarkdownChange, isPdfActive, setStatusMessage, t])

  const syncLatestWysiwygToReact = useCallback(() => {
    const latest = getLatestWysiwygMarkdown()
    if (latest === null) return null
    flushSync(() => {
      handleMarkdownChange(latest, { markDirty: false, immediate: true })
    })
    return latest
  }, [getLatestWysiwygMarkdown, handleMarkdownChange])

  // 当前激活的 PDF 文件路径（仅在 isPdfActive 时有值）
  const activePdfPath = isPdfActive ? activeTab?.path ?? null : null

  // AI Chat 使用的“文档路径”：
  // - Markdown 标签：使用当前文本文件的路径（filePath）
  // - PDF 标签：使用编码后的稳定 key，避免把 PDF 真实路径写入持久化链路
  const aiChatFilePath = isPdfActive ? activePdfPath : filePath
  const aiChatDocPathOverride = isPdfActive ? buildPdfAiChatDocPathKey(activePdfPath) : null

  // 统一决定编辑器里展示的内容：
  // - Markdown 标签：走原来的 hugeDoc/markdown 逻辑
  // - PDF 标签：按路径从 pdfNotes 中取笔记
  const editorContent = useMemo(() => {
    if (isPdfActive) {
      if (!activePdfPath) return ''
      return pdfNotes[activePdfPath] ?? ''
    }

    return getChunkContent() ?? editorMarkdown
  }, [isPdfActive, activePdfPath, pdfNotes, getChunkContent, editorMarkdown])

  const wysiwygMarkdown = useMemo(() => {
    if (isPdfActive || editMode !== 'wysiwyg') return ''
    return editorMarkdown
  }, [editMode, isPdfActive, editorMarkdown])

  const wysiwygDocument = useMemo(() => {
    if (editMode !== 'wysiwyg') {
      return { rawBlock: '', body: '' }
    }
    return extractFrontMatter(wysiwygMarkdown)
  }, [editMode, wysiwygMarkdown])
  const wysiwygFrontMatterBlock = wysiwygDocument.rawBlock
  const wysiwygBodyMarkdown = wysiwygDocument.body

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

      if (preserveTextColorTargetOnNextChangeRef.current) {
        preserveTextColorTargetOnNextChangeRef.current = false
      } else {
        textColorTargetRef.current = null
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

    /** WYSIWYG: flush pending idle serialization, get latest markdown,
     *  apply a string-level mutation, then push through handleMarkdownChange
     *  so React state, tabs, and the Milkdown sync effect all update. */
    const wysiwygMutate = (mutator: (md: string) => string) => {
      wysiwygFlushRef.current?.()
      const current = wysiwygMarkdownGetterRef.current?.() ?? markdownRef.current
      const next = mutator(current)
      if (next !== current) {
        handleMarkdownChange(next)
      }
    }

    const getSourceSelectionTarget = () => {
      const view = editorViewRef.current
      const docKey = getActiveTextColorDocKey()
      if (!view || !docKey) return null

      const { from, to } = view.state.selection.main
      if (from !== to) {
        const target = createTextColorTarget(docKey, 'source', from, to)
        textColorTargetRef.current = target
        return target
      }

      if (isTextColorTargetActive(textColorTargetRef.current, docKey, 'source')) {
        return textColorTargetRef.current
      }

      textColorTargetRef.current = null
      return null
    }

    const buildSourceColoredTarget = (docKey: string, start: number, color: string, originalText: string) => {
      const content = originalText.replace(/^\{color:#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\}([\s\S]*?)\{\/color\}$/i, '$1')
      const openTagLength = `{color:${color}}`.length
      return createTextColorTarget(docKey, 'source', start + openTagLength, start + openTagLength + content.length)
    }

    const getSourceReplacementPayload = (markdownText: string, target: TextColorTarget, color: string | null) => {
      const enclosing = getEnclosingTextColorBlock(markdownText, target.from, target.to)
      if (enclosing) {
        const replacement = color
          ? applyTextColorSyntax(enclosing.content, color)
          : enclosing.content
        if (!replacement) return null
        return {
          replaceFrom: enclosing.blockStart,
          replaceTo: enclosing.blockEnd,
          replacement,
          nextTarget: color
            ? buildSourceColoredTarget(target.docKey, enclosing.blockStart, color, enclosing.content)
            : createTextColorTarget(target.docKey, 'source', enclosing.blockStart, enclosing.blockStart + enclosing.content.length),
        }
      }

      const selected = markdownText.slice(target.from, target.to)
      const replacement = color
        ? applyTextColorSyntax(selected, color)
        : clearTextColorSyntax(selected)
      if (!replacement || replacement === selected) return null
      return {
        replaceFrom: target.from,
        replaceTo: target.to,
        replacement,
        nextTarget: color
          ? buildSourceColoredTarget(target.docKey, target.from, color, selected)
          : createTextColorTarget(target.docKey, 'source', target.from, target.from + replacement.length),
      }
    }

    const scrollEditorToSelection = () => {
      const view = editorViewRef.current
      if (!view) return
      const scroller = view.scrollDOM
      const pos = view.state.selection.main.head
      window.requestAnimationFrame(() => {
        const coords = view.coordsAtPos(pos)
        if (!coords) return
        const scrollerRect = scroller.getBoundingClientRect()
        const topGap = coords.top - scrollerRect.top
        const bottomGap = coords.bottom - scrollerRect.bottom

        if (topGap < 0) {
          scroller.scrollTop += topGap - 16
        } else if (bottomGap > 0) {
          scroller.scrollTop += bottomGap + 16
        }

        // 重置所有祖先 overflow:hidden 容器的意外滚动偏移
        let el = scroller.parentElement
        while (el) {
          if (el.scrollTop !== 0 || el.scrollLeft !== 0) {
            el.scrollTop = 0
            el.scrollLeft = 0
          }
          el = el.parentElement
        }
      })
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
      }))
      scrollEditorToSelection()
    }

    const runReplaceSelection = (text: string) => {
      const view = editorViewRef.current
      if (!view || !text) return
      const { state } = view
      const { from, to } = state.selection.main
      view.dispatch(state.update({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
      }))
      scrollEditorToSelection()
    }

    registerEditorInsertBelow(async ({ text, sourceTabId }) => {
      if (!text) return

      if (editMode === 'wysiwyg') {
        wysiwygMutate((md) => md + '\n' + text)
        return
      }

      const performInsert = () => {
        runInsertBelow(text)
        syncEditorToReactState()
      }

      const hasSourceTab = !!sourceTabId && tabs.some((t) => t.id === sourceTabId)

      if (hasSourceTab && activeIdRef.current !== sourceTabId) {
        setActiveTab(sourceTabId)
        activeIdRef.current = sourceTabId
        setTimeout(performInsert, 50)
      } else {
        performInsert()
      }
    })

    registerEditorReplaceSelection(async ({ text, sourceTabId }) => {
      if (!text) return

      if (editMode === 'wysiwyg') {
        const selectedText = wysiwygSelectionGetterRef.current?.() ?? ''
        wysiwygMutate((md) => {
          if (selectedText) {
            const idx = md.indexOf(selectedText)
            if (idx >= 0) {
              return md.slice(0, idx) + text + md.slice(idx + selectedText.length)
            }
          }
          // No selection or not found — append
          return md + '\n' + text
        })
        return
      }

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
      if (editModeRef.current === 'wysiwyg') {
        wysiwygFormatActionsRef.current?.setHeading(Math.min(6, Math.max(1, level)) as 1 | 2 | 3 | 4 | 5 | 6)
        return
      }

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
      if (editModeRef.current === 'wysiwyg') {
        wysiwygFormatActionsRef.current?.setHeading(0)
        return
      }

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
      if (editModeRef.current === 'wysiwyg') {
        wysiwygFormatActionsRef.current?.toggleBold()
        return
      }

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
      if (editModeRef.current === 'wysiwyg') {
        wysiwygFormatActionsRef.current?.insertCodeBlock()
        return
      }

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

    registerToggleStrikethrough(async () => {
      if (editModeRef.current === 'wysiwyg') {
        wysiwygFormatActionsRef.current?.toggleStrikethrough()
        return
      }

      const view = editorViewRef.current
      if (!view) return

      const { state } = view
      const { from, to } = state.selection.main
      if (from === to) return

      const selected = state.doc.sliceString(from, to)
      const struck = `~~${selected}~~`

      view.dispatch(state.update({
        changes: { from, to, insert: struck },
        selection: { anchor: from + struck.length },
        scrollIntoView: true,
      }))

      syncEditorToReactState()
    })

    registerApplyTextColor(async (color: string) => {
      const normalizedColor = normalizeTextColor(color)
      if (!normalizedColor) return

      if (editModeRef.current === 'wysiwyg') {
        wysiwygFormatActionsRef.current?.applyTextColor(normalizedColor)
        return
      }

      const view = editorViewRef.current
      const target = getSourceSelectionTarget()
      if (!view || !target) return

      const { state } = view
      const payload = getSourceReplacementPayload(state.doc.toString(), target, normalizedColor)
      if (!payload) return

      preserveTextColorTargetOnNextChangeRef.current = true
      textColorTargetRef.current = payload.nextTarget
      const cursorPos = payload.replaceFrom + payload.replacement.length
      view.dispatch(state.update({
        changes: { from: payload.replaceFrom, to: payload.replaceTo, insert: payload.replacement },
        selection: { anchor: cursorPos, head: cursorPos },
        scrollIntoView: true,
      }))

      syncEditorToReactState()
    })

    registerClearTextColor(async () => {
      if (editModeRef.current === 'wysiwyg') {
        wysiwygFormatActionsRef.current?.clearTextColor()
        return
      }

      const view = editorViewRef.current
      const target = getSourceSelectionTarget()
      if (!view || !target) return

      const { state } = view
      const payload = getSourceReplacementPayload(state.doc.toString(), target, null)
      if (!payload) return

      preserveTextColorTargetOnNextChangeRef.current = true
      textColorTargetRef.current = payload.nextTarget
      const cursorPos = payload.replaceFrom + payload.replacement.length
      view.dispatch(state.update({
        changes: { from: payload.replaceFrom, to: payload.replaceTo, insert: payload.replacement },
        selection: { anchor: cursorPos, head: cursorPos },
        scrollIntoView: true,
      }))

      syncEditorToReactState()
    })

    registerGetCurrentTextColor(async () => {
      if (editModeRef.current === 'wysiwyg') {
        return wysiwygFormatActionsRef.current?.getCurrentTextColor() ?? null
      }

      const view = editorViewRef.current
      const target = getSourceSelectionTarget()
      if (!view || !target) return null

      const markdownText = view.state.doc.toString()
      return getTextColorAtRange(markdownText, target.from, target.to)
    })

    registerGetCurrentTextColorTarget(async () => {
      if (editModeRef.current === 'wysiwyg') {
        return wysiwygFormatActionsRef.current?.getCurrentTextColorTarget() ?? null
      }
      return getSourceSelectionTarget()
    })

    registerApplyTextColorToTarget(async (color, target) => {
      if (editModeRef.current === 'wysiwyg') {
        return wysiwygFormatActionsRef.current?.applyTextColorToTarget(color, target) ?? false
      }

      const view = editorViewRef.current
      const docKey = getActiveTextColorDocKey()
      if (!view || !isTextColorTargetActive(target, docKey, 'source')) return false

      const payload = getSourceReplacementPayload(view.state.doc.toString(), target, color)
      if (!payload) return false

      preserveTextColorTargetOnNextChangeRef.current = true
      textColorTargetRef.current = payload.nextTarget
      const cursorPos = payload.replaceFrom + payload.replacement.length
      view.dispatch(view.state.update({
        changes: { from: payload.replaceFrom, to: payload.replaceTo, insert: payload.replacement },
        selection: { anchor: cursorPos, head: cursorPos },
        scrollIntoView: true,
      }))
      syncEditorToReactState()
      return true
    })

    registerInsertMathSymbol(async (latex: string) => {
      const view = editorViewRef.current
      if (!view) return

      const { state } = view
      const { from, to } = state.selection.main

      view.dispatch(state.update({
        changes: { from, to, insert: latex },
        selection: { anchor: from + latex.length },
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

  const getCurrentWorkspaceRoot = useCallback((): string | null => {
    return resolveCurrentWorkspaceRoot({
      selectedFolderPath,
      currentFilePath: activeTab?.path ?? null,
      folderRoots: sidebar.folderRoots,
    })
  }, [selectedFolderPath, activeTab?.path, sidebar.folderRoots])

  const handleAiDocumentSaved = useCallback((savedPath: string) => {
    if (/\.md$/i.test(savedPath)) {
      setFilePath(savedPath)
      updateActiveMeta(savedPath, false)
    }

    const normalizedSavedPath = savedPath.replace(/\\/g, '/')
    const matchedRoot = sidebar.folderRoots.find((root) => {
      const normalizedRoot = root.replace(/\\/g, '/').replace(/[\\/]+$/, '')
      return (
        normalizedSavedPath === normalizedRoot ||
        normalizedSavedPath.startsWith(`${normalizedRoot}/`)
      )
    })

    if (matchedRoot) {
      void sidebar.refreshFolderTree(matchedRoot)
    }
  }, [setFilePath, updateActiveMeta, sidebar.folderRoots, sidebar.refreshFolderTree])

  const handleAiRenameCurrentDocument = useCallback(async (targetFileName: string) => {
    const result = await renameCurrentDocument(
      { fileName: targetFileName },
      {
        getCurrentFilePath,
      },
    )

    if (!result.ok) {
      return { ok: false, message: result.message }
    }

    const { oldFilePath, renamedPath } = result
    const normalizedNew = renamedPath.replace(/\\/g, '/')
    const parentRoot = sidebar.folderRoots.find((rootPath) => {
      const rootNorm = rootPath.replace(/\\/g, '/')
      return normalizedNew === rootNorm || normalizedNew.startsWith(rootNorm + '/')
    }) ?? null

    if (parentRoot) {
      await sidebar.refreshFolderTree(parentRoot)
    } else {
      sidebar.removeStandaloneFile(oldFilePath)
      sidebar.addStandaloneFile(renamedPath)
    }

    updateTabsPathByPath(oldFilePath, renamedPath)
    if (activeTab?.path === oldFilePath) {
      setFilePath(renamedPath)
      updateActiveMeta(renamedPath, false)
    }

    return { ok: true, message: result.message }
  }, [
    getCurrentFilePath,
    sidebar.folderRoots,
    sidebar.refreshFolderTree,
    sidebar.removeStandaloneFile,
    sidebar.addStandaloneFile,
    updateTabsPathByPath,
    activeTab?.path,
    setFilePath,
    updateActiveMeta,
  ])

  const handleAiCreateDirectoryUnderSelection = useCallback(async (directoryName: string) => {
    const result = await createDirectoryFromSelection(
      { directoryName },
      {
        getBaseDirectory: () =>
          resolveSelectionBaseDirectory({
            selectedFolderPath,
            currentFilePath: activeTab?.path ?? null,
            fallbackRoot: sidebar.folderRoots[0] ?? null,
          }),
      },
    )

    if (!result.ok) {
      return { ok: false, message: result.message }
    }

    const normalizedCreatedPath = result.createdDirectoryPath.replace(/\\/g, '/')
    const matchedRoot = sidebar.folderRoots.find((rootPath) => {
      const rootNorm = rootPath.replace(/\\/g, '/').replace(/[\\/]+$/, '')
      return normalizedCreatedPath === rootNorm || normalizedCreatedPath.startsWith(`${rootNorm}/`)
    }) ?? null

    if (matchedRoot) {
      await sidebar.refreshFolderTree(matchedRoot)
    }

    setSelectedFolderPath(result.createdDirectoryPath)
    setActiveWorkspaceDirectoryPath(result.createdDirectoryPath)

    return { ok: true, message: result.message }
  }, [
    selectedFolderPath,
    activeTab?.path,
    sidebar.folderRoots,
    sidebar.refreshFolderTree,
    setSelectedFolderPath,
  ])

  const handleAiCreateDirectoryInWorkspace = useCallback(async (parentPath: string, directoryName: string) => {
    const result = await createDirectoryInWorkspace(
      { parentPath, directoryName },
      {
        getWorkspaceRoot: getCurrentWorkspaceRoot,
      },
    )

    if (!result.ok) {
      return { ok: false, message: result.message }
    }

    const normalizedCreatedPath = result.createdDirectoryPath.replace(/\\/g, '/')
    const matchedRoot = sidebar.folderRoots.find((rootPath) => {
      const rootNorm = rootPath.replace(/\\/g, '/').replace(/[\\/]+$/, '')
      return normalizedCreatedPath === rootNorm || normalizedCreatedPath.startsWith(`${rootNorm}/`)
    }) ?? null

    if (matchedRoot) {
      await sidebar.refreshFolderTree(matchedRoot)
    }

    setSelectedFolderPath(result.createdDirectoryPath)
    setActiveWorkspaceDirectoryPath(result.createdDirectoryPath)
    return { ok: true, message: result.message }
  }, [getCurrentWorkspaceRoot, sidebar.folderRoots, sidebar.refreshFolderTree])

  const handleAiRenameWorkspaceEntry = useCallback(async (
    targetPath: string,
    newName: string,
    targetKind?: WorkspaceEntryKind,
  ) => {
    const result = await renameWorkspaceEntry(
      { targetPath, newName, targetKind },
      { getWorkspaceRoot: getCurrentWorkspaceRoot },
    )

    if (!result.ok) {
      return { ok: false, message: result.message }
    }

    const normalizedNew = result.renamedPath.replace(/\\/g, '/')
    const parentRoot = sidebar.folderRoots.find((rootPath) => {
      const rootNorm = rootPath.replace(/\\/g, '/')
      return normalizedNew === rootNorm || normalizedNew.startsWith(rootNorm + '/')
    }) ?? null

    if (parentRoot) {
      await sidebar.refreshFolderTree(parentRoot)
    }

    updateTabsPathByPath(result.oldPath, result.renamedPath)
    if (activeTab?.path === result.oldPath) {
      setFilePath(result.renamedPath)
      updateActiveMeta(result.renamedPath, false)
    }

    if (result.targetKind === 'dir') {
      if (selectedFolderPath === result.oldPath) {
        setSelectedFolderPath(result.renamedPath)
      }
      if (activeWorkspaceDirectoryPath === result.oldPath) {
        setActiveWorkspaceDirectoryPath(result.renamedPath)
      }
    }

    return { ok: true, message: result.message }
  }, [
    getCurrentWorkspaceRoot,
    sidebar.folderRoots,
    sidebar.refreshFolderTree,
    updateTabsPathByPath,
    activeTab?.path,
    setFilePath,
    updateActiveMeta,
    selectedFolderPath,
    activeWorkspaceDirectoryPath,
  ])

  useEffect(() => {
    if (activeTab && !isPdfActive) setFilePath(activeTab.path)
  }, [activeTab, isPdfActive, setFilePath])

  const handleCurrentTabClose = useCallback(() => {
    if (isCreatingTab || !activeId) return
    const tab = tabs.find((t) => t.id === activeId)
    if (!tab) return
    if (tab.dirty) {
      setConfirmDialog({
        title: t('workspace.saveChangesToTitle', { title: tab.title }),
        message: t('workspace.saveChangesMessage'),
        confirmText: t('common.save'),
        cancelText: t('common.cancel'),
        extraText: t('workspace.dontSave'),
        variant: 'stacked',
        onConfirm: async () => {
          setConfirmDialog(null)
          const res = await guardedSaveRef.current?.()
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
  }, [isCreatingTab, activeId, tabs, closeTabWithAiSession])

  closeCurrentTabRef.current = handleCurrentTabClose

  const handleQuit = useCallback(() => {
    if (isCreatingTab) return
    const unsaved = getUnsavedTabs()

    // 无论是否存在未保存标签，都先弹出确认模态
    if (unsaved.length === 0) {
      setConfirmDialog({
        title: t('workspace.quitTitle'),
        message: t('workspace.quitMessage'),
        confirmText: t('workspace.quit'),
        cancelText: t('common.cancel'),
        onConfirm: () => {
          setConfirmDialog(null)
          cleanupAllImportedWordTemps()
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
          const res = await guardedSaveRef.current?.()
          if ((res as any)?.ok === false) return
        }
        cleanupAllImportedWordTemps()
        if (isTauriEnv()) invoke('quit_app').catch(() => { })
        else window.close()
      },
      onQuitWithoutSaving: () => {
        setQuitConfirmDialog(null)
        cleanupAllImportedWordTemps()
        if (isTauriEnv()) invoke('quit_app').catch(() => { })
        else window.close()
      }
    })
  }, [isCreatingTab, getUnsavedTabs, isTauriEnv, setActiveTab, setConfirmDialog, cleanupAllImportedWordTemps, t])

  // 预览内容只在预览可见时才节流同步，避免 editor-only 模式下做无意义渲染
  useEffect(() => {
    if (!isPreviewVisible) return
    if (skipNextPreviewThrottleRef.current) {
      skipNextPreviewThrottleRef.current = false
      return
    }

    clearPreviewSyncTimer()
    const timer = window.setTimeout(() => {
      previewSyncTimerRef.current = null
      setPreviewValue(markdown)
    }, 150)
    previewSyncTimerRef.current = timer
    return () => clearTimeout(timer)
  }, [markdown, isPreviewVisible, clearPreviewSyncTimer])

  // 当预览从不可见切换为可见时，立即用最新 markdown 做一次全量同步
  useEffect(() => {
    if (!prevIsPreviewVisibleRef.current && isPreviewVisible) {
      setPreviewValue(markdown)
      setIsPreviewLoading(false)
    }
    prevIsPreviewVisibleRef.current = isPreviewVisible
  }, [isPreviewVisible, markdown])

  useEffect(() => {
    return () => {
      clearPreviewSyncTimer()
    }
  }, [clearPreviewSyncTimer])

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
    markdownRef.current = content
    editorMarkdownRef.current = content
    setEditorMarkdown(content)
    setMarkdown(content)
    if (isPreviewVisible) {
      clearPreviewSyncTimer()
      skipNextPreviewThrottleRef.current = true
      setIsPreviewLoading(true)
      requestAnimationFrame(() => {
        previewSyncTimerRef.current = window.setTimeout(() => {
          previewSyncTimerRef.current = null
          setPreviewValue(content)
          setIsPreviewLoading(false)
        }, 0)
      })
    } else {
      setPreviewValue(content)
      setIsPreviewLoading(false)
    }
    setActiveLine(1)
    // 注意：不再调用 updateActiveContent。调用方 (open_file 命令) 在此之前已通过
    // createTab({ path, content }) 创建了新标签并设置了内容。而 updateActiveContent
    // 闭包中的 activeId 仍指向旧标签，会误将旧标签内容覆写为新文件内容。
  }, [isPreviewVisible, clearPreviewSyncTimer])

  const openImportedWordDocument = useCallback(async (path: string) => {
    if (isCreatingTab) {
      return { ok: false as const, error: { code: 'CANCELLED', message: '正在创建新标签，请稍候…', traceId: undefined } }
    }

    const existing = findImportedWordTabBySourcePath(path)
    if (existing) {
      setActiveTab(existing.id)
      return { ok: true as const, data: { path } }
    }

    try {
      setStatusMessage(t('workspace.importingWordPleaseWait'))
      const imported = await importWordDocxToTempMarkdown(path)
      const tab = createTab({
        title: buildImportedWordTabTitle(path),
        path: 'untitled',
        content: imported.markdown,
      })
      registerImportedWordTab(tab.id, {
        kind: 'word-import',
        sourceDocxPath: imported.sourceDocxPath,
        tempDir: imported.tempDir,
        tempMarkdownPath: imported.tempMarkdownPath,
        tempImagesDir: imported.tempImagesDir,
        needsSaveAs: true,
      })
      setActiveTab(tab.id)
      applyOpenedContent(imported.markdown)
      setFilePath('untitled')
      if (imported.warnings.length > 0) {
        setStatusMessage(imported.warnings[0])
      } else {
        setStatusMessage(t('workspace.wordImportedToTemp'))
      }
      return { ok: true as const, data: { path } }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatusMessage(t('workspace.wordImportFailed', { message }))
      return { ok: false as const, error: { code: 'UNKNOWN', message, traceId: undefined } }
    }
  }, [
    applyOpenedContent,
    createTab,
    findImportedWordTabBySourcePath,
    isCreatingTab,
    registerImportedWordTab,
    setActiveTab,
    setFilePath,
    setStatusMessage,
    t,
  ])

  const importWordFile = useCallback(async () => {
    try {
      const path = await pickWordDocxImportPath()
      if (!path) {
        setStatusMessage(t('workspace.importCancelled'))
        return { ok: false as const, error: { code: 'CANCELLED', message: '用户取消', traceId: undefined } }
      }
      return await openImportedWordDocument(path)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatusMessage(t('workspace.wordImportFailed', { message }))
      return { ok: false as const, error: { code: 'UNKNOWN', message, traceId: undefined } }
    }
  }, [openImportedWordDocument, setStatusMessage, t])

  const saveImportedWordDocumentAs = useCallback(async (markdownContent: string) => {
    if (!activeImportedWordState || !activeId) {
      return { ok: false as const, error: { code: 'UNKNOWN', message: '当前文档不是 Word 导入态', traceId: undefined } }
    }

    const outputPath = await pickImportedWordSavePath(activeImportedWordState.sourceDocxPath)
    if (!outputPath) {
      setStatusMessage(t('workspace.saveCancelled'))
      return { ok: false as const, error: { code: 'CANCELLED', message: '用户取消', traceId: undefined } }
    }

    try {
      setStatusMessage(t('workspace.savingImportedWord'))
      const finalized = await finalizeImportedWordDocument(activeImportedWordState, markdownContent, outputPath)
      const reopened = await openFromPath(finalized.savedPath)
      if (!reopened.ok) {
        setStatusMessage(reopened.error.message)
        return reopened
      }
      updateActiveContent(reopened.data.content, { markDirty: false })
      updateActiveMeta(reopened.data.path, false)
      applyOpenedContent(finalized.markdown)
      clearImportedWordTab(activeId)
      sidebar.addStandaloneFile(finalized.savedPath)
      setStatusMessage(t('workspace.wordImportSaved', { path: finalized.savedPath }))
      return { ok: true as const, data: { path: finalized.savedPath } }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatusMessage(t('workspace.wordImportSaveFailed', { message }))
      return { ok: false as const, error: { code: 'UNKNOWN', message, traceId: undefined } }
    }
  }, [
    activeId,
    activeImportedWordState,
    applyOpenedContent,
    clearImportedWordTab,
    openFromPath,
    setStatusMessage,
    sidebar,
    t,
    updateActiveContent,
    updateActiveMeta,
  ])

  const saveWithPdfGuard = useCallback(async () => {
    if (isPdfActive) {
      setStatusMessage(t('workspace.saveUnsupportedPdf'))
      return { ok: false as const, error: { code: 'UNSUPPORTED', message: t('workspace.saveUnsupportedPdfError'), traceId: undefined } }
    }
    if (activeImportedWordState) {
      const latestImported = syncLatestWysiwygToReact() ?? markdownRef.current
      return await saveImportedWordDocumentAs(latestImported)
    }
    const latest = syncLatestWysiwygToReact()
    if (latest !== null) {
      return await save(latest)
    }
    if (wysiwygFlushRef.current) {
      flushSync(() => { wysiwygFlushRef.current!() })
    }
    return await save()
  }, [activeImportedWordState, isPdfActive, save, saveImportedWordDocumentAs, setStatusMessage, syncLatestWysiwygToReact, t])
  guardedSaveRef.current = saveWithPdfGuard

  const saveAsWithPdfGuard = useCallback(async () => {
    if (isPdfActive) {
      if (!activePdfPath) {
        setStatusMessage(t('workspace.saveUnsupportedPdf'))
        return { ok: false as const, error: { code: 'UNSUPPORTED', message: t('workspace.saveAsUnsupportedPdfError'), traceId: undefined } }
      }
      try {
        const { exportAnnotatedPdf } = await import('../modules/pdf/export/exportAnnotatedPdf')
        await exportAnnotatedPdf({
          filePath: activePdfPath,
          setStatusMessage,
          t,
        })
        return { ok: true as const, data: { path: activePdfPath } }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setStatusMessage(t('workspace.exportAnnotatedPdfFailed', { message }))
        return { ok: false as const, error: { code: 'UNKNOWN', message, traceId: undefined } }
      }
    }
    if (activeImportedWordState) {
      const latestImported = syncLatestWysiwygToReact() ?? markdownRef.current
      return await saveImportedWordDocumentAs(latestImported)
    }
    const latest = syncLatestWysiwygToReact()
    if (latest !== null) {
      return await saveAs(latest)
    }
    return await saveAs()
  }, [activeImportedWordState, activePdfPath, isPdfActive, saveAs, saveImportedWordDocumentAs, setStatusMessage, syncLatestWysiwygToReact, t])

  const markPendingRestoreRef = useRef<((tabId: string) => void) | null>(null)

  const openFileInNewTab = useCallback(async (path: string) => {
    if (isCreatingTab) return { ok: false } as any

    const pathKey = getFilePathIdentity(path)
    const existingTabId = tabIdsByPathRef.current.get(pathKey)
    if (existingTabId) {
      setActiveTab(existingTabId)
      return { ok: true, data: { path } } as any
    }

    return await openingPathsRef.current.run(path, async () => {
      const existingTabIdBeforeOpen = tabIdsByPathRef.current.get(pathKey)
      if (existingTabIdBeforeOpen) {
        setActiveTab(existingTabIdBeforeOpen)
        return { ok: true, data: { path } } as any
      }

      const isPdf = path.toLowerCase().endsWith('.pdf')
      const isDocx = isWordDocxPath(path)

      if (isPdf) {
        const tab = createTab({ path, content: '' })
        tabIdsByPathRef.current.set(pathKey, tab.id)
        setActiveTab(tab.id)
        return { ok: true, data: { path } } as any
      }

      if (isDocx) {
        return await openImportedWordDocument(path)
      }

      const resp = await openFromPath(path)
      if (resp.ok) {
        const tab = createTab({ path: resp.data.path, content: '' })
        tabIdsByPathRef.current.set(getFilePathIdentity(resp.data.path), tab.id)
        updateTabContent(tab.id, resp.data.content, { markDirty: false })
        applyOpenedContent(resp.data.content)
        markPendingRestoreRef.current?.(tab.id)
      }
      return resp
    })
  }, [isCreatingTab, openFromPath, createTab, updateTabContent, setActiveTab, applyOpenedContent, openImportedWordDocument])

  const openFileFromSidebar = useCallback(async (path: string) => {
    if (isCreatingTab) return { ok: false } as any
    // 点击文件时，清空文件夹选中状态
    setSelectedFolderPath(null)
    return await openFileInNewTab(path)
  }, [isCreatingTab, setSelectedFolderPath, openFileInNewTab])

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

  const performDeletePath = useCallback(async (path: string, kind: SidebarContextTargetKind) => {
    const resp = await deleteFsEntry(path)
    if (!resp.ok) {
      return { ok: false as const, message: resp.error.message ?? `删除失败：${path}` }
    }

    if (kind === 'standalone-file') {
      sidebar.removeStandaloneFile(path)
    } else if (kind === 'tree-file' || kind === 'tree-dir') {
      const normalizedPath = path.replace(/\\/g, '/')
      const parentRoot = sidebar.folderRoots.find((root) => {
        const rootNorm = root.replace(/\\/g, '/')
        return normalizedPath.startsWith(rootNorm + '/')
      })
      if (parentRoot) {
        await sidebar.refreshFolderTree(parentRoot)
      }
    } else if (kind === 'folder-root') {
      sidebar.removeFolderRoot(path)
    }

    closeTabsByPath(path)
    return { ok: true as const }
  }, [sidebar, closeTabsByPath])

  const resolveDeleteKindForPath = useCallback((path: string): SidebarContextTargetKind => {
    const normalizedPath = path.replace(/\\/g, '/')
    const isStandalone = sidebar.standaloneFiles.some((file) => file.path.replace(/\\/g, '/') === normalizedPath)
    if (isStandalone) {
      return 'standalone-file'
    }

    const isFolderRoot = sidebar.folderRoots.some((root) => root.replace(/\\/g, '/') === normalizedPath)
    if (isFolderRoot) {
      return 'folder-root'
    }

    return 'tree-file'
  }, [sidebar.folderRoots, sidebar.standaloneFiles])

  const requestDeletePathWithConfirm = useCallback((path: string, kind: SidebarContextTargetKind) => {
    return new Promise<{ ok: boolean; message: string }>((resolve) => {
      setConfirmDialog({
        title: t('workspace.confirmDeleteTitle'),
        message: t('workspace.confirmDeleteMessage', { path }),
        confirmText: t('workspace.delete'),
        onConfirm: async () => {
          setConfirmDialog(null)
          const result = await performDeletePath(path, kind)
          if (!result.ok) {
            resolve({ ok: false, message: result.message })
            return
          }
          resolve({ ok: true, message: `已删除：${path}` })
        },
        onCancel: () => {
          setConfirmDialog(null)
          resolve({ ok: false, message: t('common.cancel') })
        },
      })
    })
  }, [performDeletePath, t])

  const handleAiDeleteCurrentDocument = useCallback((path: string) => {
    const kind = resolveDeleteKindForPath(path)
    return performDeletePath(path, kind).then((result) => {
      if (!result.ok) {
        return { ok: false, message: result.message }
      }
      return { ok: true, message: `已删除：${path}` }
    })
  }, [resolveDeleteKindForPath, performDeletePath])

  const handleAiDeleteCurrentFolder = useCallback((path: string) => {
    const kind = resolveDeleteKindForPath(path)
    return performDeletePath(path, kind).then((result) => {
      if (!result.ok) {
        return { ok: false, message: result.message }
      }
      return { ok: true, message: `已删除：${path}` }
    })
  }, [resolveDeleteKindForPath, performDeletePath])

  const handleAiDeleteWorkspaceEntry = useCallback(async (
    targetPath: string,
    targetKind?: WorkspaceEntryKind,
  ) => {
    const normalizedTargetPath = targetPath.replace(/\\/g, '/')
    const matchedRoot = sidebar.folderRoots.find((root) => {
      const normalizedRoot = root.replace(/\\/g, '/')
      return (
        normalizedTargetPath === normalizedRoot ||
        normalizedTargetPath.startsWith(`${normalizedRoot}/`)
      )
    })

    if (matchedRoot) {
      const kind =
        targetKind === 'dir'
          ? (
              sidebar.folderRoots.some((root) => root.replace(/\\/g, '/') === normalizedTargetPath)
                ? 'folder-root'
                : 'tree-dir'
            )
          : resolveDeleteKindForPath(normalizedTargetPath)

      const result = await performDeletePath(normalizedTargetPath, kind)
      if (!result.ok) {
        return { ok: false, message: result.message }
      }
      return { ok: true, message: `已删除：${normalizedTargetPath}` }
    }

    const resolved = await resolveWorkspaceEntryByName({
      workspaceRoot: getCurrentWorkspaceRoot(),
      targetPath,
      expectedKind: targetKind,
    })

    if (!resolved.ok) {
      return { ok: false, message: resolved.message }
    }

    const kind =
      resolved.kind === 'dir'
        ? (
            sidebar.folderRoots.some((root) => root.replace(/\\/g, '/') === resolved.resolvedPath)
              ? 'folder-root'
              : 'tree-dir'
          )
        : resolveDeleteKindForPath(resolved.resolvedPath)

    const result = await performDeletePath(resolved.resolvedPath, kind)
    if (!result.ok) {
      return { ok: false, message: result.message }
    }
    return { ok: true, message: `已删除：${resolved.resolvedPath}` }
  }, [getCurrentWorkspaceRoot, sidebar.folderRoots, resolveDeleteKindForPath, performDeletePath])

  const normalizeDirPath = (dir: string): string => {
    if (!dir) return dir
    return dir.replace(/\\/g, '/').replace(/[\\/]+$/, '')
  }

  const generateUniqueMarkdownPath = async (baseFolder: string, rawName: string): Promise<string | null> => {
    const trimmed = rawName.trim()
    if (!trimmed) return null

    if (/[\\/]/.test(trimmed)) {
      setStatusMessage(t('workspace.fileNameCannotContainSeparator'))
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
      setStatusMessage(t('workspace.folderNameCannotContainSeparator'))
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

  const getCurrentSelectionBaseDirectory = useCallback((): string | null => {
    return resolveSelectionBaseDirectory({
      selectedFolderPath,
      currentFilePath: activeTab?.path ?? null,
      fallbackRoot: sidebar.folderRoots[0] ?? null,
    })
  }, [selectedFolderPath, activeTab?.path, sidebar.folderRoots])

  const getCurrentAiDirectoryPath = useCallback((): string | null => {
    return resolveSelectionBaseDirectory({
      selectedFolderPath,
      currentFilePath: activeTab?.path ?? null,
    })
  }, [selectedFolderPath, activeTab?.path])

  const getCurrentFolderForNewFile = (): string | null => {
    const baseDirectory = getCurrentSelectionBaseDirectory()
    if (baseDirectory) {
      return baseDirectory
    }
    setStatusMessage(t('workspace.openFileOrFolderFirst'))
    return null
  }

  const getTargetFolderForNewFolder = (): string | null => {
    const baseDirectory = getCurrentSelectionBaseDirectory()
    if (baseDirectory) {
      return baseDirectory
    }
    setStatusMessage(t('workspace.openFileOrFolderFirst'))
    return null
  }

  const handleDirClick = useCallback((path: string) => {
    setSelectedFolderPath(path)
    setActiveWorkspaceDirectoryPath(path)
  }, [])

  const handleToolbarNewFileInCurrentFolder = useCallback(() => {
    if (isCreatingTab) {
      setStatusMessage(t('workspace.creatingTabPleaseWait'))
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
      setStatusMessage(t('workspace.creatingTabPleaseWait'))
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
      setActiveWorkspaceDirectoryPath(folderPath)

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

  const startFsEntryInlineRename = useCallback(() => {
    // 行内新建文件/文件夹时不再触发重命名，避免交叉状态
    if (inlineNewFileDir || inlineNewFolderDir) {
      return
    }

    const targetPath = selectedFolderPath ?? activeTab?.path ?? null
    if (!targetPath) {
      setStatusMessage(t('workspace.selectFileOrFolderInBrowserFirst'))
      return
    }

    const normalizedTarget = targetPath.replace(/\\/g, '/')
    const isRoot = sidebar.folderRoots.some((root) => {
      const rootNorm = root.replace(/\\/g, '/')
      return rootNorm === normalizedTarget
    })
    if (isRoot) {
      setStatusMessage(t('workspace.renameRootNotSupported'))
      return
    }

    setInlineRenamePath(targetPath)
  }, [inlineNewFileDir, inlineNewFolderDir, selectedFolderPath, activeTab?.path, sidebar.folderRoots, setStatusMessage])

  const requestDeleteSelectedFsEntry = useCallback(() => {
    if (inlineNewFileDir || inlineNewFolderDir || inlineRenamePath) {
      return
    }

    const targetPath = selectedFolderPath ?? activeTab?.path ?? null
    if (!targetPath) {
      setStatusMessage(t('workspace.selectFileOrFolderInBrowserFirst'))
      return
    }

    const kind = resolveDeleteKindForPath(targetPath)
    void requestDeletePathWithConfirm(targetPath, kind)
  }, [
    inlineNewFileDir,
    inlineNewFolderDir,
    inlineRenamePath,
    selectedFolderPath,
    activeTab?.path,
    setStatusMessage,
    t,
    resolveDeleteKindForPath,
    requestDeletePathWithConfirm,
  ])

  const handleInlineRenameCancel = useCallback(() => {
    setInlineRenamePath(null)
  }, [])

  const handleInlineRenameConfirm = useCallback((rawName: string) => {
    const targetPath = inlineRenamePath
    if (!targetPath) return

    const name = rawName.trim()
    if (!name) {
      setStatusMessage(t('workspace.nameCannotBeEmpty'))
      setInlineRenamePath(null)
      return
    }

    if (/[\\/]/.test(name)) {
      setStatusMessage(t('workspace.nameCannotContainSeparator'))
      return
    }

    const hasBackslash = targetPath.includes('\\')
    const normalized = targetPath.replace(/\\/g, '/')
    const lastSlash = normalized.lastIndexOf('/')
    let baseDir: string | null = null
    if (lastSlash >= 0) {
      baseDir = normalized.slice(0, lastSlash)
    }
    const originalName = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized

    const isDirTarget = !!selectedFolderPath && selectedFolderPath === targetPath

    // 文件重命名时，如果用户未显式输入扩展名，则继承原扩展名
    let finalName = name
    if (!isDirTarget) {
      const originalDot = originalName.lastIndexOf('.')
      const originalHasExt = originalDot > 0 && originalDot < originalName.length - 1
      const originalExt = originalHasExt ? originalName.slice(originalDot) : ''

      const newDot = name.lastIndexOf('.')
      const userHasExt = newDot > 0 && newDot < name.length - 1

      if (!userHasExt && originalHasExt) {
        finalName = `${name}${originalExt}`
      }
    }

    const newPathNormalized = baseDir ? `${baseDir}/${finalName}` : finalName
    let newPath = newPathNormalized
    if (hasBackslash) {
      newPath = newPath.replace(/\//g, '\\')
    }

    if (newPath === targetPath) {
      setInlineRenamePath(null)
      return
    }

    const normalizedDir = isDirTarget ? normalized : null

    // 对目录：如果存在打开的子文件，暂不支持重命名，避免路径不一致
    if (isDirTarget && normalizedDir) {
      const hasOpenedUnderDir = tabs.some((t) => {
        if (!t.path) return false
        const tabNorm = t.path.replace(/\\/g, '/')
        return tabNorm === normalizedDir || tabNorm.startsWith(normalizedDir + '/')
      })
      if (hasOpenedUnderDir) {
        setStatusMessage(t('workspace.renameFolderWithOpenFilesNotSupported'))
        setInlineRenamePath(null)
        return
      }
    }

    void (async () => {
      const resp = await renameFsEntry(targetPath, newPath)
      if (!resp.ok) {
        setStatusMessage(resp.error.message)
        setInlineRenamePath(null)
        return
      }

      // 更新选中目录
      if (isDirTarget) {
        setSelectedFolderPath(newPath)
        setActiveWorkspaceDirectoryPath(newPath)
      }

      const normalizedNew = newPath.replace(/\\/g, '/')
      const parentRoot = sidebar.folderRoots.find((rootPath) => {
        const rootNorm = rootPath.replace(/\\/g, '/')
        return normalizedNew === rootNorm || normalizedNew.startsWith(rootNorm + '/')
      }) ?? null

      if (parentRoot) {
        await sidebar.refreshFolderTree(parentRoot)
      } else {
        // 独立文件：从列表中移除旧路径并添加新路径
        sidebar.removeStandaloneFile(targetPath)
        sidebar.addStandaloneFile(newPath)
      }

      // 如果是文件：更新所有对应标签的路径和标题
      if (!isDirTarget) {
        updateTabsPathByPath(targetPath, newPath)
        // 如果是当前活动标签对应的文件，同时同步 filePath
        if (activeTab?.path === targetPath) {
          setFilePath(newPath)
        }
      }

      setInlineRenamePath(null)
    })()
  }, [inlineRenamePath, selectedFolderPath, tabs, setStatusMessage, setSelectedFolderPath, sidebar, activeTab, updateTabsPathByPath, setFilePath])

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
      void requestDeletePathWithConfirm(path, kind)
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
    } else if (action === 'rename') {
      // 禁止重命名根目录，保持与键盘 Enter 行为一致
      if (kind === 'folder-root') {
        setStatusMessage(t('workspace.renameRootNotSupported'))
        return
      }

      // 行内新建文件/文件夹时不再触发重命名，避免交叉状态
      if (inlineNewFileDir || inlineNewFolderDir) {
        return
      }

      // 对目录：同步更新选中的目录路径，便于后续逻辑判断目录重命名
      if (kind === 'tree-dir') {
        setSelectedFolderPath(path)
        setActiveWorkspaceDirectoryPath(path)
      }

      setInlineRenamePath(path)
    }
  }, [
    openFileFromSidebar,
    sidebar,
    requestDeletePathWithConfirm,
    setStatusMessage,
    inlineNewFileDir,
    inlineNewFolderDir,
    setSelectedFolderPath,
    setInlineRenamePath,
  ])

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (activeLeftPanel !== 'files') return

      const isRenameShortcut =
        e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey
      const isDeleteShortcut =
        (e.key === 'Delete' || e.key === 'Backspace') && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey

      if (!isRenameShortcut && !isDeleteShortcut) return

      if (typeof document !== 'undefined') {
        const active = document.activeElement as HTMLElement | null
        const sidebarEl = document.querySelector('.sidebar') as HTMLElement | null
        if (!active || !sidebarEl || !sidebarEl.contains(active)) {
          return
        }

        const tagName = active.tagName
        if (
          tagName === 'INPUT'
          || tagName === 'TEXTAREA'
          || active.isContentEditable
        ) {
          return
        }
      }

      e.preventDefault()
      e.stopPropagation()

      if (isRenameShortcut) {
        startFsEntryInlineRename()
        return
      }

      requestDeleteSelectedFsEntry()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [activeLeftPanel, requestDeleteSelectedFsEntry, startFsEntryInlineRename])

  const isExportingHtmlRef = useRef(false)
  const activeTabPathRef = useRef<string | null>(null)

  // 同步 Ref 以保持回调函数稳定
  useEffect(() => {
    activeTabPathRef.current = activeTab?.path ?? null
  }, [activeTab?.path])

  const handleExportHtml = useCallback(async () => {
    // 防重入
    if (isExportingHtmlRef.current) {
      setStatusMessage(t('workspace.preparingExportPleaseWait'))
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
        getFilePath: () => activeTabPathRef.current,
        t,
      })
    } catch (e) {
      console.error('[Export] 动态加载失败:', e)
      setStatusMessage(t('workspace.exportFeatureLoadFailed'))
    } finally {
      isExportingHtmlRef.current = false
    }
  }, [setStatusMessage, getCurrentMarkdown, getCurrentFileName])

  const handleExportWord = useCallback(async () => {
    if (isPdfActive) {
      setStatusMessage(t('workspace.exportWordUnsupportedPdf'))
      return
    }

    try {
      const { exportToWord: dynamicWordExport } = await import('../modules/export/word')
      await dynamicWordExport({
        setStatusMessage,
        getCurrentMarkdown,
        getCurrentFileName,
        getFilePath: () => activeTabPathRef.current,
        confirmContinue: ({ title, message, confirmText, cancelText }) =>
          new Promise<boolean>((resolve) => {
            setConfirmDialog({
              title,
              message,
              confirmText,
              cancelText,
              onConfirm: () => {
                setConfirmDialog(null)
                resolve(true)
              },
              onCancel: () => {
                setConfirmDialog(null)
                resolve(false)
              },
            })
          }),
        t,
      })
    } catch (e) {
      console.error('[Export Word] 动态加载失败:', e)
      setStatusMessage(t('workspace.exportWordLoadFailed'))
    }
  }, [isPdfActive, setStatusMessage, getCurrentMarkdown, getCurrentFileName, t])

  const openSearchWithSelection = useCallback(() => {
    const view = editorViewRef.current
    const selection = view?.state?.selection?.main
    const nextSearchText =
      view && selection && !selection.empty
        ? view.state.sliceDoc(selection.from, selection.to)
        : ''

    setSearchPrefillText(nextSearchText)
    setSearchPrefillVersion((prev) => prev + 1)
    setIsSearchOpen(true)
  }, [])

  const openInsertTableDialog = useCallback(() => {
    if (isPdfActive) {
      setStatusMessage(t('workspace.insertTableUnsupportedPdf'))
      return
    }
    setIsInsertTableDialogOpen(true)
  }, [isPdfActive, setStatusMessage, t])

  const openMathSymbolDialog = useCallback((categoryKey: string) => {
    setMathSymbolDialog({ open: true, categoryKey })
  }, [])

  const rememberRecentTextColor = useCallback((color: string) => {
    const normalized = normalizeTextColor(color)
    if (!normalized) return
    setRecentTextColors((prev) => {
      const next = [normalized, ...prev.filter((item) => item !== normalized)].slice(0, MAX_RECENT_TEXT_COLORS)
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(RECENT_TEXT_COLORS_STORAGE_KEY, JSON.stringify(next))
        }
      } catch {
        // ignore local persistence failures
      }
      return next
    })
  }, [])

  const openTextColorDialog = useCallback(() => {
    if (isPdfActive) {
      setStatusMessage(t('workspace.textColorUnsupportedPdf'))
      return
    }
    setIsTextColorDialogOpen(true)
  }, [isPdfActive, setStatusMessage, t])

  const handleTextColorDialogConfirm = useCallback(async (color: string) => {
    const normalized = normalizeTextColor(color)
    if (!normalized) return
    await applyTextColor(normalized)
    rememberRecentTextColor(normalized)
    setStatusMessage(t('commands.formatTextColorApplied', { color: normalized }))
    setIsTextColorDialogOpen(false)
  }, [rememberRecentTextColor, setStatusMessage, t])

  const handleTextColorDialogClear = useCallback(async () => {
    await clearTextColor()
    setStatusMessage(t('commands.formatTextColorCleared'))
    setIsTextColorDialogOpen(false)
  }, [setStatusMessage, t])

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
        setStatusMessage(t('workspace.insertTableUnsupportedPdf'))
        return
      }

      if (editMode === 'wysiwyg') {
        wysiwygFormatActionsRef.current?.insertTable(rows, cols)
        return
      }

      const tableMarkdown = generateMarkdownTable(rows, cols)
      await insertMarkdownAtCursorBelow(tableMarkdown)
    },
    [editMode, generateMarkdownTable, insertMarkdownAtCursorBelow, isPdfActive, setStatusMessage, t],
  )

  const { dispatchAction } = useCommandSystem({
    layout, setLayout: setLayout as any, setShowPreview, setStatusMessage,
    aiChatMode, setAiChatMode, aiChatDockSide, setAiChatDockSide, aiChatOpen, aiChatOpenRef,
    editorZoom, setEditorZoom,
    isPdfActive,
    onPdfZoomIn: () => pdfZoomActionsRef.current?.zoomIn() ?? null,
    onPdfZoomOut: () => pdfZoomActionsRef.current?.zoomOut() ?? null,
    onPdfZoomReset: () => pdfZoomActionsRef.current?.zoomReset() ?? null,
    onPdfSelectTool: () => pdfShortcutActionsRef.current?.selectTool(),
    onPdfActivateMarkupTool: (tool: 'highlight' | 'underline' | 'strikeout' | 'squiggly') => pdfShortcutActionsRef.current?.activateMarkupTool(tool),
    onPdfActivateShapeTool: (tool: 'square' | 'circle' | 'line' | 'arrow') => pdfShortcutActionsRef.current?.activateShapeTool(tool),
    onPdfActivateStampTool: () => pdfShortcutActionsRef.current?.activateStampTool(),
    onPdfActivateFreeTextTool: () => pdfShortcutActionsRef.current?.activateFreeTextTool(),
    onPdfAddNote: () => pdfShortcutActionsRef.current?.addNote(),
    onPdfAddDetachedNote: () => pdfShortcutActionsRef.current?.addDetachedNote(),
    onPdfDeleteSelected: () => pdfShortcutActionsRef.current?.deleteSelected(),
    onPdfSelectColorIndex: (index: number) => pdfShortcutActionsRef.current?.selectColorIndex(index),
    editMode, setEditMode: setEditModeWithFlush,
    confirmLoseChanges, hasUnsavedChanges, newDocument, setFilePath, applyOpenedContent,
    openFile, importWordFile, openImportedWordDocument, save: saveWithPdfGuard, saveAs: saveAsWithPdfGuard, handleShowRecent: undefined, clearRecentAll,
    createTab, updateActiveMeta, openFolderInSidebar, toggleSidebarVisible, closeCurrentTab,
    openSearch: openSearchWithSelection,
    openInsertTableDialog,
    openMathSymbolDialog,
    openTextColorDialog,
    insertWordTemplateFrontMatter: insertDefaultWordTemplateFrontMatter,
    openCalendarDialog: () => setCalendarDialogOpen(true),
    openAlarmDialog: () => setAlarmDialogOpen(true),
    openReminderToolDialog: () => setReminderToolDialogOpen(true),
    openMusicPlayerDialog: () => setMusicPlayerDialogOpen(true),
    openPomodoroDialog: pomodoro.openDialog,
    openAiChatDialog: (options: any) => openAiChatDialog(options as any),
    closeAiChatDialog,
    openGlobalMemoryDialog,
    openAboutDialog,
    openReleaseNotesDialog,
    openIssueReportDialog,
    getCurrentMarkdown, getCurrentFileName, getCurrentSelectionText, getCurrentFilePath,
    onRequestCloseCurrentTab: () => closeCurrentTabRef.current?.(),
    onRequestQuit: handleQuit, isTauriEnv,
    addStandaloneFile: sidebar.addStandaloneFile,
    openDocConversationsHistory: (docPath: string) => openDocHistoryDialog(docPath),
    refreshPdfRecent,
    hasOpenTabs: () => tabs.length > 0,
    exportHtml: handleExportHtml,
    exportWord: handleExportWord,
    openRecentDialog: () => setRecentDialogOpen(true),
    t,
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
      const isWysiwyg = editMode === 'wysiwyg' && !isPdfActive
      const active = typeof document !== 'undefined' ? document.activeElement : null
      const wysiwygFocused = Boolean(active?.closest('.wysiwyg-editor'))

      if (isWysiwyg && !wysiwygFocused) {
        console.warn('[WorkspaceShell] onNativePasteImage: WYSIWYG is not focused')
        return
      }
      if (!isWysiwyg && !view) {
        console.warn('[WorkspaceShell] onNativePasteImage: no editor view')
        return
      }

      // 仅当焦点在编辑器内部时才处理粘贴，避免与其他输入框冲突
      if (typeof document !== 'undefined') {
        const contains = active
          ? (isWysiwyg ? wysiwygFocused : Boolean(view?.dom.contains(active)))
          : false
        console.log('[WorkspaceShell] onNativePasteImage: active in editor =', contains)
        if (active && !contains) {
          return
        }
      }

      if (isTransientFilePath(filePath)) {
        console.warn('[WorkspaceShell] onNativePasteImage: no filePath, cannot determine images dir')
        setConfirmDialogRef.current({
          title: t('workspace.cannotInsertImageTitle'),
          message: t('workspace.cannotInsertImageMessage'),
          confirmText: t('workspace.ok'),
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
          setStatusMessage(result?.Err?.error?.message || t('workspace.pasteImageBackendError'))
          return
        }

        const fileName = okPart?.data?.file_name as string | undefined
        if (!fileName) {
          console.error('[WorkspaceShell] onNativePasteImage: missing file_name in Ok.data')
          setStatusMessage(t('workspace.pasteImageMissingFileName'))
          return
        }

        const relPath = `${relDir}/${fileName}`

        if (isWysiwyg) {
          const inserted = wysiwygFormatActionsRef.current?.insertImage(relPath) ?? false
          if (!inserted) {
            setStatusMessage(t('workspace.pasteImageFailed', { message: '无法插入图片' }))
          }
          return
        }

        if (!view) return

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
        setStatusMessage(t('workspace.pasteImageFailed', { message: String(err) }))
      }
    })

    return () => {
      unlisten()
    }
  }, [editMode, editorViewRef, filePath, isPdfActive, setStatusMessage, t])

  const saveCursorPositionRef = useRef<((globalLine: number) => void) | null>(null)

  const handleCursorChange = useCallback((localLine: number) => {
    // 程序性滚动期间不更新 activeLine，避免触发大文档 effect 重算 chunk
    if (isProgrammaticScrollRef.current) return

    const globalLine = localToGlobal(localLine)
    setActiveLine(globalLine)

    saveCursorPositionRef.current?.(globalLine)
  }, [localToGlobal, setActiveLine])

  const focusEditorOnGlobalLine = useCallback((globalLine: number, searchText?: string, columnStart?: number) => {
    const safeGlobal = globalLine > 0 ? globalLine : 1
    const result = focusOnGlobalLine(safeGlobal, searchText, columnStart)
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
    if (isPdfActive && item.source === 'pdf' && typeof item.page === 'number') {
      setPdfOutlineRequestedPage({ page: item.page })
      return
    }
    setActiveOutlineId(item.id)
    if (effectiveLayout === 'preview-only') setLayout('preview-left')
    const wysiwygTarget = getWysiwygOutlineNavigationTarget(item)
    if (editModeRef.current === 'wysiwyg' && wysiwygTarget) {
      const didNavigate = wysiwygOutlineNavigatorRef.current?.(wysiwygTarget)
      if (didNavigate) return
    }
    const markdownTarget = getMarkdownOutlineFallbackTarget(item)
    if (markdownTarget) {
      focusEditorOnGlobalLine(markdownTarget.line, markdownTarget.searchText)
    }
  }, [effectiveLayout, focusEditorOnGlobalLine, isPdfActive, setLayout])

  const handleSearchResultOpen = useCallback(async (params: {
    path: string
    line: number
    columnStart: number
    searchText: string
    caseSensitive: boolean
    wholeWord: boolean
    regex: boolean
  }) => {
    const resp = await openFileFromSidebar(params.path)
    if (!resp?.ok) {
      setStatusMessage(t('searchPanel.openResultFailed'))
      return
    }
    setTransientSearchQuery({
      searchText: params.searchText,
      caseSensitive: params.caseSensitive,
      wholeWord: params.wholeWord,
      regex: params.regex,
    })
    focusEditorOnGlobalLine(params.line, params.searchText, params.columnStart)
  }, [focusEditorOnGlobalLine, openFileFromSidebar, setStatusMessage, t])

  const handleTabSaveAndClose = useCallback(async (id: string) => {
    const isActive = id === activeId
    const tab = tabs.find(t => t.id === id)
    if (!isActive) {
      setConfirmDialog({
        title: t('workspace.cannotSaveBackgroundTab'),
        message: t('workspace.closeAndDiscardChanges', { title: tab?.title ?? '' }),
        confirmText: t('workspace.discardAndClose'),
        onConfirm: () => { setConfirmDialog(null); closeTabWithAiSession(id); }
      })
    } else {
      handleCurrentTabClose()
    }
  }, [activeId, tabs, closeTabWithAiSession, handleCurrentTabClose, t])

  const initialActionHandledRef = useRef(false)
  useEffect(() => {
    if (!initialAction || initialActionHandledRef.current) return
    if (initialAction === 'new') createTab()
    else if (initialAction === 'open') void dispatchAction('open_file')
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
    dispatchAction,
    openFolderInSidebar,
    openRecentFileInNewTab,
    sidebar,
    onInitialActionHandled,
  ])

  return (
    <AiChatCommandBridgeContext.Provider value={aiChatCommandBridge}>
      <>
        <div
          className={`workspace-region ${hasWorkspaceBackground ? 'has-workspace-background' : ''} ${workspaceBackgroundIncludesSidebar ? 'workspace-background-includes-sidebar' : ''} ${workspaceBackgroundFitClass}`.trim()}
          style={workspaceBackgroundIncludesSidebar ? workspaceBackgroundStyle : undefined}
          onScroll={preventContainerScroll}
        >
          {hasWorkspaceBackground && workspaceBackgroundIncludesSidebar ? (
            <>
              <img className="workspace-background" src={workspaceBackgroundUrl ?? ''} alt="" aria-hidden="true" />
              <div className="workspace-background-overlay" aria-hidden="true" />
            </>
          ) : null}
          <div className="workspace-region-content">
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
            inlineRenamePath={inlineRenamePath}
            onInlineRenameConfirm={handleInlineRenameConfirm}
            onInlineRenameCancel={handleInlineRenameCancel}
            onRequestConfirmDeleteFileVirtualFolder={({ folder, onConfirm }) => {
              setConfirmDialog({
                title: t('workspace.deleteVirtualFolderTitle'),
                message: t('workspace.deleteVirtualFolderMessage', { name: folder.name }),
                confirmText: t('workspace.delete'),
                cancelText: t('common.cancel'),
                onConfirm: () => {
                  setConfirmDialog(null)
                  onConfirm()
                },
              })
            }}
            onNotify={setStatusMessage}
          />
        )}
        {activeLeftPanel === 'search' && (
          <GlobalSearchPanel
            panelWidth={sidebarWidth}
            folderRoots={sidebar.folderRoots}
            standaloneFiles={sidebar.standaloneFiles}
            onOpenResult={handleSearchResultOpen}
            onStatusMessage={setStatusMessage}
          />
        )}
        {activeLeftPanel === 'outline' && (
          <OutlinePanel
            items={outlineItemsForPanel}
            activeId={outlineActiveId}
            onSelect={handleOutlineSelect}
            panelWidth={sidebarWidth}
            emptyTitle={outlineEmptyTitle}
            emptyHint={outlineEmptyHint}
          />
        )}
        {activeLeftPanel === 'pdf' && (
          <SidebarBackgroundShell as="div" className="pdf-panel" style={{ width: sidebarWidth }}>
            <div className="pdf-panel-header">
              <span>{t('pdf.title')}</span>
              <button
                type="button"
                className="pdf-folder-add-btn"
                title={t('workspace.newVirtualFolder')}
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
                    placeholder={t('workspace.virtualFolderPlaceholder')}
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
                <p style={{ color: 'var(--theme-text-muted)', padding: '12px', fontSize: '13px' }}>{t('pdf.loadingRecent')}</p>
              )}
              {!pdfRecentLoading && pdfRecentError && (
                <p style={{ color: 'var(--theme-accent-danger)', padding: '12px', fontSize: '13px' }}>{pdfRecentError}</p>
              )}
              {!pdfRecentLoading && !pdfRecentError && pdfRecent.length === 0 && (
                <p style={{ color: 'var(--theme-text-muted)', padding: '12px', fontSize: '13px' }}>
                  {t('pdf.noRecent')}
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
                                title={t('sidebar.deleteVirtualFolder')}
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
                            <div className="pdf-folder-empty" style={{ padding: '4px 12px', fontSize: '12px', color: 'var(--theme-text-muted)' }}>
                              {t('workspace.pdfFolderEmpty')}
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
                      label: t('workspace.open'),
                      onClick: () => {
                        void openRecentFileInNewTab(pdfMenuState.targetPath!)
                        closePdfMenu()
                      },
                    },
                    {
                      id: 'move-to-folder-menu',
                      label: t('workspace.moveToVirtualFolder'),
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
                      label: t('workspace.openInFileManager'),
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
                      label: t('workspace.removeFromRecent'),
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
                      label: t('workspace.moveToRootNoFolder'),
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
          </SidebarBackgroundShell>
        )}
        {activeLeftPanel === 'sessions' && (
          <SessionsPanel
            panelWidth={sidebarWidth}
            activeSessionKey={aiChatSessionKey}
            onSelectSession={(key) => {
              setAiChatSessionKey(key as AiChatSessionKey)
            }}
          />
        )}
        {activeLeftPanel === 'notes' && (
          <NotesPanel
            panelWidth={sidebarWidth}
            onOpenFile={openFileFromSidebar}
          />
        )}
        {activeLeftPanel === 'skills' && <SkillsPanel panelWidth={sidebarWidth} />}
        {activeLeftPanel === 'workflows' && <WorkflowsPanel panelWidth={sidebarWidth} />}
        {(activeLeftPanel === 'files' || activeLeftPanel === 'search' || activeLeftPanel === 'outline' || activeLeftPanel === 'pdf' || activeLeftPanel === 'sessions' || activeLeftPanel === 'notes' || activeLeftPanel === 'skills' || activeLeftPanel === 'workflows') && (
          <div className={`sidebar-resizer ${isSidebarResizing ? 'active' : ''}`} onMouseDown={handleSidebarResizeStart} />
        )}

        <div
          className={`workspace-column ${hasWorkspaceBackground && !workspaceBackgroundIncludesSidebar ? 'workspace-column-with-background' : ''} ${workspaceBackgroundFitClass}`.trim()}
          style={hasWorkspaceBackground && !workspaceBackgroundIncludesSidebar ? workspaceBackgroundStyle : undefined}
        >
          {hasWorkspaceBackground && !workspaceBackgroundIncludesSidebar ? (
            <>
              <img className="workspace-background" src={workspaceBackgroundUrl ?? ''} alt="" aria-hidden="true" />
              <div className="workspace-background-overlay" aria-hidden="true" />
            </>
          ) : null}
          <div className="workspace-column-content">
          {aiChatSessionKey.startsWith('session:') ? (
            <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4, fontSize: 13, height: '100%' }}>{t('workspace.loadingAiPane')}</div>}>
                <AiChatPaneLazy
                key={aiChatSessionKey}
                sessionKey={aiChatSessionKey}
                entryMode="chat"
                onClose={() => setAiChatSessionKey('global')}
                currentFilePath={aiChatFilePath}
                currentFolderPath={selectedFolderPath}
                currentDirectoryPath={getCurrentAiDirectoryPath()}
                docPathOverride={aiChatDocPathOverride}
                getCurrentMarkdown={getCurrentMarkdown}
                getCurrentFileName={getCurrentFileName}
                getCurrentFilePath={getCurrentFilePath}
                getCurrentFolderPath={() => selectedFolderPath}
                getCurrentDirectoryPath={getCurrentAiDirectoryPath}
                getCurrentWorkspaceRoot={getCurrentWorkspaceRoot}
                onDocumentSaved={handleAiDocumentSaved}
                onConfirmDeleteCurrentDocument={handleAiDeleteCurrentDocument}
                onConfirmDeleteCurrentFolder={handleAiDeleteCurrentFolder}
                onConfirmDeleteWorkspaceEntry={handleAiDeleteWorkspaceEntry}
                onRenameCurrentDocument={handleAiRenameCurrentDocument}
                onRenameWorkspaceEntry={handleAiRenameWorkspaceEntry}
                onCreateDirectoryUnderSelection={handleAiCreateDirectoryUnderSelection}
                onCreateDirectoryInWorkspace={handleAiCreateDirectoryInWorkspace}
                setStatusMessage={setStatusMessage}
                t={t}
                sourceTabId={null}
                onInputFocusChange={setIsAiChatInputFocused}
                fullPage
              />
            </Suspense>
          ) : tabs.length === 0 ? (
            <Welcome
              onNewFile={() => createTab()}
              onOpenFile={() => void dispatchAction('open_file')}
              onOpenAiChat={() => {
                openAiChatDialog({ entryMode: 'chat', forceMode: 'floating' })
              }}
            />
          ) : (
            <>
              {effectiveLayout === 'preview-only' && (
                <TabBar
                  tabs={tabs}
                  activeId={activeId}
                  onTabClick={setActiveTab}
                  onTabClose={closeTabWithAiSession}
                  onRequestSaveAndClose={handleTabSaveAndClose}
                />
              )}
              <main className={`workspace ${dragging ? 'dragging' : ''}`} onScroll={preventContainerScroll} style={{ gridTemplateColumns: outerGridTemplateColumns }}>
                {effectiveAiChatMode === 'docked' && aiChatOpen && aiChatState && (
                  <>
                    {aiChatDockSide === 'left' && (
                      <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4, fontSize: 13, height: '100%' }}>{t('workspace.loadingAiPane')}</div>}>
                        <AiChatPaneLazy
                          sessionKey={aiChatSessionKey}
                          entryMode={aiChatState.entryMode}
                          initialContext={aiChatState.initialContext}
                          onClose={closeAiChatDialog}
                          currentFilePath={aiChatFilePath}
                          currentFolderPath={selectedFolderPath}
                          currentDirectoryPath={getCurrentAiDirectoryPath()}
                          docPathOverride={aiChatDocPathOverride}
                          getCurrentMarkdown={getCurrentMarkdown}
                          getCurrentFileName={getCurrentFileName}
                          getCurrentFilePath={getCurrentFilePath}
                          getCurrentFolderPath={() => selectedFolderPath}
                          getCurrentDirectoryPath={getCurrentAiDirectoryPath}
                          getCurrentWorkspaceRoot={getCurrentWorkspaceRoot}
                          onDocumentSaved={handleAiDocumentSaved}
                          onConfirmDeleteCurrentDocument={handleAiDeleteCurrentDocument}
                          onConfirmDeleteCurrentFolder={handleAiDeleteCurrentFolder}
                          onConfirmDeleteWorkspaceEntry={handleAiDeleteWorkspaceEntry}
                          onRenameCurrentDocument={handleAiRenameCurrentDocument}
                          onRenameWorkspaceEntry={handleAiRenameWorkspaceEntry}
                          onCreateDirectoryUnderSelection={handleAiCreateDirectoryUnderSelection}
                          onCreateDirectoryInWorkspace={handleAiCreateDirectoryInWorkspace}
                          setStatusMessage={setStatusMessage}
                          t={t}
                          sourceTabId={activeTab?.id ?? null}
                          onInputFocusChange={setIsAiChatInputFocused}
                        />
                      </Suspense>
                    )}
                    <div className="divider-hotzone vertical" style={{ position: 'absolute', left: aiChatDockSide === 'left' ? aiChatWidth : `calc(100% - ${aiChatWidth}px)`, height: '100%', zIndex: 100, cursor: 'col-resize' }} onMouseDown={handleAiChatResizeStart}>
                      <div className="divider-rail"><span className="divider-handle" /></div>
                    </div>
                  </>
                )}
                <section className="pane-group editor-preview-group" style={{ gridTemplateColumns: editMode === 'wysiwyg' && !isPdfActive ? '1fr' : isPdfActive ? '1fr' : gridTemplateColumns }} ref={workspaceRef}>
                  {isPdfActive ? (
                    <section className="pane preview" style={{ gridColumn: '1 / -1', gridRow: '1 / 2' }}>
                      <Suspense fallback={<div className="code-editor" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4, fontSize: 13 }}>{t('workspace.loadingPreview')}</div>}>
                        <TabBar
                          tabs={tabs}
                          activeId={activeId}
                          onTabClick={setActiveTab}
                          onTabClose={closeTabWithAiSession}
                          onRequestSaveAndClose={handleTabSaveAndClose}
                        />
                        {activeTab?.path && (
                          <PdfViewerLazy
                            filePath={activeTab.path}
                            isSuspended={shouldSuspendPdfViewer}
                            onRegisterSelectionGetter={handlePdfRegisterSelectionGetter}
                            onCurrentPageChange={setPdfCurrentPage}
                            onRegisterZoomActions={handlePdfRegisterZoomActions}
                            onRegisterShortcutActions={handlePdfRegisterShortcutActions}
                            onOutlineItemsChange={setPdfOutlineItems}
                            onOutlineLoadingChange={setPdfOutlineLoading}
                            requestedOutlinePage={pdfOutlineRequestedPage?.page ?? null}
                            onRequestedOutlinePageHandled={handlePdfRequestedOutlinePageHandled}
                          />
                        )}
                      </Suspense>
                    </section>
                  ) : editMode === 'wysiwyg' && !isPdfActive ? (
                    /* WYSIWYG 所见即所得模式 */
                    <section className="pane editor-pane" style={{ gridColumn: '1/-1' }}>
                      <Suspense fallback={<div className="code-editor" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4, fontSize: 13 }}>{t('workspace.loadingEditor')}</div>}>
                        <TabBar
                          tabs={tabs}
                          activeId={activeId}
                          onTabClick={setActiveTab}
                          onTabClose={closeTabWithAiSession}
                          onRequestSaveAndClose={handleTabSaveAndClose}
                        />
                        <WysiwygPaneLazy
                          key={activeId ?? 'wysiwyg-empty'}
                          value={wysiwygBodyMarkdown}
                          frontMatterBlock={wysiwygFrontMatterBlock}
                          docKey={activeId ?? null}
                          editorZoom={editorZoom}
                          skipUnmountFlushRef={skipWysiwygUnmountFlushRef}
                          onChange={(val) => {
                            if (!activeId) return
                            handleWysiwygChange(activeId, val)
                          }}
                          onSelectionGetterReady={(getter) => {
                            wysiwygSelectionGetterRef.current = getter
                          }}
                          onMarkdownGetterReady={(getter) => {
                            wysiwygMarkdownGetterRef.current = getter
                          }}
                          onOutlineNavigatorReady={(navigator) => {
                            wysiwygOutlineNavigatorRef.current = navigator
                          }}
                          onOutlineItemsChange={handleWysiwygOutlineItemsChange}
                          onFormatActionsReady={(actions) => {
                            wysiwygFormatActionsRef.current = actions
                          }}
                          onFlushReady={(flush) => {
                            wysiwygFlushRef.current = flush
                          }}
                          onDirty={() => { wysiwygIsDirtyRef.current = true; markDirty(); markActiveTabDirty() }}
                          filePath={filePath}
                          effectiveLayout="preview-only"
                        />
                      </Suspense>
                    </section>
                  ) : (
                    /* 源码编辑模式（原有逻辑） */
                    <>
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
                    <Suspense fallback={<div className="code-editor" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4, fontSize: 13 }}>{t('workspace.loadingEditor')}</div>}>
                      {effectiveLayout !== 'preview-only' && (
                        <TabBar
                          tabs={tabs}
                          activeId={activeId}
                          onTabClick={setActiveTab}
                          onTabClose={closeTabWithAiSession}
                          onRequestSaveAndClose={handleTabSaveAndClose}
                        />
                      )}
                      {isSearchOpen && (
                        <SearchBar
                          view={editorViewRef.current}
                          prefillText={searchPrefillText}
                          prefillVersion={searchPrefillVersion}
                          onClose={() => setIsSearchOpen(false)}
                        />
                      )}
                      <EditorPaneLazy
                        markdown={editorContent}
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
                        transientSearchQuery={transientSearchQuery}
                      />
                    </Suspense>
                  </section>

                  <PreviewErrorBoundary>
                  <Suspense fallback={<section className="pane preview"><div className="preview-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4, fontSize: 13 }}>{t('workspace.loadingPreview')}</div></section>}>
                    <PreviewPaneLazy
                      value={previewValue}
                      activeLine={previewActiveLine}
                      previewWidth={previewWidthForRender}
                      effectiveLayout={effectiveLayout}
                      loading={isPreviewLoading}
                      loadingLabel={t('workspace.loadingPreview')}
                      filePath={filePath}
                      foldRegions={foldRegions}
                      onPreviewLineClick={handlePreviewLineClick}
                      onSelectionChange={setPreviewSelectionText}
                    />
                  </Suspense>
                  </PreviewErrorBoundary>
                    </>
                  )}

                  {!isPdfActive && effectiveLayout !== 'editor-only' && editMode !== 'wysiwyg' && (effectiveLayout === 'preview-left' || effectiveLayout === 'preview-right') && (
                    <div className={`divider-hotzone editor-preview-divider ${dragging ? 'active' : ''}`} style={{ left: effectiveLayout === 'preview-left' ? `${previewWidthForRender}%` : `${100 - previewWidthForRender}%` }} onMouseDown={startDragging}>
                      <div className="divider-rail"><span className="divider-handle" /></div>
                    </div>
                  )}
                </section>
                {effectiveAiChatMode === 'docked' && aiChatOpen && aiChatState && aiChatDockSide === 'right' && (
                  <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4, fontSize: 13, height: '100%' }}>{t('workspace.loadingAiPane')}</div>}>
                      <AiChatPaneLazy
                        sessionKey={aiChatSessionKey}
                        entryMode={aiChatState.entryMode}
                        initialContext={aiChatState.initialContext}
                        onClose={closeAiChatDialog}
                        currentFilePath={aiChatFilePath}
                        currentFolderPath={selectedFolderPath}
                        currentDirectoryPath={getCurrentAiDirectoryPath()}
                        docPathOverride={aiChatDocPathOverride}
                        getCurrentMarkdown={getCurrentMarkdown}
                        getCurrentFileName={getCurrentFileName}
                        getCurrentFilePath={getCurrentFilePath}
                        getCurrentFolderPath={() => selectedFolderPath}
                        getCurrentDirectoryPath={getCurrentAiDirectoryPath}
                        getCurrentWorkspaceRoot={getCurrentWorkspaceRoot}
                        onDocumentSaved={handleAiDocumentSaved}
                        onConfirmDeleteCurrentDocument={handleAiDeleteCurrentDocument}
                        onConfirmDeleteCurrentFolder={handleAiDeleteCurrentFolder}
                        onConfirmDeleteWorkspaceEntry={handleAiDeleteWorkspaceEntry}
                        onRenameCurrentDocument={handleAiRenameCurrentDocument}
                        onRenameWorkspaceEntry={handleAiRenameWorkspaceEntry}
                        onCreateDirectoryUnderSelection={handleAiCreateDirectoryUnderSelection}
                        onCreateDirectoryInWorkspace={handleAiCreateDirectoryInWorkspace}
                        setStatusMessage={setStatusMessage}
                        t={t}
                        sourceTabId={activeTab?.id ?? null}
                        onInputFocusChange={setIsAiChatInputFocused}
                      />
                  </Suspense>
                )}
              </main>
            </>
          )}
          </div>
        </div>
          </div>
        </div>

        {conflictError && (
          <ConflictModal
            error={conflictError}
            onRetrySave={async () => {
              await guardedSaveRef.current?.()
            }}
            onCancel={() => setConflictError(null)}
          />
        )}
        {confirmDialog && <ConfirmDialog title={confirmDialog.title} message={confirmDialog.message} confirmText={confirmDialog.confirmText} cancelText={confirmDialog.cancelText} extraText={confirmDialog.extraText} variant={confirmDialog.variant} onConfirm={confirmDialog.onConfirm} onExtra={confirmDialog.onExtra} onCancel={confirmDialog.onCancel ?? (() => setConfirmDialog(null))} />}
        {quitConfirmDialog && <ConfirmDialog title={quitConfirmDialog.unsavedCount === 1 ? t('workspace.saveChangesTitle') : t('workspace.saveFilesTitle', { count: quitConfirmDialog.unsavedCount })} message={t('workspace.saveChangesMessage')} confirmText={t('workspace.saveAll')} cancelText={t('common.cancel')} extraText={t('workspace.dontSave')} variant="stacked" onConfirm={quitConfirmDialog.onSaveAll} onExtra={quitConfirmDialog.onQuitWithoutSaving} onCancel={() => setQuitConfirmDialog(null)} />}

        <InsertTableDialog
          open={isInsertTableDialogOpen}
          onConfirm={handleInsertTableConfirm}
          onCancel={() => setIsInsertTableDialogOpen(false)}
        />

        <MathSymbolDialog
          open={mathSymbolDialog.open}
          categoryKey={mathSymbolDialog.categoryKey}
          onClose={() => setMathSymbolDialog({ open: false, categoryKey: mathSymbolDialog.categoryKey })}
        />

        <CalendarDialog
          open={calendarDialogOpen}
          onClose={() => setCalendarDialogOpen(false)}
        />

        <AlarmDialog
          open={alarmDialogOpen}
          onClose={() => setAlarmDialogOpen(false)}
        />

        <AlarmRingDialog
          open={alarmScheduler.activeAlarm !== null}
          alarm={alarmScheduler.activeAlarm}
          onStop={alarmScheduler.dismissAlarm}
          onSnooze={alarmScheduler.snoozeAlarm}
        />

        <ReminderToolDialog
          open={reminderToolDialogOpen}
          onClose={() => setReminderToolDialogOpen(false)}
        />

        <MusicPlayerDialog
          open={musicPlayerDialogOpen}
          onClose={() => setMusicPlayerDialogOpen(false)}
        />

        <PomodoroDialog
          open={pomodoro.dialogOpen}
          controller={pomodoro}
          onClose={pomodoro.closeDialog}
        />

        <TextColorDialog
          open={isTextColorDialogOpen}
          recentColors={recentTextColors}
          onConfirm={(color) => { void handleTextColorDialogConfirm(color) }}
          onClear={() => { void handleTextColorDialogClear() }}
          onCancel={() => setIsTextColorDialogOpen(false)}
        />

        {effectiveAiChatMode === 'floating' && aiChatOpen && aiChatState?.open && (
          <Suspense fallback={null}>
            <AiChatDialogLazy
              open={aiChatOpen}
              entryMode={aiChatState.entryMode}
              initialContext={aiChatState.initialContext}
              onClose={closeAiChatDialog}
              currentFilePath={aiChatFilePath}
              currentFolderPath={selectedFolderPath}
              currentDirectoryPath={getCurrentAiDirectoryPath()}
              docPathOverride={aiChatDocPathOverride}
              getCurrentMarkdown={getCurrentMarkdown}
              getCurrentFileName={getCurrentFileName}
              getCurrentFilePath={getCurrentFilePath}
              getCurrentFolderPath={() => selectedFolderPath}
              getCurrentDirectoryPath={getCurrentAiDirectoryPath}
              getCurrentWorkspaceRoot={getCurrentWorkspaceRoot}
              onDocumentSaved={handleAiDocumentSaved}
              onConfirmDeleteCurrentDocument={handleAiDeleteCurrentDocument}
              onConfirmDeleteCurrentFolder={handleAiDeleteCurrentFolder}
              onConfirmDeleteWorkspaceEntry={handleAiDeleteWorkspaceEntry}
              onRenameCurrentDocument={handleAiRenameCurrentDocument}
              onRenameWorkspaceEntry={handleAiRenameWorkspaceEntry}
              onCreateDirectoryUnderSelection={handleAiCreateDirectoryUnderSelection}
              onCreateDirectoryInWorkspace={handleAiCreateDirectoryInWorkspace}
              setStatusMessage={setStatusMessage}
              t={t}
              onInputFocusChange={setIsAiChatInputFocused}
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
        <ReleaseNotesDialog open={releaseNotesOpen} onClose={closeReleaseNotesDialog} />
        <IssueReportDialog open={issueReportOpen} onClose={closeIssueReportDialog} />
      </>
    </AiChatCommandBridgeContext.Provider>
  )
}

export default WorkspaceShell
