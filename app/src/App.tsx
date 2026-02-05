import { useCallback, useEffect, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import 'katex/dist/katex.min.css'
import 'highlight.js/styles/atom-one-dark.css'
import './App.css'
import { EditorPane } from './components/EditorPane'
import { PreviewPane } from './components/PreviewPane'
import { ConflictModal } from './components/ConflictModal'
import { ConfirmDialog } from './components/ConfirmDialog'
import { TabBar } from './components/TabBar'
import { Sidebar, type SidebarContextActionPayload } from './components/Sidebar'
import { OutlinePanel } from './components/OutlinePanel'
import { useOutline } from './hooks/useOutline'
import type { OutlineItem } from './modules/outline/parser'
import { useWorkspaceLayout } from './hooks/useWorkspaceLayout'
import { useFilePersistence } from './hooks/useFilePersistence'
import { useTabs } from './hooks/useTabs'
import { useCommandSystem } from './hooks/useCommandSystem'
import { useSidebar } from './hooks/useSidebar'
import { onOpenRecentFile } from './modules/platform/menuEvents'
import { deleteFsEntry } from './modules/files/service'
import { useNativePaste } from './hooks/useNativePaste'
import type { EditorTab } from './types/tabs'

const isTauri = () =>
  typeof window !== 'undefined' &&
  (Boolean((window as any).__TAURI_INTERNALS__) || Boolean((window as any).__TAURI__))

const seed = ''
const DEFAULT_TITLE = '未命名.md'

type LeftPanelId = 'files' | 'outline' | null

function formatWindowTitleFromTab(tab: EditorTab | null): string {
  if (!tab) return DEFAULT_TITLE
  const path = tab.path
  const name = path
    ? path.split(/[/\\]/).pop() || path
    : tab.title || DEFAULT_TITLE
  const prefix = tab.dirty ? '*' : ''
  return `${prefix}${name}`
}

function App() {
  const [markdown, setMarkdown] = useState(seed)
  const [previewValue, setPreviewValue] = useState(seed)
  const [activeLine, setActiveLine] = useState(1)

  const [activeLeftPanel, setActiveLeftPanel] = useState<LeftPanelId>('files')
  const [activeOutlineId, setActiveOutlineId] = useState<string | null>(null)

  const handleLeftPanelToggle = useCallback((id: LeftPanelId) => {
    setActiveLeftPanel((prev) => (prev === id ? null : id))
  }, [])
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

  const { tabs, activeId, activeTab, createTab, setActiveTab, closeTab, updateActiveContent, updateActiveMeta } = useTabs()
  const sidebar = useSidebar()
  const previewTimerRef = useRef<number | null>(null)
  const editorViewRef = useRef<EditorView | null>(null)

  const outlineItems = useOutline(markdown)

  // Confirm Dialog State
  type ConfirmState = {
    title: string
    message: string
    confirmText?: string
    cancelText?: string
    extraText?: string
    variant?: 'default' | 'stacked'
    onConfirm: () => void
    onExtra?: () => void
  } | null
  const [confirmDialog, setConfirmDialog] = useState<ConfirmState>(null)

  // 切换标签时，同步编辑内容和预览内容到当前标签
  useEffect(() => {
    if (!activeId) return
    const tab = tabs.find((t) => t.id === activeId) || null
    if (!tab) return
    setMarkdown(tab.content)
    setPreviewValue(tab.content)
    setActiveLine(1)
  }, [activeId])

  // 根据当前标签更新窗口标题
  useEffect(() => {
    const title = formatWindowTitleFromTab(activeTab ?? null)
    if (!isTauri()) return
    void invoke('set_title', { title }).catch((err) => {
      console.warn('set_title failed', err)
    })
  }, [activeTab])

  // 调试：观察当前 activeLine 行号
  useEffect(() => {
    console.log('[App] activeLine =', activeLine)
  }, [activeLine])

  const persistenceOptions = {
    onSaved: (path: string) => {
      updateActiveMeta(path, false)
    },
  }

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
  } = useFilePersistence(markdown, persistenceOptions)

  // 每个标签拥有自己的保存路径：切换标签时让持久化层跟随当前标签的路径
  useEffect(() => {
    if (!activeTab) return
    setFilePath(activeTab.path)
  }, [activeTab, setFilePath])

  const handleMarkdownChange = useCallback(
    (val: string) => {
      setMarkdown(val)
      markDirty()
      updateActiveContent(val)
    },
    [markDirty, updateActiveContent],
  )

  useEffect(() => {
    if (markdown === previewValue) return
    if (previewTimerRef.current) {
      window.clearTimeout(previewTimerRef.current)
    }
    previewTimerRef.current = window.setTimeout(() => {
      setPreviewValue(markdown)
      previewTimerRef.current = null
    }, 320)

    return () => {
      if (previewTimerRef.current) {
        window.clearTimeout(previewTimerRef.current)
        previewTimerRef.current = null
      }
    }
  }, [markdown, previewValue])

  const handleManualSave = async () => {
    // 冲突重试时，已命名文件应直接保存到原路径；未命名则走保存对话框
    if (filePath !== DEFAULT_PATH) {
      await saveToPath()
    } else {
      await saveAs()
    }
  }

  const applyOpenedContent = useCallback(
    (content: string) => {
      setMarkdown(content)
      setPreviewValue(content)
      setActiveLine(1)
      // 打开文件或新文档时同步更新当前标签内容，但保持 dirty 由持久化逻辑控制
      updateActiveContent(content)
    },
    [updateActiveContent],
  )

  // 在新标签中打开指定路径的文件：先通过持久化层读取，再创建带 path+content 的标签
  const openFileInNewTab = useCallback(
    async (path: string) => {
      const resp = await openFromPath(path)
      if (!resp.ok) return resp

      const { path: realPath, content } = resp.data

      // 为该文件创建一个独立标签，标题由路径自动推导
      createTab({ path: realPath, content })

      // 同步编辑区/预览区内容到新标签
      setMarkdown(content)
      setPreviewValue(content)
      setActiveLine(1)

      return resp
    },
    [createTab, openFromPath],
  )

  // 从 Sidebar 打开文件：若已有对应标签则只激活，否则创建新标签
  const openFileFromSidebar = useCallback(
    async (path: string) => {
      // 先检查是否已经有该路径的标签
      const existing = tabs.find((t) => t.path === path)
      if (existing) {
        setActiveTab(existing.id)
        return { ok: true, data: { path: existing.path } } as any
      }

      // 没有标签时，走统一的新标签打开逻辑
      return await openFileInNewTab(path)
    },
    [tabs, setActiveTab, openFileInNewTab],
  )

  // Open Recent 专用：仅将文件加入 Sidebar 的单文件列表，不加载整个目录树
  const openRecentFileInNewTab = useCallback(
    async (path: string) => {
      const resp = await openFileInNewTab(path)
      if (!resp || !resp.ok) return resp

      sidebar.addStandaloneFile(resp.data.path)
      return resp
    },
    [openFileInNewTab, sidebar],
  )

  const openFolderInSidebar = useCallback(async () => {
    if (!isTauri()) {
      setStatusMessage('Open Folder 仅在桌面环境中可用')
      return
    }

    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: '选择文档文件夹',
    })

    if (!selected) {
      setStatusMessage('已取消选择文件夹')
      return
    }

    const path = Array.isArray(selected) ? selected[0] : selected

    await sidebar.openFolderAsRoot(path as string)
    setStatusMessage(`已打开文件夹：${path}`)
  }, [sidebar, setStatusMessage])

  const closeTabsByPath = useCallback(
    (targetPath: string) => {
      const norm = targetPath
      tabs.forEach((tab) => {
        if (tab.path === norm) {
          closeTab(tab.id)
        }
      })
    },
    [tabs, closeTab],
  )

  const handleSidebarContextAction = useCallback(
    async (payload: SidebarContextActionPayload) => {
      const { path, kind, action } = payload

      if (action === 'open') {
        await openFileFromSidebar(path)
        return
      }

      if (action === 'remove') {
        if (kind === 'standalone-file') {
          sidebar.removeStandaloneFile(path)
        } else if (kind === 'folder-root') {
          sidebar.removeFolderRoot(path)
        }
        return
      }

      if (action === 'delete') {
        setConfirmDialog({
          title: '确认删除',
          message: `确认删除该文件？此操作不可撤销。\n\n${path}`,
          confirmText: '删除',
          onConfirm: async () => {
            setConfirmDialog(null)
            const resp = await deleteFsEntry(path)
            if (!resp.ok) {
              setStatusMessage(resp.error.message)
              return
            }
            sidebar.removeStandaloneFile(path)
            closeTabsByPath(path)
          },
        })
        return
      }
    },
    [openFileFromSidebar, sidebar, deleteFsEntry, setStatusMessage, closeTabsByPath],
  )

  // 监听 Tauri 原生菜单中 File → Open Recent 子菜单点击事件
  // 行为：新建标签页并把文件加入 Sidebar 的单文件列表，不展开整个文件夹
  useEffect(() => {
    const unlisten = onOpenRecentFile(async (path) => {
      await openRecentFileInNewTab(path)
    })

    return () => {
      unlisten()
    }
  }, [openRecentFileInNewTab])

  useCommandSystem({
    layout,
    setLayout: setLayout as unknown as (layout: string) => void,
    setShowPreview,
    setStatusMessage,
    confirmLoseChanges,
    hasUnsavedChanges,
    newDocument,
    setFilePath,
    applyOpenedContent,
    openFile,
    save,
    saveAs,
    handleShowRecent: undefined,
    clearRecentAll,
    createTab,
    updateActiveMeta,
    openFolderInSidebar,
    isTauriEnv: isTauri,
  })

  // 监听来自原生剪贴板的粘贴事件（通过 Hook 封装）
  useNativePaste(editorViewRef, setStatusMessage)

  // Global click logger for debugging tab-close issues
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const node = e.target as Node
      const element = node instanceof Element ? node : node.parentElement
      const isTabClose = element ? element.closest('.tab-close') !== null : false

      console.log('[GLOBAL CLICK]', {
        target: (element as HTMLElement | null)?.outerHTML?.slice(0, 160) ?? String(e.target),
        isTabClose,
      })
    }
    window.addEventListener('click', handler, true)
    return () => {
      window.removeEventListener('click', handler, true)
    }
  }, [])

  const scrollEditorToLineCenter = useCallback(
    (line: number) => {
      const view = editorViewRef.current
      if (!view) return

      const totalLines = view.state.doc.lines
      const targetLine = Math.min(Math.max(line, 1), totalLines)
      const lineInfo = view.state.doc.line(targetLine)

      // 使用编辑器内坐标 + DOM 计算，将目标行尽量滚动到编辑区中间
      const rect = view.coordsAtPos(lineInfo.from)
      const scrollDOM = view.scrollDOM
      if (!rect) return

      const scrollRect = scrollDOM.getBoundingClientRect()
      const lineCenter = rect.top + (rect.bottom - rect.top) / 2
      const delta = lineCenter - (scrollRect.top + scrollRect.height / 2)

      scrollDOM.scrollTo({ top: scrollDOM.scrollTop + delta })

      view.dispatch({
        selection: { anchor: lineInfo.from },
      })
    },
    [editorViewRef],
  )

  const handleOutlineSelect = useCallback(
    (item: OutlineItem) => {
      setActiveOutlineId(item.id)
      scrollEditorToLineCenter(item.line)
    },
    [scrollEditorToLineCenter],
  )

  const handleTabClose = useCallback(
    (id: string) => {
      closeTab(id)
    },
    [closeTab],
  )

  const handleTabSaveAndClose = useCallback(
    async (id: string) => {
      console.log('[App] handleTabSaveAndClose called', { id, activeId, tabsCount: tabs.length })
      const isActive = id === activeId

      // 非激活标签：目前不支持跨标签保存，提示用户可能丢失修改
      if (!isActive) {
        console.log('[App] non-active tab save+close requested', { id, activeId })
        const tab = tabs.find((t) => t.id === id)
        setConfirmDialog({
          title: '无法保存非激活标签',
          message: `标签 "${tab?.title || '未命名'}" 有未保存的更改，但只能保存当前激活的标签。\n\n关闭将丢弃所有更改，是否继续？`,
          confirmText: '丢弃并关闭',
          onConfirm: () => {
            setConfirmDialog(null)
            closeTab(id)
          },
        })
        return
      }

      console.log('[App] active tab save+close requested, showing save confirm', { id })
      const tab = tabs.find((t) => t.id === id)
      const displayName = tab?.title || 'Untitled'
      setConfirmDialog({
        title: `Do you want to save the changes you made to ${displayName}?`,
        message: "Your changes will be lost if you don't save them.",
        confirmText: 'Save',
        cancelText: 'Cancel',
        extraText: "Don't Save",
        variant: 'stacked',
        onConfirm: async () => {
          setConfirmDialog(null)
          const result = await save()
          console.log('[App] save result for tab', { id, result })
          if ((result as any)?.ok === false) {
            setStatusMessage((result as any)?.error?.message ?? '保存失败')
            return
          }
          console.log('[App] save succeeded, closing tab', { id })
          closeTab(id)
        },
        onExtra: () => {
          setConfirmDialog(null)
          console.log('[App] discard changes and close tab', { id })
          closeTab(id)
        },
      })
      return

    },
    [activeId, closeTab, save, setStatusMessage, tabs],
  )

  return (
    <div className="app-shell">
      <div className="layout-row">
        <div className="activity-bar">
          <button
            type="button"
            className={`activity-item ${activeLeftPanel === 'files' ? 'active' : ''}`}
            onClick={() => handleLeftPanelToggle('files')}
            aria-pressed={activeLeftPanel === 'files'}
            title="Files"
          >
            <span className="activity-icon-file" aria-hidden="true" />
          </button>

          <button
            type="button"
            className={`activity-item ${activeLeftPanel === 'outline' ? 'active' : ''}`}
            onClick={() => handleLeftPanelToggle('outline')}
            aria-pressed={activeLeftPanel === 'outline'}
            title="Outline"
          >
            <span className="activity-icon-outline" aria-hidden="true" />
          </button>
        </div>

        {activeLeftPanel === 'files' && (
          <Sidebar
            standaloneFiles={sidebar.standaloneFiles}
            folderRoots={sidebar.folderRoots}
            treesByRoot={sidebar.treesByRoot}
            expanded={sidebar.expanded}
            onToggle={sidebar.toggleNode}
            onFileClick={openFileFromSidebar}
            onContextAction={handleSidebarContextAction}
            activePath={activeTab?.path ?? null}
          />
        )}

        {activeLeftPanel === 'outline' && (
          <OutlinePanel items={outlineItems} activeId={activeOutlineId} onSelect={handleOutlineSelect} />
        )}

        <div className="workspace-column">
          <TabBar
            tabs={tabs}
            activeId={activeId}
            onTabClick={setActiveTab}
            onTabClose={handleTabClose}
            onRequestSaveAndClose={handleTabSaveAndClose}
          />
          <main
            className={`workspace ${dragging ? 'dragging' : ''}`}
            style={{ gridTemplateColumns }}
            ref={workspaceRef}
          >
            {effectiveLayout === 'preview-left' && (
              <>
                <PreviewPane
                  value={previewValue}
                  activeLine={activeLine}
                  previewWidth={previewWidthForRender}
                />
                <section className="pane">
                  <EditorPane
                    markdown={markdown}
                    onChange={handleMarkdownChange}
                    onCursorChange={setActiveLine}
                    showPreview={showPreview}
                    setShowPreview={setShowPreview}
                    editorViewRef={editorViewRef}
                  />
                </section>
              </>
            )}

            {effectiveLayout === 'preview-right' && (
              <>
                <section className="pane">
                  <EditorPane
                    markdown={markdown}
                    onChange={handleMarkdownChange}
                    onCursorChange={setActiveLine}
                    showPreview={showPreview}
                    setShowPreview={setShowPreview}
                    editorViewRef={editorViewRef}
                  />
                </section>
                <PreviewPane
                  value={previewValue}
                  activeLine={activeLine}
                  previewWidth={previewWidthForRender}
                />
              </>
            )}

            {(effectiveLayout === 'preview-left' || effectiveLayout === 'preview-right') && (
              <div
                className={`divider-hotzone ${dragging ? 'active' : ''}`}
                style={{
                  left:
                    effectiveLayout === 'preview-left'
                      ? `${previewWidthForRender}%`
                      : `${100 - previewWidthForRender}%`,
                }}
                onMouseDown={startDragging}
              >
                <div className="divider-rail">
                  <span className="divider-handle" />
                </div>
              </div>
            )}

            {effectiveLayout === 'preview-only' && (
              <PreviewPane
                value={previewValue}
                activeLine={activeLine}
                previewWidth={previewWidthForRender}
                fullWidth
              />
            )}

            {effectiveLayout === 'editor-only' && (
              <section className="pane" style={{ gridColumn: '1 / -1' }}>
                <EditorPane
                  markdown={markdown}
                  onChange={handleMarkdownChange}
                  onCursorChange={setActiveLine}
                  showPreview={showPreview}
                  setShowPreview={setShowPreview}
                  editorViewRef={editorViewRef}
                />
              </section>
            )}
          </main>
        </div>
      </div>

      <div className="bottom-bar">
        <div className="bottom-bar-left">Markdown Workspace</div>
        <div className="bottom-bar-right">&nbsp;</div>
      </div>

      {conflictError && (
        <ConflictModal
          error={conflictError}
          onRetrySave={handleManualSave}
          onCancel={() => setConflictError(null)}
        />
      )}

      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmText={confirmDialog.confirmText}
          cancelText={confirmDialog.cancelText}
          extraText={confirmDialog.extraText}
          variant={confirmDialog.variant}
          onConfirm={confirmDialog.onConfirm}
          onExtra={confirmDialog.onExtra}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </div>
  )
}

export default App
