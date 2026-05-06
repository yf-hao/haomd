export type AnnotationType =
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'squiggly'
  | 'square'
  | 'circle'
  | 'line'
  | 'arrow'
  | 'freeText'
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

export type StampKind = 'important' | 'question' | 'todo' | 'done'

export interface Annotation {
  id: string
  page: number
  type: AnnotationType
  rects: Rect[]
  color: string
  opacity: number
  content?: string
  text?: string
  stampKind?: StampKind
  linePoints?: Rect
  note?: string
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

export function isMarkupAnnotationType(type: AnnotationType): type is 'highlight' | 'underline' | 'strikeout' | 'squiggly' | 'square' | 'circle' | 'line' | 'arrow' | 'stamp' {
  return (
    type === 'highlight' ||
    type === 'underline' ||
    type === 'strikeout' ||
    type === 'squiggly' ||
    type === 'square' ||
    type === 'circle' ||
    type === 'line' ||
    type === 'arrow' ||
    type === 'stamp'
  )
}

export function isTextMarkupAnnotationType(type: AnnotationType): type is 'highlight' | 'underline' | 'strikeout' | 'squiggly' {
  return (
    type === 'highlight' ||
    type === 'underline' ||
    type === 'strikeout' ||
    type === 'squiggly'
  )
}

export function isMarkupAnnotation(annotation: Annotation): annotation is Annotation & {
  type: 'highlight' | 'underline' | 'strikeout' | 'squiggly' | 'square' | 'circle' | 'line' | 'arrow' | 'stamp'
} {
  return isMarkupAnnotationType(annotation.type)
}

export function isColorableAnnotation(annotation: Annotation): annotation is Annotation & {
  type: 'highlight' | 'underline' | 'strikeout' | 'squiggly' | 'square' | 'circle' | 'line' | 'arrow' | 'stamp' | 'text' | 'freeText'
} {
  return isMarkupAnnotationType(annotation.type) || annotation.type === 'text' || annotation.type === 'freeText'
}
