import type { Annotation, DocumentAnnotations, Rect } from '../types/annotation'
import type { ExportPdfAnnotation, ExportPdfAppendixNote, ExportPdfDocument } from './types'

function isValidRect(rect: Rect) {
  return rect.x2 > rect.x1 && rect.y2 > rect.y1
}

function normalizeRects(rects: readonly Rect[]) {
  return rects.filter(isValidRect).map((rect) => ({ ...rect }))
}

function getAnchorRect(annotation: Annotation): Rect | null {
  if ((annotation.type === 'line' || annotation.type === 'arrow') && annotation.linePoints) {
    const { x1, y1, x2, y2 } = annotation.linePoints
    return {
      x1: Math.min(x1, x2),
      y1: Math.min(y1, y2),
      x2: Math.max(x1, x2),
      y2: Math.max(y1, y2),
    }
  }

  const rect = annotation.rects
    .filter(isValidRect)
    .slice()
    .sort((left, right) => {
      if (left.y1 !== right.y1) return left.y1 - right.y1
      return left.x1 - right.x1
    })[0]

  return rect ? { ...rect } : null
}

export function mapAnnotationsToExportPdfDocument(params: {
  sourcePath: string
  fileName: string
  annotationDocument: DocumentAnnotations | null
}): ExportPdfDocument {
  const { sourcePath, fileName, annotationDocument } = params
  const pageCount = annotationDocument?.pageCount ?? 0

  if (!annotationDocument) {
    return {
      sourcePath,
      fileName,
      pageCount,
      annotations: [],
      appendixNotes: [],
    }
  }

  const annotations = annotationDocument.annotations.flatMap<ExportPdfAnnotation>((annotation) => {
    switch (annotation.type) {
      case 'highlight':
      case 'underline':
      case 'strikeout':
      case 'squiggly': {
        const rects = normalizeRects(annotation.rects)
        if (rects.length === 0) return []
        return [{
          kind: annotation.type,
          page: annotation.page,
          color: annotation.color,
          opacity: annotation.opacity,
          rects,
        }]
      }
      case 'square':
      case 'circle': {
        const rect = annotation.rects[0]
        if (!rect || !isValidRect(rect)) return []
        return [{
          kind: annotation.type,
          page: annotation.page,
          color: annotation.color,
          opacity: annotation.opacity,
          rect: { ...rect },
        }]
      }
      case 'line':
      case 'arrow': {
        const line = annotation.linePoints
        if (!line) return []
        return [{
          kind: annotation.type,
          page: annotation.page,
          color: annotation.color,
          opacity: annotation.opacity,
          line: { ...line },
        }]
      }
      case 'stamp': {
        const rect = annotation.rects[0]
        if (!rect || !isValidRect(rect) || !annotation.stampKind) return []
        return [{
          kind: 'stamp',
          page: annotation.page,
          color: annotation.color,
          opacity: annotation.opacity,
          rect: { ...rect },
          stampKind: annotation.stampKind,
        }]
      }
      case 'freeText': {
        const rect = annotation.rects[0]
        const text = annotation.text?.trim()
        if (!rect || !isValidRect(rect) || !text) return []
        return [{
          kind: 'freeText',
          page: annotation.page,
          color: annotation.color,
          opacity: annotation.opacity,
          rect: { ...rect },
          text,
        }]
      }
      default:
        return []
    }
  })

  const appendixNotes = annotationDocument.annotations
    .filter((annotation) => annotation.type !== 'note')
    .map<[Annotation, string] | null>((annotation) => {
      const note = annotation.note?.trim()
      if (!note) return null
      return [annotation, note]
    })
    .filter((entry): entry is [Annotation, string] => entry !== null)
    .sort(([left], [right]) => {
      if (left.page !== right.page) return left.page - right.page
      const leftAnchor = getAnchorRect(left)
      const rightAnchor = getAnchorRect(right)
      if (leftAnchor && rightAnchor) {
        if (leftAnchor.y1 !== rightAnchor.y1) return leftAnchor.y1 - rightAnchor.y1
        if (leftAnchor.x1 !== rightAnchor.x1) return leftAnchor.x1 - rightAnchor.x1
      }
      return left.createdAt - right.createdAt
    })
    .map<ExportPdfAppendixNote>(([annotation, note]) => ({
      page: annotation.page,
      annotationKind: annotation.type,
      quote: annotation.content?.trim() || annotation.text?.trim() || undefined,
      note,
    }))

  return {
    sourcePath,
    fileName,
    pageCount,
    annotations,
    appendixNotes,
  }
}
