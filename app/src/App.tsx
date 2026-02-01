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
import { save as saveDialog } from '@tauri-apps/plugin-dialog'

const isTauri = () =>
  typeof window !== 'undefined' &&
  (Boolean((window as any).__TAURI_INTERNALS__) || Boolean((window as any).__TAURI__))

const seed = [
  '# ZenMark',
  '',
  '- 实时预览',
  '- 支持 KaTeX / Mermaid / XMind',
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
  '```xmind',
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
].join('\n')

const DEFAULT_PATH = '未命名.md'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict'

function App() {
  const [markdown, setMarkdown] = useState(seed)
  const [previewValue, setPreviewValue] = useState(seed)
  const [activeLine, setActiveLine] = useState(1)
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

  const gridTemplateColumns = useMemo(() => {
    if (!showPreview) return '1fr'
    const editor = Math.min(70, Math.max(30, editorWidth))
    const preview = Math.max(30, 100 - editor)
    return `${editor}% 10px ${preview}%`
  }, [editorWidth, showPreview])

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!dragging || !workspaceRef.current) return
      const rect = workspaceRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left
      const percent = (x / rect.width) * 100
      const clamped = Math.min(70, Math.max(30, percent))
      setEditorWidth(clamped)
    }
    const handleUp = () => dragging && setDragging(false)
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [dragging])

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
      }
      return resp
    },
    [filePath, markdown, currentHash, currentMtime],
  )

  useEffect(() => {
    saverRef.current?.cancel()
    saverRef.current = createAutoSaver({
      save: () => handleSave(),
      isDirty: () => dirty,
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
          setShowPreview((v) => !v)
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
      <header className="topbar">
        <div className="brand">
          <span className="dot" />
          <div className="file-meta">
            <div className="file-name-row">
              <span className="title">{currentFileName}</span>
              {dirty && <span className="dirty-dot" title="未保存变更" />}
            </div>
            <div className="file-sub">{filePath}</div>
          </div>
        </div>
        <div className="toolbar">
          <div className="status-group">
            <span className={`status-pill ${saveStatus}`}>
              {saveStatus === 'saving'
                ? '保存中'
                : saveStatus === 'saved'
                  ? '已保存'
                  : saveStatus === 'conflict'
                    ? '冲突'
                    : saveStatus === 'error'
                      ? '错误'
                      : '空闲'}
            </span>
            <span className="muted">{statusMessage || `上次保存：${formatTs(lastSavedAt)}`}</span>
          </div>
          <div className="toolbar-group">
            <button className="ghost" onClick={handleShowRecent}>
              最近
            </button>
            <button className="ghost" onClick={handleShowHistory}>
              历史
            </button>
            <button className="ghost primary" onClick={handleManualSave}>
              保存
            </button>
          </div>
        </div>
      </header>

      <main
        className={`workspace ${dragging ? 'dragging' : ''}`}
        style={{ gridTemplateColumns }}
        ref={workspaceRef}
      >
        <section className="pane">
          <header className="pane-header">
            <div className="pane-title">编辑器</div>
            <div
              className="hint clickable"
              role="button"
              tabIndex={0}
              onClick={() => setShowPreview((v) => !v)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setShowPreview((v) => !v)
                }
              }}
            >
              {showPreview ? '点击隐藏预览' : '点击显示预览'}
            </div>
          </header>
          <CodeEditor
            value={markdown}
            onChange={setMarkdown}
            onCursorChange={setActiveLine}
            placeholder="在此输入 Markdown..."
            className="code-editor"
          />
        </section>

        {showPreview && (
          <>
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
              <header className="pane-header">
                <div className="pane-title">预览</div>
                <div className="hint">KaTeX / Mermaid / XMind</div>
              </header>
              <div className="preview-body">
                <MarkdownViewer value={previewValue} activeLine={activeLine} />
              </div>
            </section>
          </>
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
