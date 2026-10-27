import { describe, expect, it, vi } from 'vitest'
import { createPreviewScheduler } from './previewScheduler'

function fixture() {
  const callbacks = new Map<number, () => void>()
  let sequence = 0
  const clock = {
    request: vi.fn((callback: () => void) => { callbacks.set(++sequence, callback); return sequence }),
    cancel: vi.fn((id: number) => { callbacks.delete(id) }),
  }
  return { clock, scheduler: createPreviewScheduler(clock), frame() {
    const batch = [...callbacks.values()]
    callbacks.clear()
    batch.forEach(callback => callback())
  } }
}

describe('live preview scheduler', () => {
  it('delivers the newest input on the already scheduled frame without postponement', () => {
    const { scheduler, clock, frame } = fixture()
    const obsolete = vi.fn()
    const latest = vi.fn()
    scheduler.schedule(obsolete)
    scheduler.schedule(latest)
    expect(clock.request).toHaveBeenCalledOnce()
    expect(clock.cancel).not.toHaveBeenCalled()
    frame()
    expect(obsolete).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledOnce()
  })

  it('keeps updating on every frame throughout continuous input', () => {
    const { scheduler, frame } = fixture()
    const delivered: number[] = []
    for (let index = 0; index < 30; index++) {
      scheduler.schedule(() => delivered.push(index))
      frame()
    }
    expect(delivered).toEqual(Array.from({ length: 30 }, (_, index) => index))
  })

  it('discards work when hidden or switched and can resume immediately', () => {
    const { scheduler, frame } = fixture()
    const old = vi.fn()
    const next = vi.fn()
    scheduler.schedule(old)
    scheduler.cancel()
    frame()
    scheduler.schedule(next)
    frame()
    expect(old).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledOnce()
  })
})
