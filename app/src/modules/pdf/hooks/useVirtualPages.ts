import { useState, useCallback, useMemo, type RefObject } from 'react'

interface UseVirtualPagesOptions {
  pageCount: number
  pageHeight: number
  containerRef: RefObject<HTMLElement | null>
  bufferSize?: number
}

interface VisibleRange {
  start: number
  end: number
}

export function useVirtualPages({ pageCount, pageHeight, containerRef, bufferSize = 2 }: UseVirtualPagesOptions) {
  const [visibleRange, setVisibleRange] = useState<VisibleRange>({ start: 0, end: 5 })

  const totalHeight = useMemo(() => pageCount * pageHeight, [pageCount, pageHeight])

  const onScroll = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    const scrollTop = container.scrollTop
    const containerHeight = container.clientHeight

    const startPage = Math.floor(scrollTop / pageHeight)
    const endPage = Math.ceil((scrollTop + containerHeight) / pageHeight)

    const bufferedStart = Math.max(0, startPage - bufferSize)
    const bufferedEnd = Math.min(pageCount, endPage + bufferSize)

    setVisibleRange({ start: bufferedStart, end: bufferedEnd })
  }, [pageHeight, pageCount, bufferSize, containerRef])

  return { visibleRange, onScroll, totalHeight }
}
