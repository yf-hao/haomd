import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLatestTaskScheduler } from './taskScheduler'

const policy = { minIntervalMs: 80, trailingDelayMs: 80, maxWaitMs: 200 }
afterEach(() => vi.useRealTimers())

describe('latest task scheduler', () => {
  it('coalesces input without evaluating superseded snapshots', () => {
    vi.useFakeTimers()
    const scheduler = createLatestTaskScheduler()
    const first = vi.fn()
    const last = vi.fn()
    scheduler.schedule(first, policy)
    vi.advanceTimersByTime(40)
    scheduler.schedule(last, policy)
    vi.advanceTimersByTime(79)
    expect(last).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(last).toHaveBeenCalledOnce()
    expect(first).not.toHaveBeenCalled()
  })

  it('makes bounded progress during continuous input and delivers the final edit', () => {
    vi.useFakeTimers()
    const scheduler = createLatestTaskScheduler()
    const delivered: number[] = []
    for (let index = 0; index < 13; index++) {
      scheduler.schedule(() => delivered.push(index), policy)
      vi.advanceTimersByTime(40)
    }
    expect(delivered).toEqual([4, 9])
    vi.advanceTimersByTime(80)
    expect(delivered).toEqual([4, 9, 12])
  })

  it('cancels hidden/disposed work and flushes boundary work exactly once', () => {
    vi.useFakeTimers()
    const scheduler = createLatestTaskScheduler()
    const task = vi.fn()
    scheduler.schedule(task, policy)
    scheduler.cancel()
    vi.advanceTimersByTime(500)
    expect(task).not.toHaveBeenCalled()
    scheduler.schedule(task, policy)
    scheduler.flush()
    scheduler.flush()
    vi.advanceTimersByTime(500)
    expect(task).toHaveBeenCalledOnce()
  })
})
