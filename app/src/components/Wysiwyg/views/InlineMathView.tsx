/**
 * React node view for inline math ($...$).
 * Renders the LaTeX content via KaTeX inline.
 */
import { memo, useEffect, useRef, useState } from 'react'
import { useNodeViewContext } from '@prosemirror-adapter/react'

let katexInstance: typeof import('katex').default | null = null
let katexLoadPromise: Promise<void> | null = null
const katexInlineCache = new Map<string, string>()

function loadKatex() {
  if (katexInstance) return Promise.resolve()
  if (katexLoadPromise) return katexLoadPromise
  katexLoadPromise = Promise.all([
    import('katex'),
    import('katex/dist/katex.min.css'),
  ]).then(([mod]) => {
    katexInstance = mod.default
  })
  return katexLoadPromise
}

export const InlineMathView = memo(function InlineMathView() {
  const { node, selected, contentRef } = useNodeViewContext()
  const [html, setHtml] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const renderTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tex = node.textContent || ''

  useEffect(() => {
    if (!tex) {
      setHtml('')
      setError(null)
      return
    }

    // Check cache first
    const cached = katexInlineCache.get(tex)
    if (cached) {
      setHtml(cached)
      setError(null)
      return
    }

    // Debounce rendering (200ms)
    if (renderTimer.current) clearTimeout(renderTimer.current)
    renderTimer.current = setTimeout(() => {
      loadKatex().then(() => {
        try {
          const rendered = katexInstance!.renderToString(tex, {
            displayMode: false,
            throwOnError: false,
            trust: true,
          })
          katexInlineCache.set(tex, rendered)
          setHtml(rendered)
          setError(null)
        } catch (e: any) {
          setError(e.message || 'KaTeX render error')
          setHtml('')
        }
      })
    }, 200)

    return () => {
      if (renderTimer.current) clearTimeout(renderTimer.current)
    }
  }, [tex])

  const handleDoubleClick = () => setEditing(true)
  const handleBlur = () => setEditing(false)

  if (editing || !tex) {
    return (
      <span
        className={`wysiwyg-math-inline editing ${selected ? 'selected' : ''}`}
        onBlur={handleBlur}
      >
        <span className="wysiwyg-math-dollar">$</span>
        <span ref={contentRef} className="wysiwyg-math-source-inline" />
        <span className="wysiwyg-math-dollar">$</span>
      </span>
    )
  }

  return (
    <span
      className={`wysiwyg-math-inline ${selected ? 'selected' : ''}`}
      onDoubleClick={handleDoubleClick}
      contentEditable={false}
    >
      {error ? (
        <span className="wysiwyg-math-error">{error}</span>
      ) : (
        <span dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </span>
  )
})
