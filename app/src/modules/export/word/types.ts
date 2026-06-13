export type WordDocPayload = {
  title: string
  blocks: WordBlock[]
  assets: WordAsset[]
  styleSettings?: WordExportStyleSettings
}

export type WordExportStyleSettings = {
  bodyFontFamily: string
  bodyFontSizePt: number
  headingFontFamily: string
  heading1SizePt: number
  heading2SizePt: number
  heading3SizePt: number
  paragraphSpacingAfterPt: number
  lineSpacing: number
  codeFontSizePt: number
  pageMarginCm: number
}

export type ParagraphStyle = {
  align?: 'left' | 'center' | 'right' | 'justify'
  lineHeight?: number
  spacingAfterPt?: number
  backgroundColor?: string
  borderColor?: string
  borderTopColor?: string
  borderRightColor?: string
  borderBottomColor?: string
  borderLeftColor?: string
}

export type TableCellStyle = {
  backgroundColor?: string
  align?: 'left' | 'center' | 'right' | 'justify'
  borderColor?: string
  borderTopColor?: string
  borderRightColor?: string
  borderBottomColor?: string
  borderLeftColor?: string
}

export type TableStyle = {
  align?: 'left' | 'center' | 'right'
  borderColor?: string
  widthPercent?: number
  widthPx?: number
  maxWidthPercent?: number
  columnWidths?: { widthPercent?: number; widthPx?: number }[]
  layout?: 'fixed' | 'auto'
}

export type WordBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: InlineRun[]; style?: ParagraphStyle }
  | { type: 'paragraph'; text: InlineRun[]; style?: ParagraphStyle }
  | { type: 'blockquote'; children: WordBlock[] }
  | { type: 'math'; content: string; mathMl?: string }
  | { type: 'code'; language?: string; content: string }
  | { type: 'list'; ordered: boolean; items: WordBlock[][] }
  | { type: 'table'; rows: { cells: { blocks: WordBlock[]; style?: TableCellStyle; colSpan?: number; rowSpan?: number; mergeContinue?: boolean }[] }[]; style?: TableStyle }
  | {
    type: 'image'
    assetId: string
    alt?: string
    widthPx?: number
    heightPx?: number
    widthPercent?: number
    maxWidthPercent?: number
  }

export type InlineRun =
  | {
    type: 'text'
    value: string
    bold?: boolean
    italic?: boolean
    code?: boolean
    strike?: boolean
    underline?: boolean
    color?: string
    backgroundColor?: string
    fontSizePt?: number
    fontFamily?: string
  }
  | { type: 'math'; value: string; mathMl?: string }
  | { type: 'link'; value: string; href: string }

export type WordAsset =
  | {
    id: string
    kind: 'image'
    sourcePath: string
    mimeType?: string
    widthPx?: number
    heightPx?: number
  }
  | {
    id: string
    kind: 'embedded-image'
    fileName: string
    mimeType: string
    base64Data: string
    widthPx?: number
    heightPx?: number
  }
