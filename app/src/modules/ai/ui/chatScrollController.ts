import { chatScrollDebug } from './chatScrollDebug'
import { ChatAutoFollowPolicy, type ChatAutoFollowPolicyPort, type ChatFollowState } from './chatAutoFollowPolicy'

/** One scroll writer and follow state per chat viewport. */
export class ChatScrollController {
  private autoFollowPolicy: ChatAutoFollowPolicyPort
  private frame: number | null = null
  private lastTop: number
  private interactionVersion = 0
  private touchY: number | null = null
  private resumeOnScroll = false
  private container: HTMLElement
  constructor(container: HTMLElement, autoFollowPolicy: ChatAutoFollowPolicyPort = new ChatAutoFollowPolicy()) {
    this.container = container
    this.lastTop = container.scrollTop
    this.autoFollowPolicy = autoFollowPolicy
  }
  get follow() { return this.autoFollowPolicy.state }
  pause = () => {
    chatScrollDebug('follow paused', this.container)
    this.autoFollowPolicy.pause()
    this.cancel()
  }
  beginNewTurn = () => {
    this.cancel()
    this.resumeOnScroll = false
    this.autoFollowPolicy.beginNewTurn()
    chatScrollDebug('new turn follow started', this.container)
    this.scheduleBottom()
  }
  cancel = () => {
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.frame = null
  }
  get userInteractionVersion() { return this.interactionVersion }
  private pauseForUser = () => {
    this.resumeOnScroll = false
    this.interactionVersion += 1
    chatScrollDebug('user input paused follow', this.container, { interactionVersion: this.interactionVersion })
    this.pause()
  }
  write(top: number, source = 'unspecified') {
    this.resumeOnScroll = false
    const before = this.container.scrollTop
    this.container.scrollTop = top
    this.lastTop = this.container.scrollTop
    chatScrollDebug('scrollTop write', this.container, { source, requestedTop: Math.round(top * 10) / 10, before: Math.round(before * 10) / 10, after: Math.round(this.container.scrollTop * 10) / 10 })
  }
  scheduleBottom = () => {
    if (!this.follow.current || this.frame !== null) return
    this.frame = requestAnimationFrame(() => {
      this.frame = null
      if (this.follow.current) this.write(this.container.scrollHeight, 'ChatScrollController.scheduleBottom')
    })
  }
  attach(follow: { current: boolean }) {
    this.autoFollowPolicy.bind(follow as ChatFollowState)
    const el = this.container
    const scroll = () => {
      const delta = el.scrollTop - this.lastTop
      const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      chatScrollDebug('scroll event', el, { delta: Math.round(delta * 10) / 10, distanceToBottom: Math.round(distanceToBottom * 10) / 10, follow: this.follow.current })
      this.autoFollowPolicy.onScroll(delta, distanceToBottom, this.resumeOnScroll)
      if (this.follow.current) this.resumeOnScroll = false
      this.lastTop = el.scrollTop
    }
    const wheel = (event: WheelEvent) => {
      chatScrollDebug('wheel input', el, { deltaY: Math.round(event.deltaY * 10) / 10, deltaX: Math.round(event.deltaX * 10) / 10, deltaMode: event.deltaMode, follow: this.follow.current })
      this.autoFollowPolicy.onWheel(event.deltaY)
      if (event.deltaY < 0) this.pauseForUser()
      else if (event.deltaY > 0) this.resumeOnScroll = true
    }
    const pointerDown = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      if (event.clientX >= rect.right - 24) {
        this.pauseForUser()
        this.resumeOnScroll = true
      }
    }
    const touchStart = (event: TouchEvent) => { this.touchY = event.touches[0]?.clientY ?? null }
    const touchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY
      if (y === undefined) return
      if (this.touchY !== null && y > this.touchY) this.pauseForUser()
      else if (this.touchY !== null && y < this.touchY) this.resumeOnScroll = true
      this.touchY = y
    }
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return
      if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)) this.pauseForUser()
      else if (['ArrowDown', 'PageDown', 'End'].includes(event.key) || event.key === ' ') this.resumeOnScroll = true
    }
    el.addEventListener('scroll', scroll, { passive: true })
    el.addEventListener('wheel', wheel, { passive: true })
    el.addEventListener('pointerdown', pointerDown, { passive: true })
    el.addEventListener('touchstart', touchStart, { passive: true })
    el.addEventListener('touchmove', touchMove, { passive: true })
    el.addEventListener('keydown', key)
    return () => {
      this.cancel()
      el.removeEventListener('scroll', scroll)
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('pointerdown', pointerDown)
      el.removeEventListener('touchstart', touchStart)
      el.removeEventListener('touchmove', touchMove)
      el.removeEventListener('keydown', key)
    }
  }
}
const controllers = new WeakMap<HTMLElement, ChatScrollController>()
export function chatScrollController(container: HTMLElement) {
  let controller = controllers.get(container)
  if (!controller) { controller = new ChatScrollController(container); controllers.set(container, controller) }
  return controller
}
