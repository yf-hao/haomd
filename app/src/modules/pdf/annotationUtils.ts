import type { Annotation, DocumentAnnotations, Rect, StampKind } from './types/annotation'
import type { SelectionBlock } from './components/pdfSelectionOverlay'
import type { RectLike } from './components/pdfSelectionOverlay'
import type { AnnotationType } from './types/annotation'

export interface PdfSelectionDraft {
  page: number
  text: string
  rects: Rect[]
}

const DEFAULT_HIGHLIGHT_COLOR = '#f5d90a'
const DEFAULT_HIGHLIGHT_OPACITY = 0.35
const DEFAULT_TEXT_MARKUP_OPACITY = 1
const ANNOTATION_SCHEMA_VERSION = 1

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function mergePageRelativeRects(rects: RectLike[]): RectLike[] {
  if (rects.length === 0) return []

  const sorted = [...rects].sort((a, b) => {
    if (Math.abs(a.top - b.top) > 3) return a.top - b.top
    return a.left - b.left
  })

  const merged: RectLike[] = []

  for (const rect of sorted) {
    const last = merged[merged.length - 1]
    if (!last) {
      merged.push({ ...rect })
      continue
    }

    const lineThreshold = Math.max(3, Math.min(last.height, rect.height) * 0.35)
    const horizontalGap = Math.max(8, Math.min(last.height, rect.height) * 0.6)
    const sameLine = Math.abs(last.top - rect.top) <= lineThreshold
    const closeEnough = rect.left <= last.right + horizontalGap

    if (sameLine && closeEnough) {
      last.left = Math.min(last.left, rect.left)
      last.top = Math.min(last.top, rect.top)
      last.right = Math.max(last.right, rect.right)
      last.bottom = Math.max(last.bottom, rect.bottom)
      last.width = last.right - last.left
      last.height = last.bottom - last.top
      continue
    }

    merged.push({ ...rect })
  }

  return merged
}

export function getPdfFileName(filePath: string) {
  const parts = filePath.split(/[\\/]/)
  return parts[parts.length - 1] || filePath
}

export function createEmptyDocumentAnnotations(
  pdfHash: string,
  fileName: string,
  pageCount: number,
): DocumentAnnotations {
  return {
    pdfHash,
    fileName,
    pageCount,
    annotations: [],
    version: ANNOTATION_SCHEMA_VERSION,
    lastModified: Date.now(),
  }
}

export function normalizeDocumentAnnotations(
  data: DocumentAnnotations | null,
  pdfHash: string,
  fileName: string,
  pageCount: number,
): DocumentAnnotations {
  if (!data) {
    return createEmptyDocumentAnnotations(pdfHash, fileName, pageCount)
  }

  return {
    ...data,
    pdfHash,
    fileName,
    pageCount,
    annotations: Array.isArray(data.annotations) ? data.annotations : [],
    version: typeof data.version === 'number' ? data.version : ANNOTATION_SCHEMA_VERSION,
    lastModified: typeof data.lastModified === 'number' ? data.lastModified : Date.now(),
  }
}

export function selectionBlocksToAnnotationRects(
  blocks: readonly SelectionBlock[],
  pageWidth: number,
  pageHeight: number,
): Rect[] {
  if (pageWidth <= 0 || pageHeight <= 0) {
    return []
  }

  return blocks
    .filter((block) => block.width > 0 && block.height > 0)
    .map((block) => ({
      x1: clamp(block.left / pageWidth, 0, 1),
      y1: clamp(block.top / pageHeight, 0, 1),
      x2: clamp((block.left + block.width) / pageWidth, 0, 1),
      y2: clamp((block.top + block.height) / pageHeight, 0, 1),
    }))
    .filter((rect) => rect.x2 > rect.x1 && rect.y2 > rect.y1)
}

