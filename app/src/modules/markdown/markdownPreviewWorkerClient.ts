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
  cancellable: boolean
  cancelled: boolean
  resolve: (result: PreviewMarkdownResult) => void
  reject: (error: unknown) => void
}

type PreviewWorkerTaskEntry = {
  task: PreviewWorkerTask
  promise: Promise<PreviewMarkdownResult>
}

let worker: Worker | null = null
let activeTask: PreviewWorkerTask | null = null
let nextTaskId = 0
const taskQueue: PreviewWorkerTask[] = []
const tasksByValue = new Map<string, PreviewWorkerTaskEntry>()

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
    task.resolve(result)
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
  task.cancelled = true
  const entry = tasksByValue.get(task.value)
  if (entry?.task === task) tasksByValue.delete(task.value)
  task.reject(createAbortError())
}

function pumpQueue(): void {
  if (activeTask || taskQueue.length === 0) return

  while (taskQueue.length > 0) {
    const nextTask = taskQueue.shift()!
    if (nextTask.cancelled) {
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
  if (existingTask) {
    // 可视区域调用方不传 signal，接管共享任务，防止预加载清理时取消它。
    if (!options.signal) existingTask.task.cancellable = false
    return existingTask.promise
  }

  const taskPromise = new Promise<PreviewMarkdownResult>((resolve, reject) => {
    const task: PreviewWorkerTask = {
      id: nextTaskId++,
      value,
      cancellable: Boolean(options.signal),
      cancelled: false,
      resolve,
      reject,
    }
    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        if (!task.cancellable) return
        if (activeTask === task) {
          // 当前任务已经发给 Worker，继续完成并写入共享缓存。
          task.cancellable = false
          return
        }
        removeQueuedTask(task)
      }, { once: true })
    }
    taskQueue.push(task)
    pumpQueue()
  })
  const entry: PreviewWorkerTaskEntry = {
    task: taskQueue.find((task) => task.value === value) ?? activeTask!,
    promise: taskPromise,
  }
  tasksByValue.set(value, entry)
  void taskPromise.finally(() => {
    if (tasksByValue.get(value) === entry) tasksByValue.delete(value)
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
