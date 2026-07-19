import { describe, expect, it } from 'vitest'
import { selectionRectsToAnnotationRects } from '../annotationUtils'
import {
  annotationRectsToSelectionBlocks,
  areSelectionBlocksEqual,
  buildSelectionBlocks,
} from './pdfSelectionOverlay'
import { shouldIgnoreSelectionChangeFromEditableOutsideRoot } from './pdfSelectionGuards'

function createRect(left: number, top: number, width: number, height: number) {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  }
}

describe('PdfOfficialPageView selection overlay', () => {
  it('filters oversized full-page selection rects caused by blank-area dragging', () => {
    const pageRect = createRect(100, 200, 600, 800)
    const textRects = [createRect(40, 60, 220, 24)]
    const selectionRects = [
      createRect(140, 260, 180, 24),
      createRect(100, 200, 600, 800),
    ]

    expect(buildSelectionBlocks(selectionRects, pageRect, textRects)).toEqual([
      {
        left: 40,
        top: 60,
        width: 180,
        height: 24,
      },
    ])
  })

  it('drops rects that do not overlap text content when text rects are available', () => {
    const pageRect = createRect(100, 200, 600, 800)
    const textRects = [createRect(40, 60, 220, 24)]
    const selectionRects = [
      createRect(140, 260, 180, 24),
      createRect(500, 900, 100, 30),
    ]

    expect(buildSelectionBlocks(selectionRects, pageRect, textRects)).toEqual([
      {
        left: 40,
        top: 60,
        width: 180,
        height: 24,
      },
    ])
  })

  it('clips partly overflowing rects to the page bounds', () => {
    const pageRect = createRect(100, 200, 600, 800)
    const selectionRects = [createRect(80, 250, 120, 24)]

    expect(buildSelectionBlocks(selectionRects, pageRect, [])).toEqual([
      {
        left: 0,
        top: 50,
        width: 100,
        height: 24,
      },
    ])
  })

  it('compares selection blocks structurally before updating overlay', () => {
    expect(
      areSelectionBlocksEqual(
        [{ left: 10, top: 20, width: 30, height: 40 }],
        [{ left: 10, top: 20, width: 30, height: 40 }],
      ),
    ).toBe(true)

    expect(
      areSelectionBlocksEqual(
        [{ left: 10, top: 20, width: 30, height: 40 }],
        [{ left: 10, top: 21, width: 30, height: 40 }],
      ),
    ).toBe(false)
  })

  it('preserves each native selection rectangle when converting to annotation coordinates', () => {
    const pageRect = createRect(100, 200, 600, 800)
    const selectionRects = [
      createRect(140, 260, 90, 24),
      createRect(238, 260, 80, 24),
    ]

    expect(selectionRectsToAnnotationRects(selectionRects, pageRect)).toEqual([
      { x1: 40 / 600, y1: 60 / 800, x2: 130 / 600, y2: 84 / 800 },
      { x1: 138 / 600, y1: 60 / 800, x2: 218 / 600, y2: 84 / 800 },
    ])
  })

  it('merges duplicate and overlapping annotation rects into one visual block', () => {
    expect(
      annotationRectsToSelectionBlocks(
        [
          { x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.24 },
          { x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.24 },
          { x1: 0.35, y1: 0.201, x2: 0.6, y2: 0.245 },
        ],
        1000,
        1000,
      ),
    ).toEqual([
      {
        left: 100,
        top: 200,
        width: 500,
        height: 45,
      },
    ])
  })

  it('keeps annotation rects on separate visual lines apart', () => {
    expect(
      annotationRectsToSelectionBlocks(
        [
          { x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.24 },
          { x1: 0.1, y1: 0.25, x2: 0.4, y2: 0.29 },
        ],
        1000,
        1000,
      ),
    ).toHaveLength(2)
  })

  it('ignores selection updates when focus is in an editable element outside the pdf root', () => {
    const root = document.createElement('div')
    const textarea = document.createElement('textarea')

    expect(shouldIgnoreSelectionChangeFromEditableOutsideRoot(root, textarea)).toBe(true)
    expect(shouldIgnoreSelectionChangeFromEditableOutsideRoot(root, root)).toBe(false)
  })
})
