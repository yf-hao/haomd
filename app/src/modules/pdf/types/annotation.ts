export type AnnotationType =
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'squiggly'
  | 'text'
  | 'popup'
  | 'stamp'
  | 'ink'

export interface Rect {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface Annotation {
  id: string
  page: number
  type: AnnotationType
  rects: Rect[]
  color: string
  opacity: number
  content?: string
  author?: string
  inkList?: Array<{ x: number; y: number }[]>
  createdAt: number
  updatedAt: number
}

export interface DocumentAnnotations {
  pdfHash: string
  fileName: string
  pageCount: number
  annotations: Annotation[]
  version: number
  lastModified: number
}

export interface RenderContext {
  scale: number
  pageWidth: number
  pageHeight: number
  rotation: number
}
