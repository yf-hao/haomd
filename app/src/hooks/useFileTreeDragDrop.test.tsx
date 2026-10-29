import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useFileTreeDragDrop } from './useFileTreeDragDrop'

let hit: Element | null
const capture = vi.fn()
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId = 1
  })
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => hit })
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: capture })
  capture.mockClear()
  hit = null
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

function fixture() {
  const move = vi.fn().mockResolvedValue(undefined)
  const open = vi.fn()
  const expand = vi.fn()
  function Tree() {
    const handlers = useFileTreeDragDrop({ disabled: false, move, expand, expanded: {} })
    return <aside {...handlers}>
      <div data-file-source="/old/note.md" onClick={open}>note</div>
      <div data-file-directory="/old">old</div>
      <div data-file-directory="/new"><span>new</span></div>
      <div>virtual group</div>
    </aside>
  }
  render(<Tree />)
  return { move, open, expand, source: screen.getByText('note'), target: screen.getByText('new') }
}

it('keeps normal clicks below the threshold and captures only when dragging', () => {
  const { source, open, move } = fixture()
  fireEvent.pointerDown(source, { button: 0, clientX: 10, clientY: 10 })
  fireEvent.pointerMove(window, { clientX: 12, clientY: 12 })
  fireEvent.pointerUp(source, { clientX: 12, clientY: 12 })
  fireEvent.click(source)
  expect(open).toHaveBeenCalledOnce()
  expect(capture).not.toHaveBeenCalled()
  expect(move).not.toHaveBeenCalled()
})

it('highlights, expands and moves once to a real directory without opening the file', async () => {
  const { source, target, move, expand, open } = fixture()
  hit = target
  fireEvent.pointerDown(source, { button: 0, clientX: 10, clientY: 10 })
  fireEvent.pointerMove(window, { clientX: 40, clientY: 40 })
  expect(target.parentElement?.classList.contains('file-drop-target')).toBe(true)
  act(() => vi.advanceTimersByTime(600))
  expect(expand).toHaveBeenCalledExactlyOnceWith('/new')
  await act(async () => { fireEvent.pointerUp(window, { clientX: 40, clientY: 40 }) })
  fireEvent.click(source)
  expect(open).not.toHaveBeenCalled()
  expect(move).toHaveBeenCalledExactlyOnceWith('/old/note.md', '/new')
  expect(document.querySelector('.file-drag-ghost')).toBeNull()
})

it.each(['old', 'virtual group'])('rejects an invalid target: %s', target => {
  const { source, move } = fixture()
  hit = screen.getByText(target)
  fireEvent.pointerDown(source, { button: 0 })
  fireEvent.pointerMove(window, { clientX: 20, clientY: 20 })
  fireEvent.pointerUp(window, { clientX: 20, clientY: 20 })
  expect(move).not.toHaveBeenCalled()
})

it.each(['Escape', 'pointercancel', 'lostpointercapture', 'blur'])('cancels cleanly on %s', reason => {
  const { source, target, move, expand } = fixture()
  hit = target
  fireEvent.pointerDown(source, { button: 0 })
  fireEvent.pointerMove(window, { clientX: 20, clientY: 20 })
  if (reason === 'Escape') fireEvent.keyDown(window, { key: 'Escape' })
  else if (reason === 'blur') fireEvent.blur(window)
  else window.dispatchEvent(new PointerEvent(reason))
  fireEvent.pointerUp(window, { clientX: 20, clientY: 20 })
  act(() => vi.advanceTimersByTime(1000))
  expect(move).not.toHaveBeenCalled()
  expect(expand).not.toHaveBeenCalled()
  expect(document.querySelector('.file-drag-ghost')).toBeNull()
})
