export type WordDocPayload = {
  title: string
  blocks: WordBlock[]
  assets: WordAsset[]
}

export type WordBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: InlineRun[] }
  | { type: 'paragraph'; text: InlineRun[] }
  | { type: 'blockquote'; children: WordBlock[] }
  | { type: 'code'; language?: string; content: string }
  | { type: 'list'; ordered: boolean; items: WordBlock[][] }
  | { type: 'table'; rows: { cells: WordBlock[][] }[] }
  | { type: 'image'; assetId: string; alt?: string; widthPx?: number; heightPx?: number }

export type InlineRun =
  | { type: 'text'; value: string; bold?: boolean; italic?: boolean; code?: boolean; strike?: boolean }
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
