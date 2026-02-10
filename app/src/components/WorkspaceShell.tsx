import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorView } from '@codemirror/view'
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { Store } from '@tauri-apps/plugin-store'
import { ConflictModal } from './ConflictModal'
import { ConfirmDialog } from './ConfirmDialog'
import { TabBar } from './TabBar'
import { Sidebar, type SidebarContextActionPayload } from './Sidebar'
import { OutlinePanel } from './OutlinePanel'
import { Welcome } from './Welcome'
import { useOutline } from '../hooks/useOutline'
import type { OutlineItem } from '../modules/outline/parser'
import { useWorkspaceLayout } from '../hooks/useWorkspaceLayout'
import { AiChatDialog } from '../modules/ai/ui/AiChatDialog'
import { AiChatPane } from '../modules/ai/ui/AiChatPane'
import type { ChatEntryMode, EntryContext } from '../modules/ai/domain/chatSession'
import { registerEditorInsertBelow, registerEditorReplaceSelection, registerEditorCreateAndInsert } from '../modules/ai/platform/editorInsertService'
import { useFilePersistence } from '../hooks/useFilePersistence'
import { useTabs } from '../hooks/useTabs'
import { useCommandSystem } from '../hooks/useCommandSystem'
import { useSidebar } from '../hooks/useSidebar'
import { onOpenRecentFile } from '../modules/platform/menuEvents'
import { deleteFsEntry } from '../modules/files/service'
import { useNativePaste } from '../hooks/useNativePaste'
import type { EditorTab } from '../types/tabs'
import { openTerminalAt } from '../modules/platform/terminalService'

// AI Chat persisted settings type
interface AiChatPersistedSettings {
  mode: 'floating' | 'docked'
  dockSide: 'left' | 'right'
  isOpen: boolean
  width?: number
}

const EditorPaneLazy = lazy(() =>
  import('./EditorPane').then((m) => ({ default: m.EditorPane }))
)

const PreviewPaneLazy = lazy(() =>
  import('./PreviewPane').then((m) => ({ default: m.PreviewPane }))
)

export type LeftPanelId = 'files' | 'outline' | null
export type InitialWorkspaceAction = 'new' | 'open' | 'open_folder' | 'open_recent' | null

export interface WorkspaceShellProps {
  activeLeftPanel: LeftPanelId
  isTauriEnv: () => boolean
  initialAction: InitialWorkspaceAction
  initialOpenRecentPath?: string | null
  onInitialActionHandled?: () => void
}

const seed = ''
const DEFAULT_TITLE = 'undefined.md'

function formatWindowTitleFromTab(tab: EditorTab | null): string {
  if (!tab) return DEFAULT_TITLE
  const path = tab.path
  const name = path ? path.split(/[/\\]/).pop() || path : tab.title || DEFAULT_TITLE
  const prefix = tab.dirty ? '*' : ''
  return `${prefix}${name}`
}

