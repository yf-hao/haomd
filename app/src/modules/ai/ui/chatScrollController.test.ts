import { afterEach, expect, it, vi } from 'vitest'
import { ChatScrollController } from './chatScrollController'
afterEach(() => vi.unstubAllGlobals())
function fixture() {
  const frames = new Map<number, FrameRequestCallback>()
  let sequence = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  const el = document.createElement('div')
  let top = 0
  Object.defineProperties(el, {
    scrollHeight: { value: 1000, writable: true },
    clientHeight: { value: 200 },
    scrollTop: {
      get: () => top,
      set: (value: number) => { top = Math.max(0, Math.min(value, el.scrollHeight - el.clientHeight)) },
    },
  })
  el.scrollTop = 800
  const controller = new ChatScrollController(el)
  const follow = { current: true }
  const detach = controller.attach(follow)
  const flush = () => { for (const callback of frames.values()) callback(0); frames.clear() }
  return { el, controller, follow, detach, flush, frames }
}
it('cancels queued bottom-follow as soon as upward input arrives', () => {
  const f = fixture()
  f.controller.scheduleBottom()
  f.el.dispatchEvent(new WheelEvent('wheel', { deltaY: -30 }))
  expect(f.frames.size).toBe(0)
  f.flush()
  expect(f.el.scrollTop).toBe(800)
  expect(f.follow.current).toBe(false)
  f.detach()
})
it('does not resume following after a programmatic anchor correction near the bottom', () => {
  const f = fixture()
  f.controller.pause()
  f.controller.write(800)
  f.el.dispatchEvent(new Event('scroll'))
  expect(f.follow.current).toBe(false)
  f.el.scrollTop = 700
  f.el.dispatchEvent(new Event('scroll'))
  f.el.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }))
  f.el.scrollTop = 800
  f.el.dispatchEvent(new Event('scroll'))
  expect(f.follow.current).toBe(true)
  f.detach()
})
it('coalesces follow requests and cancels work when detached', () => {
  const f = fixture()
  f.controller.scheduleBottom()
  f.controller.scheduleBottom()
  expect(f.frames.size).toBe(1)
  f.detach()
  expect(f.frames.size).toBe(0)
})

it('resumes a new turn from history and keeps following after content grows', () => {
  const f = fixture()
  f.el.dispatchEvent(new WheelEvent('wheel', { deltaY: -400 }))
  f.el.scrollTop = 400
  f.el.dispatchEvent(new Event('scroll'))
  f.controller.beginNewTurn()
  f.flush()
  expect(f.el.scrollTop).toBe(800)
  expect(f.follow.current).toBe(true)
  Object.defineProperty(f.el, 'scrollHeight', { value: 1100 })
  f.controller.scheduleBottom()
  f.flush()
  expect(f.el.scrollTop).toBe(900)
  f.detach()
})

it.each([3, 600])('does not mistake a %ipx layout shrink for upward user input', shrink => {
  const f = fixture()
  f.controller.beginNewTurn()
  const version = f.controller.userInteractionVersion
  Object.defineProperty(f.el, 'scrollHeight', { value: 1000 - shrink })
  f.el.scrollTop = 800 - shrink
  f.el.dispatchEvent(new Event('scroll'))
  expect(f.follow.current).toBe(true)
  expect(f.controller.userInteractionVersion).toBe(version)
  expect(f.frames.size).toBe(1)
  f.flush()
  Object.defineProperty(f.el, 'scrollHeight', { value: 1200 })
  f.controller.scheduleBottom()
  f.flush()
  expect(f.el.scrollTop).toBe(1000)
  f.detach()
})

it('does not resume a paused reader when layout alone moves the viewport to the bottom', () => {
  const f = fixture()
  f.el.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }))
  f.el.scrollTop = 700
  f.el.dispatchEvent(new Event('scroll'))
  f.el.scrollTop = 800
  f.el.dispatchEvent(new Event('scroll'))
  expect(f.follow.current).toBe(false)
  f.detach()
})

it('clears downward intent on programmatic anchor writes', () => {
  const f = fixture()
  f.controller.pause()
  f.el.dispatchEvent(new WheelEvent('wheel', { deltaY: 10 }))
  f.controller.write(700, 'anchor correction')
  f.el.scrollTop = 800
  f.el.dispatchEvent(new Event('scroll'))
  expect(f.follow.current).toBe(false)
  f.detach()
})

it('allows explicit upward input to interrupt following again after sending', () => {
  const f = fixture()
  f.controller.pause()
  f.controller.beginNewTurn()
  f.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp' }))
  expect(f.follow.current).toBe(false)
  expect(f.frames.size).toBe(0)
  f.controller.beginNewTurn()
  f.el.dispatchEvent(new WheelEvent('wheel', { deltaY: -10 }))
  expect(f.follow.current).toBe(false)
  expect(f.frames.size).toBe(0)
  f.detach()
})

it('ignores reading-navigation keys inside the composer', () => {
  const f = fixture()
  const input = document.createElement('textarea')
  f.el.appendChild(input)
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
  expect(f.follow.current).toBe(true)
  f.detach()
})
