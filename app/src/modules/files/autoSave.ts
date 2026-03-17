import { filesConfig } from '../../config/files'
import type { Result, WriteResult, ServiceError } from './types'

export type AutoSaveCallbacks = {
  save: () => Promise<Result<WriteResult>>
  isDirty: () => boolean
  onStart?: () => void
  onSuccess?: (result: WriteResult) => void
  onConflict?: (error: ServiceError) => void
  onError?: (error: ServiceError) => void
}

export type AutoSaveHandle = {
  schedule: () => void
  flush: () => Promise<void>
  cancel: () => void
}

export function createAutoSaver(
  options: AutoSaveCallbacks & { debounceMs?: number; idleMs?: number; enabled?: boolean; forceIntervalMs?: number },
): AutoSaveHandle {
  const debounceMs = options.debounceMs ?? filesConfig.autoSave.debounceMs
  const idleMs = options.idleMs ?? filesConfig.autoSave.idleMs
  const enabled = options.enabled ?? filesConfig.autoSave.enabled
  const forceIntervalMs = options.forceIntervalMs

  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let intervalTimer: ReturnType<typeof setInterval> | null = null
  let running = false
  let cancelled = false

  const clearTimers = () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    if (idleTimer) clearTimeout(idleTimer)
    if (intervalTimer) clearInterval(intervalTimer)
    debounceTimer = null
    idleTimer = null
    intervalTimer = null
  }

  const doSave = async () => {
    if (!enabled || cancelled) return
    if (!options.isDirty() || running) return
    running = true
    options.onStart?.()
    try {
      const resp = await options.save()
      if (resp.ok) {
        options.onSuccess?.(resp.data)
      } else if (resp.error.code === 'CONFLICT') {
        options.onConflict?.(resp.error)
      } else {
        options.onError?.(resp.error)
      }
    } finally {
      running = false
    }
  }

  const schedule = () => {
    if (!enabled || cancelled) return
    clearTimers()
    debounceTimer = setTimeout(() => {
      void doSave()
    }, debounceMs)
    idleTimer = setTimeout(() => {
      void doSave()
    }, idleMs)
  }

  // 强制间隔保存：不依赖外部调用 schedule，每隔指定时间尝试保存一次
  if (forceIntervalMs && enabled && !cancelled) {
    intervalTimer = setInterval(() => {
      void doSave()
    }, forceIntervalMs)
  }

  const flush = async () => {
    clearTimers()
    await doSave()
  }

  const cancel = () => {
    cancelled = true
    clearTimers()
  }

  return { schedule, flush, cancel }
}
