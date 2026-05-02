import type { Annotation, DocumentAnnotations, Rect } from './types/annotation'
import type { SelectionBlock } from './components/pdfSelectionOverlay'

export interface PdfSelectionDraft {
  page: number
  text: string
  rects: Rect[]
}

const DEFAULT_HIGHLIGHT_COLOR = '#f5d90a'
const DEFAULT_HIGHLIGHT_OPACITY = 0.35
const ANNOTATION_SCHEMA_VERSION = 1

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
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

export function createHighlightAnnotation(
  selection: PdfSelectionDraft,
  color = DEFAULT_HIGHLIGHT_COLOR,
): Annotation {
  const now = Date.now()

  return {
    id: crypto.randomUUID(),
    page: selection.page,
    type: 'highlight',
    rects: selection.rects,
    color,
    opacity: DEFAULT_HIGHLIGHT_OPACITY,
    content: selection.text,
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
