import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useMarkdownPreview } from './useMarkdownPreview'
import { preparePreviewMarkdown } from '../modules/markdown/previewPipeline'
import type { PreviewRequest, PreviewWorkerPort } from '../modules/markdown/preview/previewProcessor'

afterEach(() => vi.unstubAllGlobals())

it('keeps the executor alive across text changes and isolates document switches', () => {
  const workers: Array<PreviewWorkerPort & { requests: PreviewRequest[] }> = []
  vi.stubGlobal('Worker', class {
    onmessage = null
    onerror = null
    requests: PreviewRequest[] = []
    terminate = vi.fn()
    constructor() { workers.push(this) }
    postMessage(request: PreviewRequest) { this.requests.push(request) }
  })
  const { result, rerender, unmount } = renderHook(
    ({ value, documentKey }) => useMarkdownPreview(value, { documentKey, enabled: true, useWorker: true }),
    { initialProps: { value: 'initial for hook test', documentKey: 'A' } },
  )
  rerender({ value: 'A changed once', documentKey: 'A' })
  rerender({ value: 'A changed twice', documentKey: 'A' })
  expect(workers).toHaveLength(1)
  const callback = workers[0].onmessage!
  rerender({ value: 'B content', documentKey: 'B' })
  expect(workers[0].terminate).toHaveBeenCalledOnce()
  expect(workers).toHaveLength(2)
  act(() => {
    callback({ data: { id: workers[0].requests[0].id, ...preparePreviewMarkdown('A changed once') } } as never)
    workers[1].onmessage!({ data: { id: workers[1].requests[0].id, ...preparePreviewMarkdown('B content') } } as never)
  })
  expect(result.current.processedMarkdown).toBe('B content')
  unmount()
  expect(workers[1].terminate).toHaveBeenCalledOnce()
})
