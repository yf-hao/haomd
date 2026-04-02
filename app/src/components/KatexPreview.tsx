/**
 * Lightweight KaTeX renderer for inline use (e.g. math symbol preview cards).
 * Loads KaTeX on first use and caches rendered HTML.
 */
import { memo, useEffect, useState } from 'react'

let katexInstance: typeof import('katex').default | null = null
let katexLoadPromise: Promise<void> | null = null
const cache = new Map<string, string>()

function loadKatex(): Promise<void> {
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

export type KatexPreviewProps = {
  tex: string
  displayMode?: boolean
  className?: string
}

export const KatexPreview = memo(function KatexPreview({
  tex,
  displayMode = false,
  className,
}: KatexPreviewProps) {
  const [html, setHtml] = useState<string>(() => cache.get(tex) ?? '')

  useEffect(() => {
    if (cache.has(tex)) {
      setHtml(cache.get(tex)!)
      return
    }
    loadKatex().then(() => {
      try {
        const rendered = katexInstance!.renderToString(tex, {
          displayMode,
          throwOnError: false,
          trust: true,
        })
        cache.set(tex, rendered)
        setHtml(rendered)
      } catch {
        const fallback = `<span style="color:var(--theme-text-secondary);font-size:11px">${tex}</span>`
        cache.set(tex, fallback)
        setHtml(fallback)
      }
    })
  }, [tex, displayMode])

  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
})
