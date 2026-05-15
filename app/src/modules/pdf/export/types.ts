import type { Rect, StampKind } from '../types/annotation'

export type ExportPdfRect = Rect

export type ExportPdfTextMarkupAnnotation = {
  kind: 'highlight' | 'underline' | 'strikeout' | 'squiggly'
  page: number
  color: string
  opacity: number
  rects: ExportPdfRect[]
}

export type ExportPdfShapeAnnotation = {
  kind: 'square' | 'circle'
  page: number
  color: string
  opacity: number
  rect: ExportPdfRect
}

export type ExportPdfLineAnnotation = {
  kind: 'line' | 'arrow'
  page: number
  color: string
  opacity: number
  line: ExportPdfRect
}

export type ExportPdfStampAnnotation = {
  kind: 'stamp'
  page: number
  color: string
  opacity: number
  rect: ExportPdfRect
  stampKind: StampKind
}

export type ExportPdfFreeTextAnnotation = {
  kind: 'freeText'
  page: number
  color: string
  opacity: number
  rect: ExportPdfRect
  text: string
}

export type ExportPdfAppendixNote = {
  page: number
  annotationKind: string
  quote?: string
  note: string
}

export type ExportPdfAnnotation =
  | ExportPdfTextMarkupAnnotation
  | ExportPdfShapeAnnotation
  | ExportPdfLineAnnotation
  | ExportPdfStampAnnotation
  | ExportPdfFreeTextAnnotation

export type ExportPdfDocument = {
  sourcePath: string
  fileName: string
  pageCount: number
  annotations: ExportPdfAnnotation[]
  appendixNotes: ExportPdfAppendixNote[]
}
