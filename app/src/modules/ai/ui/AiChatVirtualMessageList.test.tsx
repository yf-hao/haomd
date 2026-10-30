import { act, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AiChatVirtualMessageList } from './AiChatVirtualMessageList'
import { chatScrollController } from './chatScrollController'
vi.mock('../../markdown/markdownPreviewWorkerClient', () => ({ prefetchMarkdownPreviews: vi.fn() }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
it.each([null, { id: '4', top: 0 }])('keeps the reading offset when a row grows (initial anchor %s)', initialAnchor => {
  const callbacks = new Set<() => void>()
  vi.stubGlobal('ResizeObserver', class {
    callback: () => void
    constructor(callback: () => void) { this.callback = callback; callbacks.add(callback) }
    observe() {}
    disconnect() { callbacks.delete(this.callback) }
  })
  const frames = new Map<number, FrameRequestCallback>()
  let sequence = 0
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.set(++sequence, cb); return sequence })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  const container = document.createElement('div')
  Object.defineProperties(container, { clientHeight: { value: 5000 }, clientWidth: { value: 800 }, scrollHeight: { value: 10000 } })
  container.scrollTop = 400
  const detach = chatScrollController(container).attach({ current: false })
  let firstHeight = 100
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const id = this.getAttribute('data-ai-message-id')
    const index = id === null ? -1 : Number(id)
    const height = index === 0 ? firstHeight : index >= 0 ? 100 : 5000
    const top = this === container ? 0 : index < 0 ? -container.scrollTop : (index === 0 ? 0 : firstHeight + (index - 1) * 100) - container.scrollTop
    return { top, bottom: top + height, height, width: 800, left: 0, right: 800, x: 0, y: top, toJSON() {} }
  })
  const view = render(<AiChatVirtualMessageList initialAnchor={initialAnchor}
    messages={Array.from({ length: 13 }, (_, index) => ({ id: String(index), role: 'user' as const, content: 'note' }))}
    containerRef={{ current: container }} renderMessage={message => <div>{message.content}</div>}
  />)
  if (initialAnchor) expect(container.scrollTop).toBe(400)
  // Start reading after the initial estimates have been replaced by measured heights.
  act(() => {
    chatScrollController(container).write(400)
    container.dispatchEvent(new Event('scroll'))
    const pending = [...frames.values()]; frames.clear()
    for (const callback of pending) callback(0)
  })
  expect(container.scrollTop).toBe(400)
  act(() => { firstHeight = 200; for (const cb of callbacks) cb() })
  act(() => { const pending = [...frames.values()]; frames.clear(); for (const cb of pending) cb(0) })
  expect(container.scrollTop).toBe(500)
  expect(chatScrollController(container).follow.current).toBe(false)
  view.unmount()
  detach()
})
