import { useCallback, useEffect, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import 'katex/dist/katex.min.css'
import 'highlight.js/styles/atom-one-dark.css'
import './App.css'
import { EditorPane } from './components/EditorPane'
import { PreviewPane } from './components/PreviewPane'
import { RecentPanel } from './components/RecentPanel'
import { ConflictModal } from './components/ConflictModal'
import { useWorkspaceLayout } from './hooks/useWorkspaceLayout'
import { useFilePersistence } from './hooks/useFilePersistence'
import { useCommandSystem } from './hooks/useCommandSystem'
import { onOpenRecentFile } from './modules/platform/menuEvents'
import { useNativePaste } from './hooks/useNativePaste'

const isTauri = () =>
  typeof window !== 'undefined' &&
  (Boolean((window as any).__TAURI_INTERNALS__) || Boolean((window as any).__TAURI__))

const seed = [
  '# HaoMD',
  '',
  '- 实时预览',
  '- 支持 KaTeX / Mermaid / mind',
  '- 多标签与离线文件',
  '',
  '> 这里是占位文案，后续会接入渲染管线。',
  '',
  '## 数学 (KaTeX)',
  '$$ E = mc^2 $$',
  '',
  '## Mermaid',
  '```mermaid',
  'graph LR',
  '    user[用户] --> editor[编辑器]',
  '    editor --> preview[实时预览]',
  '```',
  '',
  '## Mind-elixir ',
  '```mind',
  '{',
  '  "title": "根节点",',
  '  "children": [',
  '    {',
  '      "title": "分支 A",',
  '      "children": [',
  '        { "title": "子 A1" },',
  '        { "title": "子 A2" }',
  '      ]',
  '    },',
  '    { "title": "分支 B" }',
  '  ]',
  '}',
  '```',
    '## Mind-elixir ',
  '```mind',
  'root',
  '-A',
  '--A1',
  '--A2',
  '-B',
  '--B1',
  '---B11',
  '---B12',
  '-C',
  '--C1',
  '---C11',
  '---C12',
  '--B1',
  '---B11',
  '---B12',
  '-C',
  '--C1',
  '---C11',
  '---C12',
  '```',
].join('\n')


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
  const previewTimerRef = useRef<number | null>(null)
  const editorViewRef = useRef<EditorView | null>(null)

  const [recentOpen, setRecentOpen] = useState(false)

  const {
    DEFAULT_PATH,
    filePath,
    setStatusMessage,
    conflictError,
    setConflictError,
    recent,
    recentHasMore,
    recentLoading,
    loadMoreRecent,
    clearRecentAll,
    deleteRecent,
    reloadRecentLocal,
    save,
    saveToPath,
    saveAs,
    openFile,
    openFromPath,
    markDirty,
    confirmLoseChanges,
    newDocument,
  } = useFilePersistence(markdown)

  const handleMarkdownChange = useCallback(
    (val: string) => {
      setMarkdown(val)
      markDirty()
    },
    [markDirty],
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


  const handleShowRecent = async () => {
    // 负责打开/关闭最近文件面板；首次或再次打开时，尝试从 localStorage 合并最新记录。
    setRecentOpen((open) => {
      const next = !open
      if (!open && next) {
        // 面板从关闭 -> 打开时，按需从 localStorage 合并最近记录
        reloadRecentLocal()
      }
      return next
    })
  }

  const applyOpenedContent = useCallback((content: string) => {
    setMarkdown(content)
    setPreviewValue(content)
    setActiveLine(1)
  }, [])

  const handleOpenPath = useCallback(
    async (path: string) => {
      const resp = await openFromPath(path)
      if (resp.ok) {
        applyOpenedContent(resp.data.content)
      }
      return resp
    },
    [applyOpenedContent, openFromPath],
  )

  // 监听 Tauri 原生菜单中 File → Open Recent 子菜单点击事件
  useEffect(() => {
    const unlisten = onOpenRecentFile(async (path) => {
      if (!confirmLoseChanges()) return
      await handleOpenPath(path)
    })

    return () => {
      unlisten()
    }
  }, [confirmLoseChanges, handleOpenPath])

  useCommandSystem({
    layout,
    setLayout: setLayout as unknown as (layout: string) => void,
    setShowPreview,
    setStatusMessage,
    confirmLoseChanges,
    newDocument,
    applyOpenedContent,
    openFile,
    save,
    saveAs,
    handleShowRecent,
    clearRecentAll,
    isTauriEnv: isTauri,
  })

  // 监听来自原生剪贴板的粘贴事件（通过 Hook 封装）
  useNativePaste(editorViewRef, setStatusMessage)

  const formatTs = (ts?: number | null) => {
    if (!ts) return '未保存'
    const d = new Date(ts)
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`
  }

  return (
    <div className="app-shell">
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
            <div
              className={`divider ${dragging ? 'active' : ''}`}
              onMouseDown={startDragging}
            >
              <span className="divider-handle" />
            </div>
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
            <div
              className={`divider ${dragging ? 'active' : ''}`}
              onMouseDown={startDragging}
            >
              <span className="divider-handle" />
            </div>
            <PreviewPane
              value={previewValue}
              activeLine={activeLine}
              previewWidth={previewWidthForRender}
            />
          </>
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

      <RecentPanel
        open={recentOpen}
        items={recent}
        hasMore={recentHasMore}
        loading={recentLoading}
        formatTs={formatTs}
        confirmLoseChanges={confirmLoseChanges}
        onClose={handleShowRecent}
        onLoadMore={loadMoreRecent}
        onOpenItem={handleOpenPath}
        onDeleteItem={async (path) => {
          const resp = await deleteRecent(path)
          if (!resp.ok) return
        }}
      />

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
