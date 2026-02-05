import { useCallback, useEffect, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { invoke } from '@tauri-apps/api/core'
import 'katex/dist/katex.min.css'
import 'highlight.js/styles/atom-one-dark.css'
import './App.css'
import { EditorPane } from './components/EditorPane'
import { PreviewPane } from './components/PreviewPane'
import { ConflictModal } from './components/ConflictModal'
import { TabBar } from './components/TabBar'
import { useWorkspaceLayout } from './hooks/useWorkspaceLayout'
import { useFilePersistence } from './hooks/useFilePersistence'
import { useTabs } from './hooks/useTabs'
import { useCommandSystem } from './hooks/useCommandSystem'
import { onOpenRecentFile } from './modules/platform/menuEvents'
import { useNativePaste } from './hooks/useNativePaste'
import type { EditorTab } from './types/tabs'

const isTauri = () =>
  typeof window !== 'undefined' &&
  (Boolean((window as any).__TAURI_INTERNALS__) || Boolean((window as any).__TAURI__))

const seed = ''
const DEFAULT_TITLE = '未命名.md'

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
  const previewTimerRef = useRef<number | null>(null)
  const editorViewRef = useRef<EditorView | null>(null)

  // 切换标签时，同步编辑内容和预览内容到当前标签
  useEffect(() => {
    if (!activeId) return
    const tab = tabs.find((t) => t.id === activeId) || null
    if (!tab) return
    setMarkdown(tab.content)
    setPreviewValue(tab.content)
    setActiveLine(1)
  }, [activeId, tabs])

  // 根据当前标签更新窗口标题
  useEffect(() => {
    const title = formatWindowTitleFromTab(activeTab ?? null)
    if (!isTauri()) return
    void invoke('set_title', { title }).catch((err) => {
      console.warn('set_title failed', err)
    })
  }, [activeTab])

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
  const openPathInNewTab = useCallback(
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

  // 监听 Tauri 原生菜单中 File → Open Recent 子菜单点击事件
  // 行为与 File → Open 一致：总是新建一个标签页，再将文件内容及路径加载进去
  useEffect(() => {
    const unlisten = onOpenRecentFile(async (path) => {
      await openPathInNewTab(path)
    })

    return () => {
      unlisten()
    }
  }, [openPathInNewTab])

  useCommandSystem({
    layout,
    setLayout: setLayout as unknown as (layout: string) => void,
    setShowPreview,
    setStatusMessage,
    confirmLoseChanges,
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
    isTauriEnv: isTauri,
  })

  // 监听来自原生剪贴板的粘贴事件（通过 Hook 封装）
  useNativePaste(editorViewRef, setStatusMessage)

  return (
    <div className="app-shell">
      <TabBar
        tabs={tabs}
        activeId={activeId}
        onTabClick={setActiveTab}
        onTabClose={closeTab}
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

      {conflictError && (
        <ConflictModal
          error={conflictError}
          onRetrySave={handleManualSave}
          onCancel={() => setConflictError(null)}
        />
      )}
    </div>
  )
}

export default App
