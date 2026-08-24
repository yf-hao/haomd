import { describe, expect, it, vi } from 'vitest'
import { createPreviewStore } from './usePreviewStore'

describe('createPreviewStore', () => {
  it('notifies subscribers only when the preview value changes', () => {
    const store = createPreviewStore('initial')
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    store.set('initial')
    expect(listener).not.toHaveBeenCalled()

    store.set('updated')
    expect(store.getSnapshot()).toBe('updated')
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    store.set('final')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
