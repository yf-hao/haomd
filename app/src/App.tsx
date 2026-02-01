import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import 'katex/dist/katex.min.css'
import 'highlight.js/styles/atom-one-dark.css'
import './App.css'
import { MarkdownViewer } from './components/MarkdownViewer'
import { CodeEditor } from './components/Editor/CodeEditor'
import {
  listRecent,
  listSnapshots,
  makeSnapshot,
  writeFile,
} from './modules/files/service'
import { createAutoSaver, type AutoSaveHandle } from './modules/files/autoSave'
import type { RecentFile, SnapshotMeta, WriteResult, ServiceError, Result } from './modules/files/types'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { save as saveDialog } from '@tauri-apps/plugin-dialog'

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

const DEFAULT_PATH = '未命名.md'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict'

function App() {
  const [markdown, setMarkdown] = useState(seed)
  const [previewValue, setPreviewValue] = useState(seed)
  const [activeLine, setActiveLine] = useState(1)
  type Layout = 'preview-left' | 'preview-right' | 'editor-only' | 'preview-only'
  const [layout, setLayout] = useState<Layout>('preview-left')
  const [showPreview, setShowPreview] = useState(true)
  const [editorWidth, setEditorWidth] = useState(55)
  const [dragging, setDragging] = useState(false)
  const workspaceRef = useRef<HTMLElement | null>(null)
  const previewTimerRef = useRef<number | null>(null)

  const [filePath, setFilePath] = useState<string>(DEFAULT_PATH)
  const [dirty, setDirty] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const [currentHash, setCurrentHash] = useState<string | undefined>(undefined)
  const [currentMtime, setCurrentMtime] = useState<number | undefined>(undefined)

  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([])

  const [recentOpen, setRecentOpen] = useState(false)
  const [recent, setRecent] = useState<RecentFile[]>([])

  const [conflictError, setConflictError] = useState<ServiceError | null>(null)

  const saverRef = useRef<AutoSaveHandle | null>(null)

  const confirmLoseChanges = useCallback(() => {
    if (!dirty) return true
    return window.confirm('存在未保存变更，确认继续？')
  }, [dirty])

  const effectiveLayout = useMemo<Layout>(() => {
    if (!showPreview) return 'editor-only'
    return layout
  }, [layout, showPreview])

  const clampedEditorWidth = useMemo(() => Math.min(70, Math.max(30, editorWidth)), [editorWidth])
  const clampedPreviewWidth = useMemo(() => Math.max(30, 100 - clampedEditorWidth), [clampedEditorWidth])
  const previewWidthForRender = useMemo(
    () => (effectiveLayout === 'preview-only' ? 100 : clampedPreviewWidth),
    [clampedPreviewWidth, effectiveLayout],
  )

  const gridTemplateColumns = useMemo(() => {
    if (effectiveLayout === 'editor-only') return '1fr'
    if (effectiveLayout === 'preview-only') return '1fr'
    const previewCol = `minmax(0, ${clampedPreviewWidth}%)`
    const editorCol = `minmax(0, ${clampedEditorWidth}%)`
    return effectiveLayout === 'preview-left'
      ? `${previewCol} 10px ${editorCol}`
      : `${editorCol} 10px ${previewCol}`
  }, [clampedEditorWidth, clampedPreviewWidth, effectiveLayout])

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!dragging || !workspaceRef.current) return
      const rect = workspaceRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left
      const percent = (x / rect.width) * 100
      const clamped = Math.min(70, Math.max(30, percent))
      if (effectiveLayout === 'preview-left') {
        // divider 位于预览和编辑之间，x 越大编辑越窄
        setEditorWidth(Math.max(30, Math.min(70, 100 - clamped)))
      } else {
        setEditorWidth(clamped)
      }
    }
    const handleUp = () => dragging && setDragging(false)
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [dragging, effectiveLayout])

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

  const formatTitle = useCallback(
    (path: string, isDirty: boolean) => {
      const name = path.split('/').pop() || path || DEFAULT_PATH
      const prefix = isDirty ? '*' : ''
      return `${prefix}${name}`
    },
    [],
  )

  const updateTitle = useCallback(
    async (path: string, isDirty: boolean) => {
      if (!isTauri()) return
      try {
        await invoke('set_title', { title: formatTitle(path, isDirty) })
      } catch (err) {
        console.warn('set_title failed', err)
      }
    },
    [formatTitle],
  )

  const handleSave = useCallback(
    async (targetPath?: string): Promise<Result<WriteResult>> => {
      const pathToUse = targetPath ?? filePath
      const resp = await writeFile({
        path: pathToUse,
        content: markdown,
        expectedHash: currentHash,
        expectedMtime: currentMtime,
      })
      if (resp.ok) {
        setFilePath(pathToUse)
        setDirty(false)
        setSaveStatus('saved')
        setStatusMessage('已保存')
        setCurrentHash(resp.data.hash)
        setCurrentMtime(resp.data.mtimeMs)
        setLastSavedAt(Date.now())
        void updateTitle(pathToUse, false)
      }
      return resp
    },
    [filePath, markdown, currentHash, currentMtime, updateTitle],
  )

  useEffect(() => {
    saverRef.current?.cancel()
    saverRef.current = createAutoSaver({
      save: () => handleSave(),
      isDirty: () => dirty,
      enabled: filePath !== DEFAULT_PATH, // 避免未命名文件写入项目目录触发 Tauri 重建
      onStart: () => {
        setSaveStatus('saving')
        setStatusMessage('自动保存中...')
      },
      onSuccess: (res) => {
        setDirty(false)
        setSaveStatus('saved')
        setStatusMessage('自动保存完成')
        setCurrentHash(res.hash)
        setCurrentMtime(res.mtimeMs)
        setLastSavedAt(Date.now())
      },
      onConflict: (error) => {
        setSaveStatus('conflict')
        setConflictError(error)
        setStatusMessage(error.message)
      },
      onError: (error) => {
        setSaveStatus('error')
        setStatusMessage(error.message)
      },
    })
    return () => {
      saverRef.current?.cancel()
    }
  }, [dirty, handleSave])

  useEffect(() => {
    setDirty(true)
    saverRef.current?.schedule()
  }, [markdown])

  useEffect(() => {
    void updateTitle(filePath, dirty)
  }, [filePath, dirty, updateTitle])

  useEffect(() => {
    // 预加载最近列表
    listRecent().then((resp) => {
      if (resp.ok) setRecent(resp.data)
    })
  }, [])

  const refreshSnapshots = useCallback(async () => {
    setHistoryLoading(true)
    const resp = await listSnapshots(filePath)
    if (resp.ok) setSnapshots(resp.data)
    setHistoryLoading(false)
  }, [filePath])

  const saveWithDialog = useCallback(async () => {
    if (!isTauri()) {
      setSaveStatus('error')
      setStatusMessage('需在 Tauri 应用中才能弹出系统保存对话框')
      return { ok: false as const, error: { code: 'UNKNOWN', message: 'Tauri 未运行', traceId: undefined } }
    }

    setSaveStatus('saving')
    setStatusMessage('选择存储位置...')
    const suggested = filePath && filePath !== DEFAULT_PATH ? filePath : '文稿.md'
    const chosen = await saveDialog({
      defaultPath: suggested,
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdx'] }],
    })
    if (!chosen) {
      setSaveStatus('idle')
      setStatusMessage('已取消保存')
      return { ok: false as const, error: { code: 'CANCELLED', message: '用户取消', traceId: undefined } }
    }
    setSaveStatus('saving')
    setStatusMessage('保存中...')
    const resp = await handleSave(chosen)
    if (resp.ok) {
      await refreshSnapshots()
      await makeSnapshot(chosen)
    } else if (resp.error.code === 'CONFLICT') {
      setConflictError(resp.error)
      setSaveStatus('conflict')
    } else {
      setSaveStatus('error')
      setStatusMessage(resp.error.message)
    }
    return resp
  }, [filePath, handleSave, refreshSnapshots])

  useEffect(() => {
    const storedLayout = localStorage.getItem('haomd:layout') as Layout | null
    const storedWidth = localStorage.getItem('haomd:layout:width')
    const storedShow = localStorage.getItem('haomd:layout:show')
    if (storedLayout) {
      setLayout(storedLayout)
    }
    if (storedWidth) {
      const w = Number(storedWidth)
      if (!Number.isNaN(w)) setEditorWidth(w)
    }
    if (storedShow != null) {
      setShowPreview(storedShow !== 'false')
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('haomd:layout', layout)
    localStorage.setItem('haomd:layout:width', String(editorWidth))
    localStorage.setItem('haomd:layout:show', String(showPreview))
  }, [layout, editorWidth, showPreview])

  const handleManualSave = async () => {
    await saveWithDialog()
  }

  const handleShowHistory = async () => {
    setHistoryOpen((v) => !v)
    if (!historyOpen) {
      await refreshSnapshots()
    }
  }

  const handleShowRecent = async () => {
    setRecentOpen((v) => !v)
    if (!recentOpen) {
      const resp = await listRecent()
      if (resp.ok) setRecent(resp.data)
    }
  }

  const dispatchAction = useCallback(
    async (action: string) => {
      switch (action) {
        // Layout
        case 'layout_preview_left':
          setLayout('preview-left')
          setShowPreview(true)
          setStatusMessage('布局：预览在左')
          break
        case 'layout_preview_right':
          setLayout('preview-right')
          setShowPreview(true)
          setStatusMessage('布局：预览在右')
          break
        case 'layout_editor_only':
          setLayout('editor-only')
          setShowPreview(false)
          setStatusMessage('布局：仅编辑器')
          break
        case 'layout_preview_only':
          setLayout('preview-only')
          setShowPreview(true)
          setStatusMessage('布局：仅预览')
          break

        // HaoMD
        case 'haomd_about':
          setStatusMessage('HaoMD · 关于（占位）')
          break

        // File
        case 'save':
        case 'save_as':
          await saveWithDialog()
          break
        case 'open_file':
          if (!confirmLoseChanges()) return
          setStatusMessage('占位：Open File 未实现')
          break
        case 'open_folder':
          if (!confirmLoseChanges()) return
          setStatusMessage('占位：Open Folder 未实现')
          break
        case 'open_recent':
          await handleShowRecent()
          break
        case 'clear_recent':
          setRecent([])
          setStatusMessage('已清空最近列表（占位，未持久化）')
          break
        case 'open_history':
          await handleShowHistory()
          break
        case 'close_file':
          if (!confirmLoseChanges()) return
          setStatusMessage('占位：Close File 未实现')
          break
        case 'quit':
          if (!confirmLoseChanges()) return
          setStatusMessage('占位：Quit 未实现')
          break

        // Edit
        case 'undo':
        case 'redo':
        case 'cut':
        case 'copy':
        case 'paste':
        case 'find':
        case 'replace':
        case 'select_all':
        case 'toggle_comment':
        case 'format_document':
          setStatusMessage(`占位：${action} 未实现`)
          break

        // Selection
        case 'expand_selection':
        case 'shrink_selection':
        case 'select_line':
        case 'select_all_matches':
          setStatusMessage(`占位：${action} 未实现`)
          break

        // View
        case 'toggle_preview':
          setShowPreview((v) => {
            if (!v && layout === 'editor-only') {
              setLayout('preview-right')
            }
            return !v
          })
          break
        case 'split_view':
        case 'toggle_sidebar':
        case 'toggle_status_bar':
        case 'zoom_in':
        case 'zoom_out':
        case 'zoom_reset':
        case 'word_wrap':
        case 'devtools':
          setStatusMessage(`占位：${action} 未实现`)
          break

        // Go
        case 'go_line':
        case 'go_symbol':
        case 'next_tab':
        case 'prev_tab':
        case 'go_back':
        case 'go_forward':
          setStatusMessage(`占位：${action} 未实现`)
          break

        // AI
        case 'ai_chat':
        case 'ai_set_key':
        case 'ai_settings':
        case 'ai_ask_file':
        case 'ai_ask_selection':
          setStatusMessage(`占位：${action} 未实现`)
          break

        // Help
        case 'help_docs':
        case 'help_release':
        case 'help_issue':
        case 'help_about':
          setStatusMessage('HaoMD · 菜单占位/帮助')
          break

        default:
          setStatusMessage('暂未实现的菜单')
      }
    },
    [confirmLoseChanges, handleShowHistory, handleShowRecent, saveWithDialog],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      if (!meta) return

      // 避免在 Tauri 中与系统菜单快捷键（会发 menu://action 事件）重复触发
      const tauriBlocks = ['s', 'o'] as const
      if (isTauri() && tauriBlocks.includes(key as (typeof tauriBlocks)[number])) return

      if (key === 's') {
        e.preventDefault()
        if (e.shiftKey) {
          void dispatchAction('save_as')
        } else {
          void dispatchAction('save')
        }
      } else if (key === 'o') {
        e.preventDefault()
        if (e.shiftKey) {
          void dispatchAction('open_folder')
        } else {
          void dispatchAction('open_file')
        }
      } else if (key === 'p') {
        e.preventDefault()
        void dispatchAction('toggle_preview')
      } else if (key === 'h') {
        if (e.altKey) {
          e.preventDefault()
          void dispatchAction('open_recent')
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dispatchAction])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    listen<string>('menu://action', (event) => {
      console.log('menu action', event.payload)
      void dispatchAction(event.payload)
    }).then((un) => {
      unlisten = un
    })
    return () => {
      unlisten?.()
    }
  }, [dispatchAction])

  const formatTs = (ts?: number | null) => {
    if (!ts) return '未保存'
    const d = new Date(ts)
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`
  }

  const currentFileName = filePath.split('/').pop() || filePath

  return (
    <div className="app-shell">
      <main
        className={`workspace ${dragging ? 'dragging' : ''}`}
        style={{ gridTemplateColumns }}
        ref={workspaceRef}
      >
        {effectiveLayout === 'preview-left' && (
          <>
            <section className="pane preview">
              <div className="preview-body">
                <MarkdownViewer
                  value={previewValue}
                  activeLine={activeLine}
                  previewWidth={previewWidthForRender}
                />
              </div>
            </section>
            <div
              className={`divider ${dragging ? 'active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
            >
              <span className="divider-handle" />
            </div>
            <section className="pane">
              <button
                className="floating-toggle"
                aria-label={showPreview ? '隐藏预览' : '显示预览'}
                onClick={() => setShowPreview((v) => !v)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setShowPreview((v) => !v)
                  }
                }}
              >
                {showPreview ? '隐藏预览' : '显示预览'}
              </button>
              <CodeEditor
                value={markdown}
                onChange={setMarkdown}
                onCursorChange={setActiveLine}
                placeholder="在此输入 Markdown..."
                className="code-editor"
              />
            </section>
          </>
        )}

        {effectiveLayout === 'preview-right' && (
          <>
            <section className="pane">
              <button
                className="floating-toggle"
                aria-label={showPreview ? '隐藏预览' : '显示预览'}
                onClick={() => setShowPreview((v) => !v)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setShowPreview((v) => !v)
                  }
                }}
              >
                {showPreview ? '隐藏预览' : '显示预览'}
              </button>
              <CodeEditor
                value={markdown}
                onChange={setMarkdown}
                onCursorChange={setActiveLine}
                placeholder="在此输入 Markdown..."
                className="code-editor"
              />
            </section>
            <div
              className={`divider ${dragging ? 'active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
            >
              <span className="divider-handle" />
            </div>
            <section className="pane preview">
              <div className="preview-body">
                <MarkdownViewer
                  value={previewValue}
                  activeLine={activeLine}
                  previewWidth={previewWidthForRender}
                />
              </div>
            </section>
          </>
        )}

        {effectiveLayout === 'preview-only' && (
          <section className="pane preview" style={{ gridColumn: '1 / -1' }}>
            <div className="preview-body">
              <MarkdownViewer
                value={previewValue}
                activeLine={activeLine}
                previewWidth={previewWidthForRender}
              />
            </div>
          </section>
        )}

        {effectiveLayout === 'editor-only' && (
          <section className="pane" style={{ gridColumn: '1 / -1' }}>
            <button
              className="floating-toggle"
              aria-label={showPreview ? '隐藏预览' : '显示预览'}
              onClick={() => setShowPreview((v) => !v)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setShowPreview((v) => !v)
                }
              }}
            >
              {showPreview ? '隐藏预览' : '显示预览'}
            </button>
            <CodeEditor
              value={markdown}
              onChange={setMarkdown}
              onCursorChange={setActiveLine}
              placeholder="在此输入 Markdown..."
              className="code-editor"
            />
          </section>
        )}
      </main>

      {historyOpen && (
        <aside className="side-panel">
          <div className="side-header">
            <div>
              <div className="pane-title">历史版本</div>
              <div className="muted">最近 {snapshots.length} 条快照</div>
            </div>
            <button className="ghost" onClick={refreshSnapshots} disabled={historyLoading}>
              {historyLoading ? '加载中...' : '刷新'}
            </button>
          </div>
          <div className="side-body">
            {snapshots.length === 0 && <div className="muted">暂无快照</div>}
            {snapshots.map((snap) => (
              <div key={snap.snapshotPath} className="history-item">
                <div className="history-title">{snap.snapshotPath.split('/').pop()}</div>
                <div className="muted small">{formatTs(snap.createdAt)}</div>
                <div className="muted small">{(snap.sizeBytes / 1024).toFixed(1)} KB · {snap.hash.slice(0, 8)}</div>
              </div>
            ))}
          </div>
        </aside>
      )}

      {recentOpen && (
        <aside className="side-panel recent-panel">
          <div className="side-header">
            <div className="pane-title">最近文件</div>
            <button className="ghost" onClick={handleShowRecent}>
              关闭
            </button>
          </div>
          <div className="side-body">
            {recent.length === 0 && <div className="muted">暂无记录</div>}
            {recent.map((item) => (
              <div key={item.path} className="history-item">
                <div className="history-title">{item.displayName}</div>
                <div className="muted small">{item.path}</div>
                <div className="muted small">{formatTs(item.lastOpenedAt)}</div>
              </div>
            ))}
          </div>
        </aside>
      )}

      {conflictError && (
        <div className="modal-backdrop" onClick={() => setConflictError(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">检测到冲突</div>
            <div className="modal-content">
              <div className="muted">{conflictError.message}</div>
              <div className="muted small">trace: {conflictError.traceId ?? '无'}</div>
            </div>
            <div className="modal-actions">
              <button className="ghost" onClick={() => setConflictError(null)}>
                取消
              </button>
              <button className="ghost primary" onClick={handleManualSave}>
                重试保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
