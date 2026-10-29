import { describe, expect, it, vi } from 'vitest'
import { preparePreviewMarkdown, type PreviewMarkdownResult } from '../previewPipeline'
import { createPreviewProcessor, type PreviewRequest, type PreviewResponse, type PreviewWorkerPort } from './previewProcessor'
import { createPreviewEncoder } from './previewTransport'

class FakeWorker implements PreviewWorkerPort {
  encode = createPreviewEncoder()
  onmessage: PreviewWorkerPort['onmessage'] = null
  onerror: PreviewWorkerPort['onerror'] = null
  postMessage = vi.fn<(request: PreviewRequest) => void>()
  terminate = vi.fn()
  complete(index: number) {
    const request = this.postMessage.mock.calls[index][0]
    this.onmessage?.({ data: this.encode(request.id, preparePreviewMarkdown(request.value)) } as MessageEvent<PreviewResponse>)
  }
}

function fixture() {
  const worker = new FakeWorker()
  const cache = new Map<string, PreviewMarkdownResult>()
  const dependencies = {
    createWorker: vi.fn(() => worker),
    prepare: vi.fn(preparePreviewMarkdown),
    cached: (value: string) => cache.get(value) ?? null,
    cache: (value: string, result: PreviewMarkdownResult) => { cache.set(value, result) },
    publish: vi.fn(), onError: vi.fn(),
  }
  return { worker, cache, dependencies, processor: createPreviewProcessor(dependencies) }
}

describe('preview processor', () => {
  it('publishes each asynchronous preview with its matching resource base', () => {
    const { worker, dependencies, processor } = fixture()
    processor.request('![image](images/a.png)', true, '/old/note.md')
    processor.request('![image](../old/images/a.png)', true, '/new/note.md')
    worker.complete(0)
    expect(dependencies.publish.mock.lastCall?.[1].resourcePath).toBe('/old/note.md')
    worker.complete(1)
    expect(dependencies.publish.mock.lastCall?.[1].resourcePath).toBe('/new/note.md')
    expect(dependencies.publish.mock.lastCall?.[0].processedMarkdown).toContain('../old/images/a.png')
  })
  it('warms the worker from the initial cached preview before the first edit', () => {
    const { worker, cache, dependencies, processor } = fixture()
    cache.set('initial cached document', preparePreviewMarkdown('initial cached document'))
    processor.request('initial cached document', true)
    expect(dependencies.publish).toHaveBeenCalledOnce()
    expect(worker.postMessage).toHaveBeenCalledOnce()
    worker.complete(0)
    expect(dependencies.publish).toHaveBeenCalledOnce()
    processor.request('first edit', true)
    expect(dependencies.createWorker).toHaveBeenCalledOnce()
    expect(worker.postMessage.mock.calls[1][0].value).toBe('first edit')
    worker.complete(1)
    expect(dependencies.publish.mock.lastCall?.[0].processedMarkdown).toBe('first edit')
  })

  it('reuses a worker, keeps only the latest pending input, and shows progress', () => {
    const { worker, dependencies, processor } = fixture()
    processor.request('first', true)
    for (let index = 0; index < 30; index++) processor.request(`edit ${index}`, true)
    expect(dependencies.createWorker).toHaveBeenCalledOnce()
    expect(worker.postMessage).toHaveBeenCalledOnce()
    worker.complete(0)
    expect(dependencies.publish.mock.calls[0][0].processedMarkdown).toBe('first')
    expect(worker.postMessage.mock.calls[1][0].value).toBe('edit 29')
    worker.complete(1)
    expect(dependencies.publish.mock.lastCall?.[0].processedMarkdown).toBe('edit 29')
    expect(worker.terminate).not.toHaveBeenCalled()
    processor.dispose()
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('does not regress after a newer cache hit and rejects late session responses', () => {
    const { worker, cache, dependencies, processor } = fixture()
    processor.request('older', true)
    const lateMessage = worker.onmessage!
    cache.set('newer', preparePreviewMarkdown('newer'))
    processor.request('newer', true)
    worker.complete(0)
    expect(dependencies.publish).toHaveBeenCalledOnce()
    processor.dispose()
    lateMessage({ data: { id: 99, ...preparePreviewMarkdown('late') } } as MessageEvent<PreviewResponse>)
    expect(dependencies.publish).toHaveBeenCalledOnce()
  })

  it('falls back on failure using the latest pending value without a restart loop', () => {
    const { worker, dependencies, processor } = fixture()
    processor.request('old', true)
    processor.request('latest', true)
    worker.onerror!(new ErrorEvent('error'))
    expect(dependencies.publish.mock.lastCall?.[0]).toEqual(preparePreviewMarkdown('latest'))
    processor.request('after failure', true)
    expect(dependencies.createWorker).toHaveBeenCalledOnce()
    expect(dependencies.publish.mock.lastCall?.[0]).toEqual(preparePreviewMarkdown('after failure'))
  })

  it('recovers from a transport base mismatch with the newest complete document', () => {
    const { worker, dependencies, processor } = fixture()
    processor.request('old transport input', true)
    processor.request('newest transport input', true)
    const metadata = { ...preparePreviewMarkdown('old transport input'), blockChunks: undefined }
    worker.onmessage!(new MessageEvent<PreviewResponse>('message', { data: { id: worker.postMessage.mock.calls[0][0].id, ...metadata,
      chunkPatch: { baseId: 999, prefix: 1, suffix: 0, inserted: [] },
    } }))
    expect(dependencies.publish).toHaveBeenCalledWith(preparePreviewMarkdown('newest transport input'), expect.objectContaining({ value: 'newest transport input' }))
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it.each([true, false])('preserves preview semantics with worker=%s', useWorker => {
    const { worker, dependencies, processor } = fixture()
    const value = '---\ntitle: Test\n---\n\n[toc]\n\n# 标题\n\n$x^2$\n\n[链接][ref]\n\n[ref]: https://example.com'
    processor.request(value, useWorker)
    if (useWorker) worker.complete(0)
    expect(dependencies.publish).toHaveBeenCalledWith(preparePreviewMarkdown(value), expect.objectContaining({ value }))
  })
})
