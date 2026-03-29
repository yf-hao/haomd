/**
 * Custom code block view for Milkdown WYSIWYG editor.
 * Handles special languages (mermaid, mind) with visual rendering,
 * and falls back to plain code display for other languages.
 */
import { memo, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useNodeViewContext } from '@prosemirror-adapter/react'
import { useResolvedThemeMode } from '../../../modules/theme/ThemeContext'
import { renderMermaidToSvg } from '../../../modules/visualization/mermaidRenderer'
import { useInViewport } from '../hooks/useInViewport'
import CodeBlockHighlighted from '../../CodeBlockHighlighted'
import { normalizeCodeBlockLanguage } from '../codeLanguage'
import { setLastUsedCodeBlockLanguage } from '../WysiwygPane'

/* ---------- Mind-elixir lazy loading ---------- */

let MindElixirCtor: any = null
let SIDE_VALUE: number | null = null
let mindLoadPromise: Promise<void> | null = null

function loadMindElixir() {
  if (MindElixirCtor) return Promise.resolve()
  if (mindLoadPromise) return mindLoadPromise
  mindLoadPromise = Promise.all([
    import('mind-elixir'),
    import('mind-elixir/style'),
  ]).then(([mod]) => {
    MindElixirCtor = mod.default
    SIDE_VALUE = (mod as any).SIDE
  })
  return mindLoadPromise
}

/* ---------- Outline parser (reused from diagrams.tsx logic) ---------- */

interface MindNode {
  topic: string
  children?: MindNode[]
}

function parseOutlineToMindData(text: string): any {
  const lines = text.split('\n').filter((l) => l.trim())
  if (!lines.length) return null

  const root: MindNode = { topic: 'Root', children: [] }
  const stack: { node: MindNode; indent: number }[] = [{ node: root, indent: -1 }]

  for (const line of lines) {
    const match = /^(\s*)[-*]?\s*(.+)/.exec(line)
    if (!match) continue
    const indent = match[1].length
    const topic = match[2].trim()
    const child: MindNode = { topic, children: [] }

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop()
    }
    const parent = stack[stack.length - 1].node
    if (!parent.children) parent.children = []
    parent.children.push(child)
    stack.push({ node: child, indent })
  }

  if (root.children!.length === 1) {
    return toMindElixirData(root.children![0])
  }
  return toMindElixirData(root)
}

function toMindElixirData(node: MindNode): any {
  const result: any = {
    nodeData: {
      id: 'root',
      topic: node.topic,
      children: (node.children || []).map((child, i) => convertChild(child, `${i}`)),
    },
  }
  if (SIDE_VALUE != null) result.direction = SIDE_VALUE
  return result
}

function convertChild(node: MindNode, prefix: string): any {
  return {
    id: `node-${prefix}`,
    topic: node.topic,
    children: (node.children || []).map((child, i) => convertChild(child, `${prefix}-${i}`)),
  }
}

/* ---------- Mermaid sub-component ---------- */

const MermaidPreview = memo(function MermaidPreview({ code }: { code: string }) {
  const themeMode = useResolvedThemeMode()
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [mermaidId] = useState(() => `mermaid-wysiwyg-${Math.random().toString(36).slice(2)}`)
  const renderTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // Debounce Mermaid rendering (500ms — diagrams are expensive)
    if (renderTimer.current) clearTimeout(renderTimer.current)
    renderTimer.current = setTimeout(() => {
      const cancelled = false
      renderMermaidToSvg(code, mermaidId, { themeMode }).then((result) => {
        if (cancelled) return
        setSvg(result)
        setError(null)
      }).catch((e) => {
        if (cancelled) return
        setError(e.message || 'Mermaid render error')
      })
      // Store cancel fn on timer ref for cleanup
      renderTimer.current = null
    }, 500)

    return () => {
      if (renderTimer.current) clearTimeout(renderTimer.current)
    }
  }, [code, mermaidId, themeMode])

  if (error) {
    return <div className="wysiwyg-diagram-error">Mermaid Error: {error}</div>
  }
  if (!svg) {
    return <div className="wysiwyg-diagram-loading">Mermaid 加载中…</div>
  }
  return <div className="wysiwyg-mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} />
})

/* ---------- Mind-elixir sub-component ---------- */

