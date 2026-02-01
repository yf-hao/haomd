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

export function createAutoSaver(options: AutoSaveCallbacks & { debounceMs?: number; idleMs?: number; enabled?: boolean }): AutoSaveHandle {
  const debounceMs = options.debounceMs ?? filesConfig.autoSave.debounceMs
  const idleMs = options.idleMs ?? filesConfig.autoSave.idleMs
  const enabled = options.enabled ?? filesConfig.autoSave.enabled

  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let running = false
  let cancelled = false

  const clearTimers = () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    if (idleTimer) clearTimeout(idleTimer)
    debounceTimer = null
    idleTimer = null
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