export function WorkspaceShell({
  activeLeftPanel,
  isTauriEnv,
  initialAction,
  initialOpenRecentPath,
  onInitialActionHandled,
}: WorkspaceShellProps) {
  const [markdown, setMarkdown] = useState(seed)
  const [previewValue, setPreviewValue] = useState(seed)
  const [activeLine, setActiveLine] = useState(1)

  // AI Chat States
  const [aiChatState, setAiChatState] = useState<{
    open: boolean
    entryMode: ChatEntryMode
    initialContext?: EntryContext
  } | null>(null)
  const [aiChatMode, setAiChatMode] = useState<'floating' | 'docked'>('docked')
  const [aiChatOpen, setAiChatOpen] = useState(false)
  const [aiChatDockSide, setAiChatDockSide] = useState<'left' | 'right'>('right')
  const [aiChatWidth, setAiChatWidth] = useState(380)
  const [isAiChatResizing, setIsAiChatResizing] = useState(false)

  const aiChatResizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const aiChatStoreRef = useRef<any>(null)

  // Other States
  const [activeOutlineId, setActiveOutlineId] = useState<string | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(260)
  const [isSidebarResizing, setIsSidebarResizing] = useState(false)
  const [isCreatingTab, setIsCreatingTab] = useState(false)
  const sidebarResizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null)

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

  const MIN_SIDEBAR_WIDTH = 150
  const MAX_SIDEBAR_WIDTH = 400

  // Register closeCurrentTab callback
  const closeCurrentTabRef = useRef<(() => void) | null>(null)

  const handleSidebarResizeStart = useCallback((event: any) => {
    if (!activeLeftPanel) return
    sidebarResizeStateRef.current = { startX: event.clientX, startWidth: sidebarWidth }
    setIsSidebarResizing(true)
    event.preventDefault()
    event.stopPropagation()
  }, [activeLeftPanel, sidebarWidth])

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

  const sidebar = useSidebar()
  const previewTimerRef = useRef<number | null>(null)
  const editorViewRef = useRef<EditorView | null>(null)

  const outerGridTemplateColumns = useMemo(() => {
    const aiChatCol = `${aiChatWidth}px`
    if (aiChatMode === 'docked' && aiChatOpen) {
      if (aiChatDockSide === 'left') {
        return `${aiChatCol} 1fr`
      }
      return `1fr ${aiChatCol}`
    }
    return '1fr'
  }, [aiChatMode, aiChatOpen, aiChatDockSide, aiChatWidth])

  const handleAiChatResizeStart = useCallback((event: any) => {
    aiChatResizeStateRef.current = { startX: event.clientX, startWidth: aiChatWidth }
    setIsAiChatResizing(true)
    event.preventDefault()
    event.stopPropagation()
  }, [aiChatWidth])

  // AI Chat Persistence
  useEffect(() => {
    const loadAiStore = async () => {
      if (typeof window !== 'undefined' && (window as any).__TAURI__) {
        try {
          if (!aiChatStoreRef.current) {
            aiChatStoreRef.current = await (Store as any).load('ai-chat-state.dat')
          }
          const state = await aiChatStoreRef.current.get('aiChatState') as AiChatPersistedSettings
          if (state) {
            if (state.mode) setAiChatMode(state.mode)
            if (state.dockSide) setAiChatDockSide(state.dockSide)
            setAiChatOpen(!!state.isOpen)
            if (state.width) setAiChatWidth(state.width)
          }
        } catch (e) {
          console.error('Failed to load AI Chat state', e)
        }
      }
    }
    loadAiStore()
  }, [])

  const saveAiStore = useCallback(async () => {
    if (typeof window !== 'undefined' && (window as any).__TAURI__ && aiChatStoreRef.current) {
      try {
        await aiChatStoreRef.current.set('aiChatState', {
          mode: aiChatMode,
          dockSide: aiChatDockSide,
          isOpen: aiChatOpen,
          width: aiChatWidth
        })
        await aiChatStoreRef.current.save()
      } catch (e) {
        console.error('Failed to save AI Chat state', e)
      }
    }
  }, [aiChatMode, aiChatDockSide, aiChatOpen, aiChatWidth])

  useEffect(() => {
    saveAiStore()
  }, [saveAiStore])

  useEffect(() => {
    if (!isAiChatResizing) return

    const handleMove = (e: MouseEvent) => {
      const state = aiChatResizeStateRef.current
      if (!state) return

      let delta = e.clientX - state.startX
      if (aiChatDockSide === 'right') {
        delta = -delta
      }

      let next = state.startWidth + delta
      const MIN_AI_WIDTH = 340
      const MAX_AI_WIDTH = 800

      if (next < MIN_AI_WIDTH) next = MIN_AI_WIDTH
      if (next > MAX_AI_WIDTH) next = MAX_AI_WIDTH
      setAiChatWidth(next)
    }

    const handleUp = () => {
      setIsAiChatResizing(false)
      aiChatResizeStateRef.current = null
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)

    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [isAiChatResizing, aiChatDockSide])

  // Register AI Editor handlers
  useEffect(() => {
    registerEditorInsertBelow(async (text: string) => {
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
    })
    registerEditorReplaceSelection(async (text: string) => {
      const view = editorViewRef.current
      if (!view || !text) return
      const { state } = view
      const { from, to } = state.selection.main
      view.dispatch(state.update({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
        scrollIntoView: true,
      }))
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
  }, [createTab, isCreatingTab])

  const openAiChatDialog = useCallback(
    (options: { entryMode: ChatEntryMode; initialContext?: EntryContext }) => {
      // 保持当前模式（floating/docked），只负责打开和设置会话参数
      setAiChatOpen(true)
      setAiChatState({ open: true, ...options })
    },
    [],
  )

  const closeAiChatDialog = useCallback(() => {
    setAiChatOpen(false)
    setAiChatState(null)
  }, [])

  const getCurrentMarkdown = useCallback(() => markdown, [markdown])
  const getCurrentFileName = useCallback(() => {
    const path = activeTab?.path
    if (!path) return null
    return path.split(/[/\\]/).pop() || path
  }, [activeTab])
  const getCurrentSelectionText = useCallback(() => {
    const view = editorViewRef.current
    if (!view || view.state.selection.main.empty) return null
    return view.state.doc.sliceString(view.state.selection.main.from, view.state.selection.main.to)
  }, [])

  const outlineItems = useOutline(markdown)

  // Sidebar Resize
  useEffect(() => {
    if (!isSidebarResizing) return
    const handleMove = (e: MouseEvent) => {
      const state = sidebarResizeStateRef.current
      if (!state) return
      const delta = e.clientX - state.startX
      let next = state.startWidth + delta
      if (next < MIN_SIDEBAR_WIDTH) next = MIN_SIDEBAR_WIDTH
      if (next > MAX_SIDEBAR_WIDTH) next = MAX_SIDEBAR_WIDTH
      setSidebarWidth(next)
    }
    const handleUp = () => {
      setIsSidebarResizing(false)
      sidebarResizeStateRef.current = null
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isSidebarResizing, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH])

  const [confirmDialog, setConfirmDialog] = useState<any>(null)
  const [quitConfirmDialog, setQuitConfirmDialog] = useState<any>(null)

  // Sync Content
  useEffect(() => {
    if (!activeId) return
    const tab = tabs.find((t) => t.id === activeId)
    if (!tab) return
    setMarkdown(tab.content)
    setPreviewValue(tab.content)
    setActiveLine(1)
  }, [activeId, tabs])

  // Window Title
  useEffect(() => {
    const title = formatWindowTitleFromTab(activeTab ?? null)
    if (isTauriEnv()) {
      void invoke('set_title', { title }).catch(() => { })
    }
  }, [activeTab, isTauriEnv])

  const {
    DEFAULT_PATH,
    filePath,
    setFilePath,
    setStatusMessage,
    conflictError,
    setConflictError,
    clearRecentAll,
    save,
    saveToPath,
    saveAs,
    openFile,
    openFromPath,
    markDirty,
    hasUnsavedChanges,
    confirmLoseChanges,
    newDocument,
  } = useFilePersistence(markdown, {
    onSaved: (path: string) => updateActiveMeta(path, false)
  })

  useEffect(() => {
    if (activeTab) setFilePath(activeTab.path)
  }, [activeTab, setFilePath])

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
          if ((res as any)?.ok !== false) closeTab(activeId)
        },
        onExtra: () => {
          setConfirmDialog(null)
          closeTab(activeId)
        }
      })
    } else {
      closeTab(activeId)
    }
  }, [isCreatingTab, activeId, tabs, closeTab, save])

  closeCurrentTabRef.current = handleCurrentTabClose

  const handleQuit = useCallback(() => {
    if (isCreatingTab) return
    const unsaved = getUnsavedTabs()
    if (unsaved.length === 0) {
      if (isTauriEnv()) invoke('quit_app').catch(() => { })
      else window.close()
      return
    }
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
  }, [isCreatingTab, getUnsavedTabs, isTauriEnv, save, setActiveTab])

  const handleMarkdownChange = useCallback((val: string) => {
    setMarkdown(val)
    markDirty()
    updateActiveContent(val)
  }, [markDirty, updateActiveContent])

  useEffect(() => {
    const timer = setTimeout(() => setPreviewValue(markdown), 320)
    return () => clearTimeout(timer)
  }, [markdown])

  const applyOpenedContent = useCallback((content: string) => {
    setMarkdown(content)
    setPreviewValue(content)
    setActiveLine(1)
    updateActiveContent(content, { markDirty: false })
  }, [updateActiveContent])

  const openFileInNewTab = useCallback(async (path: string) => {
    if (isCreatingTab) return { ok: false } as any
    const resp = await openFromPath(path)
    if (resp.ok) {
      const tab = createTab({ path: resp.data.path, content: '' })
      updateTabContent(tab.id, resp.data.content, { markDirty: false })
      setMarkdown(resp.data.content)
      setPreviewValue(resp.data.content)
      setActiveLine(1)
    }
    return resp
  }, [isCreatingTab, openFromPath, createTab, updateTabContent, setMarkdown, setPreviewValue, setActiveLine])

  const openFileFromSidebar = useCallback(async (path: string) => {
    if (isCreatingTab) return { ok: false } as any
    const existing = tabs.find(t => t.path === path)
    if (existing) {
      setActiveTab(existing.id)
      return { ok: true, data: { path: existing.path } } as any
    }
    return await openFileInNewTab(path)
  }, [isCreatingTab, tabs, setActiveTab, openFileInNewTab])

  const openRecentFileInNewTab = useCallback(async (path: string) => {
    const resp = await openFileInNewTab(path)
    if (resp?.ok) sidebar.addStandaloneFile(resp.data.path)
    return resp
  }, [openFileInNewTab, sidebar])

  const openFolderInSidebar = useCallback(async () => {
    if (!isTauriEnv()) return
    const selected = await openDialog({ directory: true, multiple: false })
    if (selected) {
      const path = Array.isArray(selected) ? selected[0] : selected
      await sidebar.openFolderAsRoot(path as string)
    }
  }, [isTauriEnv, sidebar])

  const closeTabsByPath = useCallback((path: string) => {
    tabs.forEach(t => { if (t.path === path) closeTab(t.id) })
  }, [tabs, closeTab])

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
            sidebar.removeStandaloneFile(path)
            closeTabsByPath(path)
          }
        }
      })
    } else if (action === 'open-terminal') {
      // 对文件：取所在目录；对文件夹：直接使用其自身路径
      const computeDirFromPath = (targetPath: string): string => {
        if (!targetPath) return targetPath

        // 记住原始分隔符风格（Windows: \\，POSIX: /）
        const hasBackslash = targetPath.includes('\\')

        // 统一成 POSIX 风格便于处理
        const normalized = targetPath.replace(/[\\/]/g, '/')
        const lastSlash = normalized.lastIndexOf('/')

        // 没有分隔符，或者只有根（比如 "/"），直接返回原路径
        if (lastSlash <= 0) {
          return targetPath
        }

        // 取目录部分（会保留开头的 "/" 或盘符前缀中的 "/"）
        let dir = normalized.slice(0, lastSlash)

        // 如果原路径是 Windows 风格，用 "\\" 还原
        if (hasBackslash) {
          dir = dir.replace(/\//g, '\\')
        }

        return dir
      }

      const cwd = kind === 'standalone-file' || kind === 'tree-file'
        ? computeDirFromPath(path)
        : path

      const result = await openTerminalAt(cwd)
      if (!result.ok && result.message) {
        setStatusMessage(result.message)
      }
    }
  }, [openFileFromSidebar, sidebar, closeTabsByPath, setStatusMessage])

  useEffect(() => {
    const unlisten = onOpenRecentFile(path => openRecentFileInNewTab(path))
    return () => unlisten()
  }, [openRecentFileInNewTab])

  useCommandSystem({
    layout, setLayout: setLayout as any, setShowPreview, setStatusMessage,
    aiChatMode, setAiChatMode, aiChatDockSide, setAiChatDockSide, aiChatOpen,
    confirmLoseChanges, hasUnsavedChanges, newDocument, setFilePath, applyOpenedContent,
    openFile, save, saveAs, handleShowRecent: undefined, clearRecentAll,
    createTab, updateActiveMeta, openFolderInSidebar, closeCurrentTab,
    openAiChatDialog: options => openAiChatDialog(options as any),
    getCurrentMarkdown, getCurrentFileName, getCurrentSelectionText,
    onRequestCloseCurrentTab: () => closeCurrentTabRef.current?.(),
    onRequestQuit: handleQuit, isTauriEnv
  })

  useNativePaste(editorViewRef, setStatusMessage)

  const scrollEditorToLineCenter = useCallback((line: number, searchText?: string) => {
    const view = editorViewRef.current
    if (!view) return
    const doc = view.state.doc
    let pos = 0
    if (searchText) {
      for (let i = 1; i <= doc.lines; i++) {
        const l = doc.line(i)
        if (l.text.includes(searchText)) { pos = l.from; break; }
      }
    }
    if (!pos) pos = doc.line(Math.min(line, doc.lines)).from
    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'center' }),
      scrollIntoView: true,
    })
  }, [])

  const handleOutlineSelect = useCallback((item: OutlineItem) => {
    setActiveOutlineId(item.id)
    if (effectiveLayout === 'preview-only') setLayout('preview-left')
    setTimeout(() => scrollEditorToLineCenter(item.line, item.searchText), 100)
  }, [effectiveLayout, setLayout, scrollEditorToLineCenter])

  const handleTabSaveAndClose = useCallback(async (id: string) => {
    const isActive = id === activeId
    const tab = tabs.find(t => t.id === id)
    if (!isActive) {
      setConfirmDialog({
        title: 'Cannot save background tab',
        message: `Close ${tab?.title} and discard changes?`,
        confirmText: 'Discard and Close',
        onConfirm: () => { setConfirmDialog(null); closeTab(id); }
      })
    } else {
      handleCurrentTabClose()
    }
  }, [activeId, tabs, closeTab, handleCurrentTabClose])

  const initialActionHandledRef = useRef(false)
  useEffect(() => {
    if (!initialAction || initialActionHandledRef.current) return
    if (initialAction === 'new') createTab()
    else if (initialAction === 'open') openFile()
    else if (initialAction === 'open_folder') openFolderInSidebar()
    else if (initialAction === 'open_recent' && initialOpenRecentPath) openRecentFileInNewTab(initialOpenRecentPath)
    initialActionHandledRef.current = true
    onInitialActionHandled?.()
  }, [initialAction, initialOpenRecentPath, createTab, openFile, openFolderInSidebar, openRecentFileInNewTab, onInitialActionHandled])

  return (
    <>
      {activeLeftPanel === 'files' && (
        <Sidebar
          standaloneFiles={sidebar.standaloneFiles} folderRoots={sidebar.folderRoots}
          treesByRoot={sidebar.treesByRoot} expanded={sidebar.expanded}
          onToggle={sidebar.toggleNode} onFileClick={openFileFromSidebar}
          onContextAction={handleSidebarContextAction} activePath={activeTab?.path ?? null}
          panelWidth={sidebarWidth}
        />
      )}
      {activeLeftPanel === 'outline' && (
        <OutlinePanel items={outlineItems} activeId={activeOutlineId} onSelect={handleOutlineSelect} panelWidth={sidebarWidth} />
      )}
      {(activeLeftPanel === 'files' || activeLeftPanel === 'outline') && (
        <div className={`sidebar-resizer ${isSidebarResizing ? 'active' : ''}`} onMouseDown={handleSidebarResizeStart} />
      )}

      <div className="workspace-column">
        {tabs.length === 0 ? (
          <Welcome onNewFile={() => createTab()} onOpenFile={() => openFile()} />
        ) : (
          <>
            <TabBar tabs={tabs} activeId={activeId} onTabClick={setActiveTab} onTabClose={closeTab} onRequestSaveAndClose={handleTabSaveAndClose} />
            <main className={`workspace ${dragging ? 'dragging' : ''}`} style={{ gridTemplateColumns: outerGridTemplateColumns }}>
              {aiChatMode === 'docked' && aiChatOpen && aiChatState && (
                <>
                  {aiChatDockSide === 'left' && <AiChatPane entryMode={aiChatState.entryMode} initialContext={aiChatState.initialContext} onClose={closeAiChatDialog} />}
                  <div className="divider-hotzone vertical" style={{ position: 'absolute', left: aiChatDockSide === 'left' ? aiChatWidth : `calc(100% - ${aiChatWidth}px)`, height: '100%', zIndex: 10, cursor: 'col-resize' }} onMouseDown={handleAiChatResizeStart}>
                    <div className="divider-rail"><span className="divider-handle" /></div>
                  </div>
                </>
              )}
              <section className="pane-group editor-preview-group" style={{ gridTemplateColumns }} ref={workspaceRef}>
                <section className="pane" style={effectiveLayout === 'preview-only' ? { display: 'none' } : effectiveLayout === 'preview-left' ? { gridColumn: '2/3' } : effectiveLayout === 'preview-right' ? { gridColumn: '1/2' } : { gridColumn: '1/-1' }}>
                  <Suspense fallback={<div className="code-editor" />}><EditorPaneLazy markdown={markdown} onChange={handleMarkdownChange} onCursorChange={setActiveLine} showPreview={showPreview} setShowPreview={setShowPreview} editorViewRef={editorViewRef} /></Suspense>
                </section>
                <Suspense fallback={<section className="pane preview"><div className="preview-body" /></section>}><PreviewPaneLazy value={previewValue} activeLine={activeLine} previewWidth={previewWidthForRender} effectiveLayout={effectiveLayout} /></Suspense>
                {(effectiveLayout === 'preview-left' || effectiveLayout === 'preview-right') && (
                  <div className={`divider-hotzone ${dragging ? 'active' : ''}`} style={{ left: effectiveLayout === 'preview-left' ? `${previewWidthForRender}%` : `${100 - previewWidthForRender}%` }} onMouseDown={startDragging}>
                    <div className="divider-rail"><span className="divider-handle" /></div>
                  </div>
                )}
              </section>
              {aiChatMode === 'docked' && aiChatOpen && aiChatState && aiChatDockSide === 'right' && (
                <AiChatPane
                  entryMode={aiChatState.entryMode}
                  initialContext={aiChatState.initialContext}
                  onClose={closeAiChatDialog}
                />
              )}
            </main>
          </>
        )}
      </div>

      {conflictError && <ConflictModal error={conflictError} onRetrySave={save} onCancel={() => setConflictError(null)} />}
      {confirmDialog && <ConfirmDialog title={confirmDialog.title} message={confirmDialog.message} confirmText={confirmDialog.confirmText} cancelText={confirmDialog.cancelText} extraText={confirmDialog.extraText} variant={confirmDialog.variant} onConfirm={confirmDialog.onConfirm} onExtra={confirmDialog.onExtra} onCancel={() => setConfirmDialog(null)} />}
      {quitConfirmDialog && <ConfirmDialog title={quitConfirmDialog.unsavedCount === 1 ? 'Save changes?' : `Save ${quitConfirmDialog.unsavedCount} files?`} message="Your changes will be lost." confirmText="Save All" cancelText="Cancel" extraText="Don't Save" variant="stacked" onConfirm={quitConfirmDialog.onSaveAll} onExtra={quitConfirmDialog.onQuitWithoutSaving} onCancel={() => setQuitConfirmDialog(null)} />}
      {aiChatMode === 'floating' && aiChatOpen && aiChatState?.open && <AiChatDialog open={aiChatOpen} entryMode={aiChatState.entryMode} initialContext={aiChatState.initialContext} onClose={closeAiChatDialog} />}
    </>
  )
}

export default WorkspaceShell