const MindPreview = memo(function MindPreview({ code }: { code: string }) {
  const themeMode = useResolvedThemeMode()
  const containerRef = useRef<HTMLDivElement>(null)
  const mindRef = useRef<any>(null)
  const renderTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    // Debounce Mind-elixir rendering (500ms)
    if (renderTimer.current) clearTimeout(renderTimer.current)
    renderTimer.current = setTimeout(() => {
      loadMindElixir().then(() => {
        if (!containerRef.current || !MindElixirCtor) return

        let data: any
        try {
          data = JSON.parse(code)
          if (data.nodeData) {
            // Already in mind-elixir format
          } else if (data.topic || data.title) {
            data = toMindElixirData(data)
          }
        } catch {
          data = parseOutlineToMindData(code)
        }
        if (!data) return

        const el = containerRef.current!

        const baseTheme = themeMode === 'dark'
          ? (MindElixirCtor.DARK_THEME ?? { name: 'dark', palette: ['#848FA0', '#748BE9', '#D2F9FE', '#4145A5', '#789AFA', '#706CF4', '#EF987F', '#775DD5', '#FCEABB', '#F7F7F7'], cssVar: { '--main-color': '#ffffff', '--main-bgcolor': '#4c4f69', '--color': '#cccccc', '--bgcolor': 'transparent' } })
          : (MindElixirCtor.THEME ?? { name: 'light', palette: ['#848FA0', '#748BE9', '#D2F9FE', '#4145A5', '#789AFA', '#706CF4', '#EF987F', '#775DD5', '#FCEABB', '#F7F7F7'], cssVar: { '--main-color': '#444446', '--main-bgcolor': '#ffffff', '--color': '#777777', '--bgcolor': 'transparent' } })

        // Reuse existing instance if possible, otherwise create new
        if (mindRef.current) {
          try {
            mindRef.current.destroy?.()
          } catch { /* ignore */ }
        }
        el.innerHTML = ''

        const mind = new MindElixirCtor({
          el,
          direction: data.direction ?? (SIDE_VALUE as any),
          editable: false,
          contextMenu: false,
          toolBar: false,
          keypress: false,
          allowUndo: false,
          locale: 'zh_CN',
          theme: baseTheme,
        })
        mind.init(data)
        mindRef.current = mind

        requestAnimationFrame(() => {
          try {
            mind.scaleFit?.()
            mind.toCenter?.()
          } catch { /* ignore */ }
        })
      })
    }, 500)

    return () => {
      if (renderTimer.current) clearTimeout(renderTimer.current)
    }
  }, [code, themeMode])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try {
        mindRef.current?.destroy?.()
      } catch { /* ignore */ }
      mindRef.current = null
    }
  }, [])

  const style: CSSProperties = { width: '100%', minHeight: 300, position: 'relative' }
  return <div ref={containerRef} className="wysiwyg-mind-container" style={style} />
})

/* ---------- Main CodeBlock view ---------- */

const CODE_BLOCK_LANGUAGE_OPTIONS = [
  { value: '', label: 'Text' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'java', label: 'Java' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'csharp', label: 'C#' },
  { value: 'python', label: 'Python' },
  { value: 'bash', label: 'Bash' },
  { value: 'json', label: 'JSON' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'sql', label: 'SQL' },
  { value: 'yaml', label: 'YAML' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'mermaid', label: 'Mermaid' },
  { value: 'mind', label: 'Mind' },
] as const

function getLanguageSelectWidth(value: string): string {
  const label = CODE_BLOCK_LANGUAGE_OPTIONS.find((option) => option.value === value)?.label ?? 'Text'
  return `${Math.max(label.length + 4, 8)}ch`
}

