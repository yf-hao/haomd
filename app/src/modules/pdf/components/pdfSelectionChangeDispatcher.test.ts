import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerPdfSelectionChangeHandler } from './pdfSelectionChangeDispatcher'

describe('pdfSelectionChangeDispatcher', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('attaches only one document selectionchange listener for all handlers', () => {
    const addSpy = vi.spyOn(document, 'addEventListener')
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const root = document.createElement('div')
    const first = vi.fn()
    const second = vi.fn()

    const unregisterFirst = registerPdfSelectionChangeHandler(root, first)
    const unregisterSecond = registerPdfSelectionChangeHandler(root, second)

    expect(addSpy).toHaveBeenCalledTimes(1)
    expect(addSpy).toHaveBeenCalledWith('selectionchange', expect.any(Function))

    document.dispatchEvent(new Event('selectionchange'))
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)

    unregisterFirst()
    unregisterSecond()

    expect(removeSpy).toHaveBeenCalledTimes(1)
    expect(removeSpy).toHaveBeenCalledWith('selectionchange', expect.any(Function))
  })

  it('skips dispatching when focus is in an editable element outside every registered pdf root', () => {
    const root = document.createElement('div')
    const first = vi.fn()
    const unregister = registerPdfSelectionChangeHandler(root, first)
    const textarea = document.createElement('textarea')
    document.body.append(textarea)
    textarea.focus()

    document.dispatchEvent(new Event('selectionchange'))

    expect(first).not.toHaveBeenCalled()

    unregister()
    textarea.remove()
  })
})
