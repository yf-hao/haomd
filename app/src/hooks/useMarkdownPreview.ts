import { useLayoutEffect, useRef, useState } from 'react'
import { cachePreviewMarkdown, getCachedPreviewMarkdown, preparePreviewMarkdown } from '../modules/markdown/previewPipeline'
import { createPreviewProcessor } from '../modules/markdown/preview/previewProcessor'

export function useMarkdownPreview(value: string, options: {
  enabled: boolean
  useWorker: boolean
  documentKey?: string | null
}) {
  const [result, setResult] = useState(() => preparePreviewMarkdown(value))
  const processorRef = useRef<ReturnType<typeof createPreviewProcessor> | null>(null)
  const { enabled, useWorker, documentKey } = options

  // A text update submits a task; it never owns the lifetime of the executor.
  useLayoutEffect(() => {
    if (!enabled) return
    let disposed = false
    const processor = createPreviewProcessor({
      createWorker: () => typeof Worker === 'undefined' ? null : new Worker(
        new URL('../workers/markdownPreview.worker.ts', import.meta.url), { type: 'module' },
      ),
      prepare: preparePreviewMarkdown,
      cached: getCachedPreviewMarkdown,
      cache: cachePreviewMarkdown,
      publish: next => setResult(previous => disposed ? previous : next),
      onError: error => console.warn('[MarkdownPreview] worker unavailable; using fallback', error),
    })
    processorRef.current = processor
    return () => {
      disposed = true
      processor.dispose()
      if (processorRef.current === processor) processorRef.current = null
    }
  }, [documentKey, enabled])

  useLayoutEffect(() => {
    processorRef.current?.request(value, useWorker)
  }, [value, useWorker, documentKey, enabled])

  return result
}
