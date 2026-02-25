import { useState, useCallback, useMemo, useEffect, type RefObject } from 'react'

/**
 * 多页虚拟滚动 Hook。
 *
 * - pageIndex 统一使用 0-based，[start, end) 形式；
 * - visibleRange：当前视口内真正可见的页；
 * - nearbyRange：在 visibleRange 的基础上增加前后 buffer，用于“邻近高质量渲染”。
 */
interface UseVirtualPagesOptions {
  pageCount: number
  pageHeight: number
  containerRef: RefObject<HTMLElement | null>
  /**
   * 视口前后预加载的页数，用于构建 nearbyRange
   */
  bufferPages?: number
}

export interface PageRange {
  start: number
  end: number // 结束索引为开区间 [start, end)
}

interface UseVirtualPagesResult {
  visibleRange: PageRange
  nearbyRange: PageRange
  totalHeight: number
  onScroll: () => void
}

export function useVirtualPages({
  pageCount,
  pageHeight,
  containerRef,
  bufferPages = 2,
}: UseVirtualPagesOptions): UseVirtualPagesResult {
  const safePageHeight = Math.max(1, pageHeight || 1)

  const [visibleRange, setVisibleRange] = useState<PageRange>({ start: 0, end: 1 })
  const [nearbyRange, setNearbyRange] = useState<PageRange>({ start: 0, end: Math.min(5, pageCount) })

  const totalHeight = useMemo(() => {
    if (pageCount <= 0 || safePageHeight <= 0) return 0
    return pageCount * safePageHeight
  }, [pageCount, safePageHeight])

  const recomputeRanges = useCallback(() => {
    const container = containerRef.current
    if (!container || pageCount <= 0) {
      const empty: PageRange = { start: 0, end: Math.min(1, pageCount) }
      const nearbyEmpty: PageRange = {
        start: Math.max(0, empty.start - bufferPages),
        end: Math.min(pageCount, empty.end + bufferPages),
      }
      setVisibleRange(empty)
      setNearbyRange(nearbyEmpty)
      return
    }

    const scrollTop = container.scrollTop
    const containerHeight = container.clientHeight || 0

    // 计算当前严格可见的页区间（不含 buffer）
    const firstVisibleIndex = Math.floor(scrollTop / safePageHeight)
    const lastVisibleIndex = Math.floor((scrollTop + Math.max(containerHeight - 1, 0)) / safePageHeight)

    const clampedFirst = Math.max(0, Math.min(firstVisibleIndex, pageCount - 1))
    const clampedLast = Math.max(clampedFirst, Math.min(lastVisibleIndex, pageCount - 1))

    const nextVisible: PageRange = {
      start: clampedFirst,
      end: clampedLast + 1,
    }

    // 在 visibleRange 基础上扩展 buffer，形成邻近区
    const bufferedStart = Math.max(0, nextVisible.start - bufferPages)
    const bufferedEnd = Math.min(pageCount, nextVisible.end + bufferPages)

    const nextNearby: PageRange = {
      start: bufferedStart,
      end: bufferedEnd,
    }

    setVisibleRange(nextVisible)
    setNearbyRange(nextNearby)
  }, [bufferPages, containerRef, pageCount, safePageHeight])

  const onScroll = useCallback(() => {
    recomputeRanges()
  }, [recomputeRanges])

  // 当页数、单页高度或容器就绪时，初始化 / 同步一次可见区
  useEffect(() => {
    recomputeRanges()
  }, [recomputeRanges])

  return {
    visibleRange,
    nearbyRange,
    totalHeight,
    onScroll,
  }
}
