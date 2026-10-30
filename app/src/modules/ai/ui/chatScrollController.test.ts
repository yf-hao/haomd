import { afterEach, expect, it, vi } from 'vitest'
import { ChatScrollController } from './chatScrollController'
afterEach(() => vi.unstubAllGlobals())
function fixture() {
  const frames = new Map<number, FrameRequestCallback>()
  let sequence = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  const el = document.createElement('div')
  Object.defineProperties(el, { scrollHeight: { value: 1000 }, clientHeight: { value: 200 } })
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
