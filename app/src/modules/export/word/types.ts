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

export type WordBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: InlineRun[] }
  | { type: 'paragraph'; text: InlineRun[] }
  | { type: 'blockquote'; children: WordBlock[] }
  | { type: 'math'; content: string; mathMl?: string }
  | { type: 'code'; language?: string; content: string }
  | { type: 'list'; ordered: boolean; items: WordBlock[][] }
  | { type: 'table'; rows: { cells: WordBlock[][] }[] }
  | { type: 'image'; assetId: string; alt?: string; widthPx?: number; heightPx?: number }

export type InlineRun =
  | { type: 'text'; value: string; bold?: boolean; italic?: boolean; code?: boolean; strike?: boolean }
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
