import { useCallback, useEffect, useRef, useState } from 'react'

const MIN_SIDEBAR_WIDTH = 150
const MAX_SIDEBAR_WIDTH = 400

export interface UseSidebarResizeParams {
  activeLeftPanel: string | null
}

export interface UseSidebarResizeReturn {
  sidebarWidth: number
  isSidebarResizing: boolean
  handleSidebarResizeStart: (event: any) => void
}

export function useSidebarResize({
  activeLeftPanel,
}: UseSidebarResizeParams): UseSidebarResizeReturn {
  const [sidebarWidth, setSidebarWidth] = useState(260)
  const [isSidebarResizing, setIsSidebarResizing] = useState(false)
  const sidebarResizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const handleSidebarResizeStart = useCallback((event: any) => {
    if (!activeLeftPanel) return
    sidebarResizeStateRef.current = { startX: event.clientX, startWidth: sidebarWidth }
    setIsSidebarResizing(true)
    event.preventDefault()
    event.stopPropagation()
  }, [activeLeftPanel, sidebarWidth])

  useEffect(() => {
    if (!isSidebarResizing) return
    const handleMove = (e: MouseEvent) => {
      const state = sidebarResizeStateRef.current
      if (!state) return
      const delta = e.clientX - state.startX
      let next = state.startWidth + delta
      if (next < MIN_SIDEBAR_WIDTH) next = MIN_SIDEBAR_WIDTH
      if (next > MAX_SIDEBAR_WIDTH) next = MAX_SIDEBAR_WIDTH
      setSidebarWidth(next)
    }
    const handleUp = () => {
      setIsSidebarResizing(false)
      sidebarResizeStateRef.current = null
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isSidebarResizing])

  return {
    sidebarWidth,
    isSidebarResizing,
    handleSidebarResizeStart,
  }
}
