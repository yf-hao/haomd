import {
  cachePreviewMarkdown,
  getCachedPreviewMarkdown,
  preparePreviewMarkdown,
  type PreviewMarkdownResult,
} from './previewPipeline'

const CHAT_PREVIEW_WORKER_MIN_CHARS = 2_000

type PreviewWorkerRequest = {
  id: number
  value: string
}

type PreviewWorkerTask = {
  id: number
  value: string
  signal?: AbortSignal
  resolve: (result: PreviewMarkdownResult) => void
  reject: (error: unknown) => void
}

let worker: Worker | null = null
let activeTask: PreviewWorkerTask | null = null
let nextTaskId = 0
const taskQueue: PreviewWorkerTask[] = []
const tasksByValue = new Map<string, Promise<PreviewMarkdownResult>>()

function createAbortError(): Error {
  const error = new Error('Markdown preview task was cancelled')
  error.name = 'AbortError'
  return error
}

function getWorker(): Worker | null {
  if (worker || typeof Worker === 'undefined') return worker

  const nextWorker = new Worker(
    new URL('../../workers/markdownPreview.worker.ts', import.meta.url),
    { type: 'module' },
  )
  nextWorker.onmessage = (event: MessageEvent<PreviewMarkdownResult & { id: number }>) => {
    const task = activeTask
    if (!task || event.data.id !== task.id) return

    activeTask = null
    const result: PreviewMarkdownResult = {
      processedMarkdown: event.data.processedMarkdown,
      hasMath: event.data.hasMath,
      hasRawHtml: event.data.hasRawHtml,
      containsToc: event.data.containsToc,
      sourceLineOffset: event.data.sourceLineOffset,
      lineCount: event.data.lineCount,
      blockChunks: event.data.blockChunks,
    }
    cachePreviewMarkdown(task.value, result)
    if (task.signal?.aborted) {
      task.reject(createAbortError())
    } else {
      task.resolve(result)
    }
    pumpQueue()
  }
  nextWorker.onerror = (event) => {
    const error = event.error ?? new Error('Markdown preview worker failed')
    const task = activeTask
    activeTask = null
    worker?.terminate()
    worker = null
    task?.reject(error)
    pumpQueue()
  }
  worker = nextWorker
  return worker
}

function removeQueuedTask(task: PreviewWorkerTask): void {
  const index = taskQueue.indexOf(task)
  if (index < 0) return
  taskQueue.splice(index, 1)
  task.reject(createAbortError())
}

function pumpQueue(): void {
  if (activeTask || taskQueue.length === 0) return

  while (taskQueue.length > 0) {
    const nextTask = taskQueue.shift()!
    if (nextTask.signal?.aborted) {
      nextTask.reject(createAbortError())
      continue
    }
    activeTask = nextTask
    const nextWorker = getWorker()
    if (!nextWorker) {
      activeTask = null
      nextTask.resolve(preparePreviewMarkdown(nextTask.value))
      continue
    }
    nextWorker.postMessage({ id: nextTask.id, value: nextTask.value } satisfies PreviewWorkerRequest)
    return
  }
}

export function preparePreviewMarkdownInWorker(
  value: string,
  options: { signal?: AbortSignal } = {},
): Promise<PreviewMarkdownResult> {
  const cached = getCachedPreviewMarkdown(value)
  if (cached) return Promise.resolve(cached)
  if (options.signal?.aborted) return Promise.reject(createAbortError())
  if (value.length < CHAT_PREVIEW_WORKER_MIN_CHARS || typeof Worker === 'undefined') {
    return Promise.resolve(preparePreviewMarkdown(value))
  }

  const existingTask = tasksByValue.get(value)
  if (existingTask) return existingTask

  const taskPromise = new Promise<PreviewMarkdownResult>((resolve, reject) => {
    const task: PreviewWorkerTask = {
      id: nextTaskId++,
      value,
      signal: options.signal,
      resolve,
      reject,
    }
    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        if (activeTask === task) return
        removeQueuedTask(task)
      }, { once: true })
    }
    taskQueue.push(task)
    pumpQueue()
  })
  tasksByValue.set(value, taskPromise)
  void taskPromise.finally(() => {
    if (tasksByValue.get(value) === taskPromise) tasksByValue.delete(value)
  }).catch(() => undefined)
  return taskPromise
}

export function prefetchMarkdownPreviews(
  values: readonly string[],
  options: { signal?: AbortSignal } = {},
): void {
  const uniqueValues = new Set(values)
  for (const value of uniqueValues) {
    void preparePreviewMarkdownInWorker(value, options).catch(() => undefined)
  }
}
