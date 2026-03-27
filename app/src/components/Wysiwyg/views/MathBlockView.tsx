/**
 * React node view for block math ($$...$$).
 * Renders the LaTeX content via KaTeX.
 */
import { memo, useEffect, useRef, useState } from 'react'
import { useNodeViewContext } from '@prosemirror-adapter/react'

let katexInstance: typeof import('katex').default | null = null
let katexLoadPromise: Promise<void> | null = null
const katexBlockCache = new Map<string, string>()

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

export const MathBlockView = memo(function MathBlockView() {
  const { node, selected, contentRef } = useNodeViewContext()
  const [html, setHtml] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const contentDivRef = useRef<HTMLDivElement>(null)
  const renderTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tex = node.textContent || ''

  useEffect(() => {
    if (!tex) {
      setHtml('')
      setError(null)
      return
    }

    // Check cache first
    const cached = katexBlockCache.get(tex)
    if (cached) {
      setHtml(cached)
      setError(null)
      return
    }

    // Debounce rendering (300ms)
    if (renderTimer.current) clearTimeout(renderTimer.current)
    renderTimer.current = setTimeout(() => {
      loadKatex().then(() => {
        try {
          const rendered = katexInstance!.renderToString(tex, {
            displayMode: true,
            throwOnError: false,
            trust: true,
          })
          katexBlockCache.set(tex, rendered)
          setHtml(rendered)
          setError(null)
        } catch (e: any) {
          setError(e.message || 'KaTeX render error')
          setHtml('')
        }
      })
    }, 300)

    return () => {
      if (renderTimer.current) clearTimeout(renderTimer.current)
    }
  }, [tex])

  // Toggle editing on double-click
  const handleDoubleClick = () => setEditing(true)
  const handleBlur = () => setEditing(false)

  if (editing || !tex) {
    // Show raw LaTeX source (editable ProseMirror content)
    return (
      <div
        className={`wysiwyg-math-block editing ${selected ? 'selected' : ''}`}
        onBlur={handleBlur}
      >
        <div className="wysiwyg-math-label">$$</div>
        <div ref={contentRef} className="wysiwyg-math-source" />
        <div className="wysiwyg-math-label">$$</div>
      </div>
    )
  }

  // Show rendered KaTeX
  return (
    <div
      className={`wysiwyg-math-block ${selected ? 'selected' : ''}`}
      onDoubleClick={handleDoubleClick}
      contentEditable={false}
    >
      {error ? (
        <div className="wysiwyg-math-error">{error}</div>
      ) : (
        <div
          ref={contentDivRef}
          className="wysiwyg-math-rendered"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  )
})
