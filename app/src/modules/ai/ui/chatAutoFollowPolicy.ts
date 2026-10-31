export type ChatFollowState = { current: boolean }

export interface ChatAutoFollowPolicyPort {
  readonly state: ChatFollowState
  bind(state: ChatFollowState): void
  beginNewTurn(): void
  pause(): void
  onScroll(delta: number, distanceToBottom: number, userScrollingDown: boolean): void
  onWheel(deltaY: number): void
}

/** Owns the decision to follow new content or respect the reader's position. */
export class ChatAutoFollowPolicy implements ChatAutoFollowPolicyPort {
  state: ChatFollowState = { current: true }

  bind(state: ChatFollowState) {
    this.state = state
  }

  beginNewTurn() {
    this.state.current = true
  }

  pause() {
    this.state.current = false
  }

  onScroll(delta: number, distanceToBottom: number, userScrollingDown: boolean) {
    // Layout changes can reduce scrollTop even while the reader stays at the bottom.
    // Only explicit input pauses following; scroll events alone do not show intent.
    // WebKit can report scrollTop beyond the bottom during elastic overscroll.
    // Only resume following when the viewport is genuinely at the bottom.
    if (userScrollingDown && delta > 0.5 && distanceToBottom >= -2 && distanceToBottom <= 2) {
      this.state.current = true
    }
  }

  onWheel(deltaY: number) {
    if (deltaY < 0) this.pause()
  }
}
