export interface PreviewFrameClock {
  request(callback: () => void): number
  cancel(handle: number): void
}

export interface PreviewScheduler {
  schedule(task: () => void): void
  cancel(): void
}

const browserFrames: PreviewFrameClock = {
  request: callback => requestAnimationFrame(callback),
  cancel: handle => cancelAnimationFrame(handle),
}

/** Deliver the latest edit on the next frame, without a typing/size-based delay. */
export function createPreviewScheduler(clock: PreviewFrameClock = browserFrames): PreviewScheduler {
  let frame: number | null = null
  let pending: (() => void) | null = null
  return {
    schedule(task) {
      pending = task
      // More input replaces the payload, never postpones the already requested frame.
      if (frame !== null) return
      frame = clock.request(() => {
        frame = null
        const current = pending
        pending = null
        current?.()
      })
    },
    cancel() {
      if (frame !== null) clock.cancel(frame)
      frame = null
      pending = null
    },
  }
}
