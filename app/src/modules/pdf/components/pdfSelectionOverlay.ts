export type SelectionBlock = {
  left: number
  top: number
  width: number
  height: number
}

export type RectLike = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

function mergeSelectionRects(rects: SelectionBlock[]): SelectionBlock[] {
  if (rects.length === 0) return []

  const sorted = [...rects].sort((a, b) => {
    if (Math.abs(a.top - b.top) > 2) return a.top - b.top
    return a.left - b.left
  })

  const merged: SelectionBlock[] = []
  const lineThreshold = 3
  const horizontalGap = 8

  for (const rect of sorted) {
    const last = merged[merged.length - 1]
    if (!last) {
      merged.push(rect)
      continue
    }

    const sameLine = Math.abs(last.top - rect.top) <= lineThreshold
    const closeEnough = rect.left <= last.left + last.width + horizontalGap

    if (sameLine && closeEnough) {
      const left = Math.min(last.left, rect.left)
      const right = Math.max(last.left + last.width, rect.left + rect.width)
      const top = Math.min(last.top, rect.top)
      const bottom = Math.max(last.top + last.height, rect.top + rect.height)
      last.left = left
      last.top = top
      last.width = right - left
      last.height = bottom - top
      continue
    }

    merged.push(rect)
  }

  return merged
}

export function areSelectionBlocksEqual(
  leftBlocks: readonly SelectionBlock[],
  rightBlocks: readonly SelectionBlock[],
) {
  if (leftBlocks.length !== rightBlocks.length) return false

  return leftBlocks.every((block, index) => {
    const other = rightBlocks[index]
    return (
      block.left === other.left &&
      block.top === other.top &&
      block.width === other.width &&
      block.height === other.height
    )
  })
}

function intersectsRect(a: RectLike, b: RectLike) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

function toPageAbsoluteRect(rect: RectLike, pageRect: RectLike): RectLike {
  return {
    left: rect.left + pageRect.left,
    top: rect.top + pageRect.top,
    right: rect.right + pageRect.left,
    bottom: rect.bottom + pageRect.top,
    width: rect.width,
    height: rect.height,
  }
}

function clipRectToPage(rect: RectLike, pageRect: RectLike): RectLike | null {
  const left = Math.max(rect.left, pageRect.left)
  const top = Math.max(rect.top, pageRect.top)
  const right = Math.min(rect.right, pageRect.right)
  const bottom = Math.min(rect.bottom, pageRect.bottom)
  const width = Math.max(0, right - left)
  const height = Math.max(0, bottom - top)

  if (width <= 0 || height <= 0) {
    return null
  }

  return {
    left,
    top,
    right,
    bottom,
    width,
    height,
  }
}

function isOversizedSelectionRect(rect: RectLike, pageRect: RectLike) {
  if (pageRect.width <= 0 || pageRect.height <= 0) return false

  const widthRatio = rect.width / pageRect.width
  const heightRatio = rect.height / pageRect.height
  const areaRatio = (rect.width * rect.height) / (pageRect.width * pageRect.height)

  return (widthRatio >= 0.98 && heightRatio >= 0.98) || areaRatio >= 0.7
}

function toPageRelativeRect(rect: RectLike, pageRect: RectLike): RectLike {
  return {
    left: rect.left - pageRect.left,
    top: rect.top - pageRect.top,
    right: rect.right - pageRect.left,
    bottom: rect.bottom - pageRect.top,
    width: rect.width,
    height: rect.height,
  }
}

export function buildSelectionBlocks(
  selectionRects: readonly RectLike[],
  pageRect: RectLike,
  textRects: readonly RectLike[],
): SelectionBlock[] {
  const clippedRects = selectionRects
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => clipRectToPage(rect, pageRect))
    .filter((rect): rect is RectLike => rect !== null)
    .filter((rect) => !isOversizedSelectionRect(rect, pageRect))

  const filteredRects =
    textRects.length > 0
      ? clippedRects.filter((rect) =>
          textRects.some((textRect) => intersectsRect(rect, toPageAbsoluteRect(textRect, pageRect))),
        )
      : clippedRects

  const relativePageRect: RectLike = {
    left: 0,
    top: 0,
    right: pageRect.width,
    bottom: pageRect.height,
    width: pageRect.width,
    height: pageRect.height,
  }

  return mergeSelectionRects(
    filteredRects
      .map((rect) => toPageRelativeRect(rect, pageRect))
      .filter((rect) => !isOversizedSelectionRect(rect, relativePageRect))
      .map((rect) => ({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      })),
  )
}

export function annotationRectsToSelectionBlocks(
  rects: readonly {
    x1: number
    y1: number
    x2: number
    y2: number
  }[],
  pageWidth: number,
  pageHeight: number,
): SelectionBlock[] {
  if (pageWidth <= 0 || pageHeight <= 0) {
    return []
  }

  return mergeSelectionRects(
    rects
      .map((rect) => {
        const left = rect.x1 * pageWidth
        const top = rect.y1 * pageHeight
        const right = rect.x2 * pageWidth
        const bottom = rect.y2 * pageHeight
        const width = Math.max(0, right - left)
        const height = Math.max(0, bottom - top)
        return {
          left,
          top,
          width,
          height,
        }
      })
      .filter((rect) => rect.width > 0 && rect.height > 0),
  )
}
