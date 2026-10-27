import type { PreviewMarkdownResult } from '../previewPipeline'
import { createPreviewDecoder, type PreviewResponse } from './previewTransport'

export type { PreviewResponse } from './previewTransport'

export type PreviewRequest = { id: number; value: string }

export interface PreviewWorkerPort {
  onmessage: ((event: MessageEvent<PreviewResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(request: PreviewRequest): void
  terminate(): void
}

export type PreviewProcessorDependencies = {
  createWorker: () => PreviewWorkerPort | null
  prepare: (value: string) => PreviewMarkdownResult
  cached: (value: string) => PreviewMarkdownResult | null
  cache: (value: string, result: PreviewMarkdownResult) => void
  publish: (result: PreviewMarkdownResult) => void
  onError?: (error: unknown) => void
}

/** One worker per session, one running job and one replaceable pending job. */
export function createPreviewProcessor(deps: PreviewProcessorDependencies) {
  let worker: PreviewWorkerPort | null = null
  let active: PreviewRequest | null = null
  let pending: PreviewRequest | null = null
  let sequence = 0
  let published = 0
  let disposed = false
  let workerFailed = false
  const decode = createPreviewDecoder()

  const publish = (id: number, result: PreviewMarkdownResult) => {
    // Accept progress during continuous input, but never regress after a newer result.
    if (disposed || id <= published) return
    published = id
    deps.publish(result)
  }
  const fallback = (task: PreviewRequest) => {
    try { publish(task.id, deps.prepare(task.value)) } catch (error) { deps.onError?.(error) }
  }
  const stopWorker = () => {
    if (worker) {
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
    }
    worker = null
  }
  const fail = (error: unknown) => {
    if (disposed) return
    workerFailed = true
    stopWorker()
    const latest = pending ?? active
    pending = active = null
    deps.onError?.(error)
    if (latest && latest.id > published) fallback(latest)
  }
  const send = (task: PreviewRequest) => {
    active = task
    try { worker!.postMessage(task) } catch (error) { fail(error) }
  }
  const getWorker = () => {
    if (worker || workerFailed) return worker
    try {
      worker = deps.createWorker()
      if (!worker) { workerFailed = true; return null }
      worker.onmessage = event => {
        if (disposed || !active || event.data.id !== active.id) return
        let result: PreviewMarkdownResult
        try { result = decode(event.data) } catch (error) { fail(error); return }
        const completed = active
        active = null
        // Start the newest work before publishing triggers main-thread rendering.
        const next = pending
        pending = null
        if (next) send(next)
        deps.cache(completed.value, result)
        publish(completed.id, result)
      }
      worker.onerror = fail
    } catch (error) { fail(error) }
    return worker
  }

  return {
    request(value: string, useWorker: boolean) {
      if (disposed) return
      const task = { id: ++sequence, value }
      const cached = deps.cached(value)
      if (cached) {
        pending = null
        publish(task.id, cached)
        // Warm the worker and its transport base while the cached preview is
        // already visible, so the first edit does not pay worker startup costs.
        if (useWorker && !worker && !workerFailed && getWorker()) send(task)
      } else if (!useWorker || !getWorker()) {
        pending = null
        fallback(task)
      } else if (active) {
        pending = task
      } else {
        send(task)
      }
    },
    dispose() {
      disposed = true
      active = pending = null
      stopWorker()
    },
  }
}
