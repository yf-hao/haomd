import { useCallback, useEffect, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import 'katex/dist/katex.min.css'
import 'highlight.js/styles/atom-one-dark.css'
import './App.css'
import { MarkdownViewer } from './components/MarkdownViewer'
import { CodeEditor } from './components/Editor/CodeEditor'
import { listen } from '@tauri-apps/api/event'
import { useWorkspaceLayout } from './hooks/useWorkspaceLayout'
import { useFilePersistence } from './hooks/useFilePersistence'

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
    refreshRecent,
    loadMoreRecent,
    clearRecentAll,
    deleteRecent,
    setRecent,
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
    // 只负责打开/关闭最近文件面板，不在这里访问磁盘；
    // 如需加载更多记录，通过“加载更多”按钮触发后端分页加载。
    setRecentOpen((v) => !v)
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
    let unlisten: (() => void) | undefined

    const setup = async () => {
      const un = await listen<string>('menu://open_recent_file', async (event) => {
        const path = event.payload
        if (!confirmLoseChanges()) return
        await handleOpenPath(path)
      })
      unlisten = un
    }

    void setup()

    return () => {
      unlisten?.()
    }
  }, [confirmLoseChanges, handleOpenPath])

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
        case 'new_file': {
          if (!confirmLoseChanges()) return
          newDocument()
          applyOpenedContent('')
          break
        }
        case 'save':
          await save()
          break
        case 'save_as':
          await saveAs()
          break
        case 'open_file': {
          console.log('[dispatchAction] open_file, openFile =', openFile)
          // 打开文件时，临时跳过未保存确认，避免浏览器/环境禁用 window.confirm 导致无法打开
          try {
            const resp = await openFile()
            console.log('[dispatchAction] open_file resp =', resp)
            if (resp && resp.ok) {
              applyOpenedContent(resp.data.content)
            }
          } catch (err) {
            console.error('[dispatchAction] open_file openFile threw', err)
          }
          break
        }
        case 'open_folder':
          if (!confirmLoseChanges()) return
          setStatusMessage('占位：Open Folder 未实现')
          break
        case 'open_recent':
          await handleShowRecent()
          break
        case 'clear_recent': {
          const resp = await clearRecentAll()
          if (resp.ok) {
            setStatusMessage('已清空最近文件')
          }
          break
        }
        case 'close_file':
          if (!confirmLoseChanges()) return
          setStatusMessage('占位：Close File 未实现')
          break
        case 'quit':
          if (!confirmLoseChanges()) return
          setStatusMessage('占位：Quit 未实现')
          break

        // Edit
        case 'paste': {
          // 粘贴由原生菜单 -> native://paste 事件负责，这里不再调用 execCommand
          break
        }
        case 'copy': {
          if (typeof document !== 'undefined') {
            try {
              const ok = document.execCommand('copy')
              if (!ok) setStatusMessage('复制未生效')
            } catch (err) {
              console.warn('execCommand copy failed', err)
              setStatusMessage('复制未生效')
            }
            break
          }
          setStatusMessage('复制未生效')
          break
        }
        case 'undo':
        case 'redo':
        case 'cut':
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
    [applyOpenedContent, confirmLoseChanges, handleShowRecent, newDocument, openFile, save, saveAs],
  )

  // 监听来自原生剪贴板的粘贴事件
  useEffect(() => {
    let unlistenPaste: (() => void) | undefined
    let unlistenError: (() => void) | undefined
    let disposed = false

    const setup = async () => {
      const unPaste = await listen<string>('native://paste', (event) => {
        const text = event.payload
        const view = editorViewRef.current
        console.log('[native://paste] handler fired, view =', view)
        if (!view || !text) return

        const { state } = view
        const tr = state.changeByRange((range) => ({
          range,
          changes: { from: range.from, to: range.to, insert: text },
        }))
        view.dispatch(tr)
      })
      if (disposed) {
        // 如果在监听完成前 effect 已经清理，立刻注销，避免遗留多个监听
        unPaste()
      } else {
        unlistenPaste = unPaste
      }

      const unErr = await listen<string>('native://paste_error', (event) => {
        setStatusMessage(event.payload || '粘贴失败：无法读取剪贴板')
      })
      if (disposed) {
        unErr()
      } else {
        unlistenError = unErr
      }
    }

    void setup()

    return () => {
      disposed = true
      if (unlistenPaste) {
        unlistenPaste()
      }
      if (unlistenError) {
        unlistenError()
      }
    }
  }, [setStatusMessage])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      if (!meta) return

      // 避免在 Tauri 中与系统菜单快捷键（会发 menu://action 事件）重复触发
      const tauriBlocks = ['s', 'o', 'n'] as const
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
      } else if (key === 'n') {
        e.preventDefault()
        void dispatchAction('new_file')
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
    let disposed = false

    const setup = async () => {
      const un = await listen<string>('menu://action', (event) => {
        console.log('menu action', event.payload)
        void dispatchAction(event.payload)
      })
      if (disposed) {
        // 如果在监听完成前 effect 已经清理，立刻注销，避免遗留多个监听
        un()
      } else {
        unlisten = un
      }
    }

    void setup()

    return () => {
      disposed = true
      if (unlisten) {
        unlisten()
      }
    }
  }, [dispatchAction])

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
              onMouseDown={startDragging}
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
                onChange={handleMarkdownChange}
                onCursorChange={setActiveLine}
                placeholder="在此输入 Markdown..."
                className="code-editor"
                onViewReady={(view) => {
                  editorViewRef.current = view
                }}
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
                onChange={handleMarkdownChange}
                onCursorChange={setActiveLine}
                placeholder="在此输入 Markdown..."
                className="code-editor"
                onViewReady={(view) => {
                  editorViewRef.current = view
                }}
              />
            </section>
            <div
              className={`divider ${dragging ? 'active' : ''}`}
              onMouseDown={startDragging}
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
              onChange={handleMarkdownChange}
              onCursorChange={setActiveLine}
              placeholder="在此输入 Markdown..."
              className="code-editor"
              onViewReady={(view) => {
                editorViewRef.current = view
              }}
            />
          </section>
        )}
      </main>

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
              <div key={item.path} className="history-item-row">
                <div
                  className="history-item"
                  role="button"
                  tabIndex={0}
                  onClick={async () => {
                    if (!confirmLoseChanges()) return
                    await handleOpenPath(item.path)
                    setRecentOpen(false)
                  }}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      if (!confirmLoseChanges()) return
                      await handleOpenPath(item.path)
                      setRecentOpen(false)
                    }
                  }}
                >
                  <div className="history-title">{item.displayName}</div>
                  <div className="muted small">{item.path}</div>
                  <div className="muted small">{formatTs(item.lastOpenedAt)}</div>
                </div>
                <button
                  className="ghost small danger"
                  onClick={async (e) => {
                    e.stopPropagation()
                    const resp = await deleteRecent(item.path)
                    if (!resp.ok) return
                  }}
                >
                  删除
                </button>
              </div>
            ))}
            {recentHasMore && (
              <div className="recent-more">
                <button
                  className="ghost"
                  disabled={recentLoading}
                  onClick={async () => {
                    await loadMoreRecent()
                  }}
                >
                  {recentLoading ? '加载中…' : '加载更多'}
                </button>
              </div>
            )}
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
