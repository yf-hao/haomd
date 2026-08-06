/**
 * React node view for block math ($$...$$).
 * Renders the LaTeX content via KaTeX.
 */
import { memo, useEffect, useRef, useState, type FocusEvent } from 'react'
import { useNodeViewContext } from '@prosemirror-adapter/react'
import { useInViewport } from '../hooks/useInViewport'

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
  const editingContainerRef = useRef<HTMLDivElement>(null)
  const renderTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { ref: viewportRef, isVisible } = useInViewport('250px')
  const tex = node.textContent || ''

  useEffect(() => {
    if (!isVisible) return
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
  }, [isVisible, tex])

  useEffect(() => {
    if (!editing) return

    const frame = requestAnimationFrame(() => {
      editingContainerRef.current
        ?.querySelector<HTMLElement>('.wysiwyg-math-source')
        ?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [editing])

  useEffect(() => {
    if (!editing) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!editingContainerRef.current?.contains(event.target as Node)) {
        setEditing(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [editing])

  const handleClick = () => setEditing(true)
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setEditing(false)
    }
  }

  if (editing || !tex) {
    // Show raw LaTeX source (editable ProseMirror content)
    return (
      <div
        ref={(element) => {
          editingContainerRef.current = element
        }}
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
      ref={viewportRef}
      className={`wysiwyg-math-block ${selected ? 'selected' : ''}`}
      onClick={handleClick}
      contentEditable={false}
    >
      {!isVisible ? (
        <div className="wysiwyg-diagram-loading">公式加载中…</div>
      ) : error ? (
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
