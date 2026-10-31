import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react'

export function useFileTreeDragDrop(options: {
  disabled: boolean
  expanded: Record<string, boolean>
  expand: (path: string) => void
  move?: (source: string, directory: string) => Promise<void>
  onError?: (message: string) => void
}) {
  const latest = useRef(options)
  useEffect(() => {
    latest.current = options
  }, [options])
  const busy = useRef(false)
  const suppressClick = useRef(false)
  const drag = useRef<{
    source: string; root: HTMLElement; pointer: number; x: number; y: number; startX: number; startY: number
    ghost: HTMLDivElement | null; target: HTMLElement | null; timer: ReturnType<typeof setTimeout> | null; frame: number | null
  } | null>(null)

  useEffect(() => {
    const cleanup = () => {
      const current = drag.current
      if (!current) return
      drag.current = null
      current.ghost?.remove()
      current.target?.classList.remove('file-drop-target')
      current.root.classList.remove('file-drag-active')
      if (current.timer) clearTimeout(current.timer)
      if (current.frame !== null) cancelAnimationFrame(current.frame)
      if (current.root.hasPointerCapture?.(current.pointer)) current.root.releasePointerCapture(current.pointer)
    }
    const paint = () => {
      const current = drag.current
      if (!current?.ghost) return
      current.ghost.style.transform = `translate(${current.x + 14}px, ${current.y + 12}px)`
      const hit = document.elementFromPoint(current.x, current.y)?.closest<HTMLElement>('[data-file-directory]') ?? null
      const parent = current.source.replace(/\\/g, '/').replace(/\/[^/]+$/, '')
      const valid = hit && current.root.contains(hit) && hit.dataset.fileDirectory?.replace(/\\/g, '/') !== parent ? hit : null
      if (valid !== current.target) {
        current.target?.classList.remove('file-drop-target')
        if (current.timer) clearTimeout(current.timer)
        current.target = valid
        valid?.classList.add('file-drop-target')
        const path = valid?.dataset.fileDirectory
        if (path && !latest.current.expanded[path]) current.timer = setTimeout(() => {
          if (drag.current?.target === valid && !latest.current.expanded[path]) latest.current.expand(path)
        }, 600)
      }
      current.ghost.classList.toggle('file-drag-invalid', !valid)
      const scroller = current.root.querySelector<HTMLElement>('.sidebar-body')
      if (scroller) {
        const box = scroller.getBoundingClientRect()
        if (current.x >= box.left && current.x <= box.right) {
          if (current.y < box.top + 28 && current.y >= box.top) scroller.scrollTop -= 9
          else if (current.y > box.bottom - 28 && current.y <= box.bottom) scroller.scrollTop += 9
        }
      }
      current.frame = requestAnimationFrame(paint)
    }
    const move = (event: PointerEvent) => {
      const current = drag.current
      if (!current || event.pointerId !== current.pointer) return
      current.x = event.clientX; current.y = event.clientY
      if (!current.ghost && Math.hypot(current.x - current.startX, current.y - current.startY) >= 6) {
        current.root.setPointerCapture?.(current.pointer)
        current.ghost = document.createElement('div')
        current.ghost.className = 'file-drag-ghost'
        current.ghost.textContent = current.source.split(/[/\\]/).pop() ?? ''
        document.body.appendChild(current.ghost)
        current.root.classList.add('file-drag-active')
        suppressClick.current = true
        paint()
      }
      if (current.ghost) event.preventDefault()
    }
    const up = (event: PointerEvent) => {
      const current = drag.current
      if (!current || event.pointerId !== current.pointer) return
      // Refresh hit testing at release; the last animation frame may be older.
      current.x = event.clientX; current.y = event.clientY
      if (current.ghost) {
        if (current.frame !== null) cancelAnimationFrame(current.frame)
        paint()
      }
      const destination = current.ghost ? current.target?.dataset.fileDirectory : null
      cleanup()
      if (destination && latest.current.move) {
        busy.current = true
        void latest.current.move(current.source, destination).catch(error => latest.current.onError?.(String(error)))
          .finally(() => { busy.current = false })
      }
    }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') cleanup() }
    const lost = (event: PointerEvent) => { if (drag.current?.pointer === event.pointerId) cleanup() }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cleanup)
    window.addEventListener('lostpointercapture', lost)
    window.addEventListener('blur', cleanup)
    window.addEventListener('keydown', key)
    return () => {
      cleanup()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cleanup)
      window.removeEventListener('lostpointercapture', lost)
      window.removeEventListener('blur', cleanup)
      window.removeEventListener('keydown', key)
    }
  }, [])

  return {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      suppressClick.current = false
      if (event.button !== 0 || busy.current || latest.current.disabled || !latest.current.move) return
      if ((event.target as HTMLElement).closest('input, textarea, button')) return
      const source = (event.target as HTMLElement).closest<HTMLElement>('[data-file-source]')?.dataset.fileSource
      if (!source) return
      if (drag.current) return
      drag.current = { source, root: event.currentTarget, pointer: event.pointerId, x: event.clientX, y: event.clientY,
        startX: event.clientX, startY: event.clientY, ghost: null, target: null, timer: null, frame: null }
    },
    onClickCapture: (event: ReactMouseEvent<HTMLElement>) => {
      if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); event.stopPropagation() }
    },
  }
}