export const CodeBlockView = memo(function CodeBlockView() {
  const { node, contentRef, selected, getPos, view } = useNodeViewContext()
  const language = normalizeCodeBlockLanguage(node.attrs.language)
  const code = node.textContent || ''
  const [showSource, setShowSource] = useState(false)
  const [selectedLanguage, setSelectedLanguage] = useState(language)
  const [copied, setCopied] = useState(false)
  const { ref: viewportRef, isVisible } = useInViewport('300px')
  const languageSelectWidth = getLanguageSelectWidth(selectedLanguage)

  const isSpecial = language === 'mermaid' || language === 'mind'

  useEffect(() => {
    setSelectedLanguage(language)
  }, [code, language, node.attrs.language])

  const handleLanguageChange = (nextLanguage: string) => {
    const pos = getPos()
    setSelectedLanguage(nextLanguage)
    setLastUsedCodeBlockLanguage(nextLanguage)
    if (typeof pos === 'number') {
      view.dispatch(view.state.tr.setNodeAttribute(pos, 'language', nextLanguage))
    }

    if (nextLanguage === 'mermaid' || nextLanguage === 'mind') {
      setShowSource(false)
    }
  }

  const handleCopy = async () => {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(code)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = code
        textarea.setAttribute('readonly', 'true')
        textarea.style.position = 'fixed'
        textarea.style.top = '-9999px'
        textarea.style.left = '-9999px'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
      setCopied(true)
      window.setTimeout(() => {
        setCopied(false)
      }, 1200)
    } catch {
      setCopied(false)
    }
  }

  if (isSpecial && !showSource) {
    return (
      <div
        ref={viewportRef}
        className={`wysiwyg-codeblock-special ${selected ? 'selected' : ''}`}
        contentEditable={false}
      >
        <div className="wysiwyg-codeblock-toolbar">
          <div className="wysiwyg-codeblock-toolbar-spacer" />
          <div className="wysiwyg-codeblock-toolbar-right">
            <select
              className="wysiwyg-codeblock-lang-select"
              value={selectedLanguage}
              style={{ width: languageSelectWidth }}
              onChange={(event) => handleLanguageChange(event.target.value)}
            >
              {CODE_BLOCK_LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value || 'text'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              className="wysiwyg-codeblock-edit-btn"
              onClick={handleCopy}
              title={copied ? '已复制' : '复制'}
            >
              {copied ? '✓' : '⧉'}
            </button>
            <button
              className="wysiwyg-codeblock-edit-btn"
              onClick={() => setShowSource(true)}
              title="编辑源码"
            >
              ✏️
            </button>
          </div>
        </div>
        {!isVisible ? (
          <div className="wysiwyg-diagram-loading">{language} — 滚动到此处后渲染</div>
        ) : language === 'mermaid' ? (
          <MermaidPreview code={code} />
        ) : (
          <MindPreview code={code} />
        )}
      </div>
    )
  }

  if (!isSpecial && !showSource) {
    return (
      <div
        className={`wysiwyg-codeblock ${selected ? 'selected' : ''}`}
        contentEditable={false}
      >
        <div className="wysiwyg-codeblock-toolbar">
          <div className="wysiwyg-codeblock-toolbar-spacer" />
          <div className="wysiwyg-codeblock-toolbar-right">
            <select
              className="wysiwyg-codeblock-lang-select"
              value={selectedLanguage}
              style={{ width: languageSelectWidth }}
              onChange={(event) => handleLanguageChange(event.target.value)}
            >
              {CODE_BLOCK_LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value || 'text'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              className="wysiwyg-codeblock-edit-btn"
              onClick={handleCopy}
              title={copied ? '已复制' : '复制'}
            >
              {copied ? '✓' : '⧉'}
            </button>
            <button
              className="wysiwyg-codeblock-edit-btn"
              onClick={() => setShowSource(true)}
              title="编辑源码"
            >
              ✏️
            </button>
          </div>
        </div>
        <div
          className="wysiwyg-codeblock-preview"
          onClick={() => setShowSource(true)}
          title="点击编辑源码"
        >
          <CodeBlockHighlighted lang={selectedLanguage || undefined} content={code} showCopyButton={false} />
        </div>
      </div>
    )
  }

  // Source editing mode
  return (
    <div className={`wysiwyg-codeblock ${selected ? 'selected' : ''}`}>
      <div className="wysiwyg-codeblock-toolbar">
        <div className="wysiwyg-codeblock-toolbar-spacer" />
        <div className="wysiwyg-codeblock-toolbar-right">
          <select
            className="wysiwyg-codeblock-lang-select"
            value={selectedLanguage}
            style={{ width: languageSelectWidth }}
            onChange={(event) => handleLanguageChange(event.target.value)}
          >
            {CODE_BLOCK_LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value || 'text'} value={option.value}>
                {option.label}
                </option>
              ))}
            </select>
          <button
            className="wysiwyg-codeblock-edit-btn"
            onClick={handleCopy}
            title={copied ? '已复制' : '复制'}
          >
            {copied ? '✓' : '⧉'}
          </button>
          <button
            className="wysiwyg-codeblock-edit-btn"
            onClick={() => setShowSource(false)}
            title="预览"
          >
            👁
          </button>
        </div>
      </div>
      <pre>
        <div ref={contentRef} className="wysiwyg-codeblock-source" />
      </pre>
    </div>
  )
})
