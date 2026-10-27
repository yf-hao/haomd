/** Timing policy is independent of the editor, React and the work being scheduled. */
export type RefreshPolicy = Readonly<{
  minIntervalMs: number
  trailingDelayMs: number
  maxWaitMs: number
}>

export interface SchedulerClock {
  now(): number
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>
  clearTimeout(handle: ReturnType<typeof setTimeout>): void
}

export interface LatestTaskScheduler {
  schedule(task: () => void, policy: RefreshPolicy): void
  flush(): void
  cancel(): void
}

const systemClock: SchedulerClock = {
  now: () => performance.now(),
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: handle => clearTimeout(handle),
}

/** One pending task, trailing delivery and bounded waiting during continuous input. */
export function createLatestTaskScheduler(clock: SchedulerClock = systemClock): LatestTaskScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: (() => void) | null = null
  let firstQueuedAt = 0
  let lastRunAt = -Infinity

  const cancel = () => {
    if (timer !== null) clock.clearTimeout(timer)
    timer = null
    pending = null
  }
  const flush = () => {
    const task = pending
    cancel()
    if (!task) return
    lastRunAt = clock.now()
    task()
  }
  return {
    schedule(task, policy) {
      const now = clock.now()
      if (!pending) firstQueuedAt = now
      pending = task
      if (timer !== null) clock.clearTimeout(timer)
      const due = Math.max(lastRunAt + policy.minIntervalMs,
        Math.min(now + policy.trailingDelayMs, firstQueuedAt + policy.maxWaitMs))
      timer = clock.setTimeout(flush, Math.max(0, due - now))
    },
    flush,
    cancel,
  }
}
