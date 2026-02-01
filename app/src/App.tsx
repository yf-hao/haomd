import { useEffect, useMemo, useRef, useState } from 'react'
import 'katex/dist/katex.min.css'
import 'highlight.js/styles/atom-one-dark.css'
import './App.css'
import { MarkdownViewer } from './components/MarkdownViewer'
import { CodeEditor } from './components/Editor/CodeEditor'

const seed = [
  '# ZenMark',
  '',
  '- 实时预览',
  '- 支持 KaTeX / Mermaid / PlantUML / XMind',
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
  '## PlantUML',
  '```plantuml',
  '@startuml',
  'Alice -> Bob : Hello',
  '@enduml',
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

function App() {
  const [markdown, setMarkdown] = useState(seed)
  const [previewValue, setPreviewValue] = useState(seed)
  const [activeLine, setActiveLine] = useState(1)
  const [showPreview, setShowPreview] = useState(true)
  const [editorWidth, setEditorWidth] = useState(55)
  const [dragging, setDragging] = useState(false)
  const workspaceRef = useRef<HTMLElement | null>(null)
  const previewTimerRef = useRef<number | null>(null)

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

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="dot" />
          <span className="title">HaoMD</span>
          <span className="tag">Tauri 2 · React · TS</span>
        </div>
        <div className="toolbar">
          <button className="ghost">新建</button>
          <button className="ghost">打开</button>
          <button className="ghost primary">保存</button>
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
                <div className="hint">KaTeX / Mermaid / PlantUML / XMind</div>
              </header>
              <div className="preview-body">
                <MarkdownViewer value={previewValue} activeLine={activeLine} />
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  )
}

export default App