export function selectionRectsToAnnotationRects(
  rects: readonly RectLike[],
  pageRect: RectLike,
): Rect[] {
  if (pageRect.width <= 0 || pageRect.height <= 0) {
    return []
  }

  const pageRelativeRects = rects
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => {
      const left = clamp(rect.left - pageRect.left, 0, pageRect.width)
      const top = clamp(rect.top - pageRect.top, 0, pageRect.height)
      const right = clamp(rect.right - pageRect.left, 0, pageRect.width)
      const bottom = clamp(rect.bottom - pageRect.top, 0, pageRect.height)

      return {
        left,
        top,
        right,
        bottom,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
      }
    })
    .filter((rect) => rect.width > 0 && rect.height > 0)

  return mergePageRelativeRects(pageRelativeRects)
    .map((rect) => ({
      x1: clamp(rect.left / pageRect.width, 0, 1),
      y1: clamp(rect.top / pageRect.height, 0, 1),
      x2: clamp(rect.right / pageRect.width, 0, 1),
      y2: clamp(rect.bottom / pageRect.height, 0, 1),
    }))
    .filter((rect) => rect.x2 > rect.x1 && rect.y2 > rect.y1)
}

export function createHighlightAnnotation(
  selection: PdfSelectionDraft,
  color = DEFAULT_HIGHLIGHT_COLOR,
): Annotation {
  return createTextMarkupAnnotation(selection, 'highlight', color)
}

export function createTextMarkupAnnotation(
  selection: PdfSelectionDraft,
  type: Extract<AnnotationType, 'highlight' | 'underline' | 'strikeout' | 'squiggly'>,
  color = DEFAULT_HIGHLIGHT_COLOR,
): Annotation {
  const now = Date.now()
  const opacity = type === 'highlight' ? DEFAULT_HIGHLIGHT_OPACITY : DEFAULT_TEXT_MARKUP_OPACITY

  return {
    id: crypto.randomUUID(),
    page: selection.page,
    type,
    rects: selection.rects,
    color,
    opacity,
    content: selection.text,
    createdAt: now,
    updatedAt: now,
  }
}

export function createShapeAnnotation(
  page: number,
  rect: Rect,
  type: Extract<AnnotationType, 'square' | 'circle' | 'line' | 'arrow'>,
  color = DEFAULT_HIGHLIGHT_COLOR,
  linePoints?: Rect,
): Annotation {
  const now = Date.now()

  return {
    id: crypto.randomUUID(),
    page,
    type,
    rects: [rect],
    color,
    opacity: 1,
    linePoints,
    createdAt: now,
    updatedAt: now,
  }
}

export function createStampAnnotation(
  page: number,
  rect: Rect,
  stampKind: StampKind,
  label: string,
  color = DEFAULT_HIGHLIGHT_COLOR,
): Annotation {
  const now = Date.now()

  return {
    id: crypto.randomUUID(),
    page,
    type: 'stamp',
    rects: [rect],
    color,
    opacity: 1,
    content: label,
    stampKind,
    createdAt: now,
    updatedAt: now,
  }
}

export function createFreeTextAnnotation(
  page: number,
  rect: Rect,
  text: string,
  color = DEFAULT_HIGHLIGHT_COLOR,
): Annotation {
  const now = Date.now()

  return {
    id: crypto.randomUUID(),
    page,
    type: 'freeText',
    rects: [rect],
    color,
    opacity: 1,
    text,
    content: text,
    createdAt: now,
    updatedAt: now,
  }
}

export function createNoteAnnotation(
  page: number,
  rect: Rect,
  text: string,
  color = DEFAULT_HIGHLIGHT_COLOR,
): Annotation {
  const now = Date.now()

  return {
    id: crypto.randomUUID(),
    page,
    type: 'note',
    rects: [rect],
    color,
    opacity: 1,
    text,
    content: text,
    createdAt: now,
    updatedAt: now,
  }
}

export function createTextNoteAnnotation(
  selection: PdfSelectionDraft,
  note: string,
  color = DEFAULT_HIGHLIGHT_COLOR,
): Annotation {
  const now = Date.now()

  return {
    id: crypto.randomUUID(),
    page: selection.page,
    type: 'text',
    rects: selection.rects,
    color,
    opacity: 1,
    content: selection.text,
    note,
    createdAt: now,
    updatedAt: now,
  }
}

export function appendAnnotation(
  data: DocumentAnnotations,
  annotation: Annotation,
): DocumentAnnotations {
  return {
    ...data,
    annotations: [...data.annotations, annotation],
    lastModified: Date.now(),
  }
}
