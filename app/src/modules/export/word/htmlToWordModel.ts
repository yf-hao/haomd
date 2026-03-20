import type { InlineRun, WordAsset, WordBlock } from './types'
import { parseHtmlImageSize, parseHtmlParagraphStyle, parseHtmlTableCellStyle, parseHtmlTableStyle, parseHtmlTextStyle } from './htmlStyleParser'

type TextRun = Extract<InlineRun, { type: 'text' }>
type TextMarks = Pick<TextRun, 'bold' | 'italic' | 'code' | 'strike' | 'underline' | 'color' | 'backgroundColor' | 'fontSizePt' | 'fontFamily'>

export type HtmlWordModelContext = {
  addAsset: (asset: WordAsset) => void
  nextAssetId: () => string
}

export function htmlFragmentToBlocks(html: string, ctx: HtmlWordModelContext): WordBlock[] {
  const container = parseHtmlFragment(html)
  return Array.from(container.childNodes).flatMap((node) => domNodeToBlocks(node, ctx))
}

export function htmlFragmentToInlineRuns(
  html: string,
  ctx: HtmlWordModelContext,
  marks: TextMarks = {},
): InlineRun[] {
  const container = parseHtmlFragment(html)
  return mergeAdjacentTextRuns(
    Array.from(container.childNodes).flatMap((node) => domNodeToInlineRuns(node, ctx, marks)),
  )
}

function parseHtmlFragment(html: string): DocumentFragment {
  const template = document.createElement('template')
  template.innerHTML = html
  return template.content
}

function domNodeToBlocks(node: ChildNode, ctx: HtmlWordModelContext): WordBlock[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const value = node.textContent?.trim()
    return value ? [{ type: 'paragraph', text: [{ type: 'text', value }] }] : []
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return []
  }

  const element = node as HTMLElement
  const tagName = element.tagName.toLowerCase()
  const elementAttrs = getElementAttributes(element)
  const blockMarks = omitBlockLevelRunBackground(parseHtmlTextStyle(tagName, elementAttrs))

  switch (tagName) {
    case 'p':
      return [{
        type: 'paragraph',
        text: domChildrenToInlineRuns(element, ctx, blockMarks),
        style: paragraphStyleOrUndefined(parseHtmlParagraphStyle(elementAttrs)),
      }]
    case 'div': {
      const nestedBlocks = Array.from(element.childNodes).flatMap((child) => domNodeToBlocks(child, ctx))
      if (nestedBlocks.length > 0) return nestedBlocks
      const inlineRuns = domChildrenToInlineRuns(element, ctx, blockMarks)
      return inlineRuns.length ? [{
        type: 'paragraph',
        text: inlineRuns,
        style: paragraphStyleOrUndefined(parseHtmlParagraphStyle(elementAttrs)),
      }] : []
    }
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return [{
        type: 'heading',
        level: Number(tagName.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6,
        text: domChildrenToInlineRuns(element, ctx, blockMarks),
        style: paragraphStyleOrUndefined(parseHtmlParagraphStyle(elementAttrs)),
      }]
    case 'blockquote':
      return [{
        type: 'blockquote',
        children: Array.from(element.childNodes).flatMap((child) => domNodeToBlocks(child, ctx)),
      }]
    case 'pre':
      return [{ type: 'code', content: element.textContent || '' }]
    case 'ul':
    case 'ol':
      return [{
        type: 'list',
        ordered: tagName === 'ol',
        items: Array.from(element.children)
          .filter((child) => child.tagName.toLowerCase() === 'li')
          .map((item) => listItemToBlocks(item as HTMLElement, ctx)),
      }]
    case 'table':
      {
        const tableStyle = parseHtmlTableStyle(getElementAttributes(element))
        const columnWidths = parseHtmlTableColumnWidths(element)
        const normalizedTableStyle = tableStyleOrUndefined({
          ...tableStyle,
          ...(columnWidths ? { columnWidths } : {}),
        })

      return [{
        type: 'table',
        ...(normalizedTableStyle ? { style: normalizedTableStyle } : {}),
        rows: parseHtmlTableRows(element, ctx),
      }]
      }
    case 'img': {
      const block = imageElementToBlock(element, ctx)
      return block ? [block] : []
    }
    case 'hr':
      return [{ type: 'paragraph', text: [{ type: 'text', value: '----------------' }] }]
    default: {
      const inlineRuns = domChildrenToInlineRuns(element, ctx)
      return inlineRuns.length ? [{ type: 'paragraph', text: inlineRuns }] : []
    }
  }
}

function domNodeToInlineRuns(
  node: ChildNode,
  ctx: HtmlWordModelContext,
  marks: TextMarks = {},
): InlineRun[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const value = node.textContent ?? ''
    return value ? [{ type: 'text', value, ...marks }] : []
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return []
  }

  const element = node as HTMLElement
  const tagName = element.tagName.toLowerCase()
  const elementMarks = mergeMarks(marks, parseHtmlTextStyle(tagName, getElementAttributes(element)))

  switch (tagName) {
    case 'strong':
    case 'b':
      return domChildrenToInlineRuns(element, ctx, elementMarks)
    case 'em':
    case 'i':
      return domChildrenToInlineRuns(element, ctx, elementMarks)
    case 'del':
    case 's':
      return domChildrenToInlineRuns(element, ctx, elementMarks)
    case 'u':
    case 'span':
    case 'font':
      return domChildrenToInlineRuns(element, ctx, elementMarks)
    case 'code':
      return [{ type: 'text', value: element.textContent || '', ...elementMarks }]
    case 'br':
      return [{ type: 'text', value: '\n', ...elementMarks }]
    case 'a': {
      const href = element.getAttribute('href') || ''
      const value = element.textContent || href
      return href ? [{ type: 'link', value, href }] : [{ type: 'text', value, ...marks }]
    }
    case 'img': {
      const fallback = element.getAttribute('alt') || element.getAttribute('src') || ''
      return fallback ? [{ type: 'text', value: fallback, ...elementMarks }] : []
    }
    default:
      return domChildrenToInlineRuns(element, ctx, elementMarks)
  }
}

function domChildrenToInlineRuns(
  element: HTMLElement,
  ctx: HtmlWordModelContext,
  marks: TextMarks = {},
): InlineRun[] {
  return mergeAdjacentTextRuns(
    Array.from(element.childNodes).flatMap((child) => domNodeToInlineRuns(child, ctx, marks)),
  )
}

function elementChildNodes(element: HTMLElement): ChildNode[] {
  return Array.from(element.childNodes)
}

function listItemToBlocks(element: HTMLElement, ctx: HtmlWordModelContext): WordBlock[] {
  const blocks = elementChildNodes(element).flatMap((child) => domNodeToBlocks(child, ctx))
  if (blocks.length > 0) return blocks

  const inlineRuns = domChildrenToInlineRuns(element, ctx)
  return inlineRuns.length ? [{ type: 'paragraph', text: inlineRuns }] : []
}

function collectTableRows(table: HTMLElement): HTMLTableRowElement[] {
  const rows: HTMLTableRowElement[] = []
  for (const child of Array.from(table.children)) {
    const tagName = child.tagName.toLowerCase()
    if (tagName === 'tr') {
      rows.push(child as HTMLTableRowElement)
    }
    if (tagName === 'thead' || tagName === 'tbody' || tagName === 'tfoot') {
      rows.push(
        ...Array.from(child.children).filter(
          (row): row is HTMLTableRowElement => row.tagName.toLowerCase() === 'tr',
        ),
      )
    }
  }
  return rows
}

function parseHtmlTableRows(
  table: HTMLElement,
  ctx: HtmlWordModelContext,
): Extract<Extract<WordBlock, { type: 'table' }>['rows'], unknown[]> {
  type ActiveRowSpan = {
    startCol: number
    colSpan: number
    remainingRows: number
    style?: Extract<Extract<WordBlock, { type: 'table' }>['rows'][number]['cells'][number], { style?: unknown }>['style']
  }

  const rows = collectTableRows(table)
  const parsedRows: { cells: { blocks: WordBlock[]; style?: ReturnType<typeof tableCellStyleOrUndefined>; colSpan?: number; rowSpan?: number; mergeContinue?: boolean }[] }[] = []
  const activeSpans: ActiveRowSpan[] = []

  for (const row of rows) {
    const rowCells: { blocks: WordBlock[]; style?: ReturnType<typeof tableCellStyleOrUndefined>; colSpan?: number; rowSpan?: number; mergeContinue?: boolean }[] = []
    const sourceCells = Array.from(row.children).filter((child) => ['th', 'td'].includes(child.tagName.toLowerCase()))
    let sourceIndex = 0
    let colIndex = 0

    const flushPending = () => {
      const pending = activeSpans
        .filter((span) => span.startCol === colIndex && span.remainingRows > 0)
        .sort((a, b) => a.startCol - b.startCol)[0]

      if (!pending) return false

      rowCells.push({
        blocks: [],
        ...(pending.style ? { style: pending.style } : {}),
        ...(pending.colSpan > 1 ? { colSpan: pending.colSpan } : {}),
        mergeContinue: true,
      })
      pending.remainingRows -= 1
      colIndex += pending.colSpan
      return true
    }

    while (sourceIndex < sourceCells.length) {
      while (flushPending()) {
        // keep consuming carried row spans before the next source cell
      }

      const cell = sourceCells[sourceIndex] as HTMLElement
      const attrs = getElementAttributes(cell)
      const blocks = Array.from(cell.childNodes).flatMap((child) => domNodeToBlocks(child, ctx))
      const colSpan = parseTableCellSpanValue(cell.getAttribute('colspan'))
      const rowSpan = parseTableCellSpanValue(cell.getAttribute('rowspan'))
      const style = tableCellStyleOrUndefined(parseHtmlTableCellStyle(attrs))

      rowCells.push({
        blocks: blocks.length > 0 ? blocks : [{ type: 'paragraph', text: domChildrenToInlineRuns(cell, ctx) }],
        ...(style ? { style } : {}),
        ...(colSpan > 1 ? { colSpan } : {}),
        ...(rowSpan > 1 ? { rowSpan } : {}),
      })

      if (rowSpan > 1) {
        activeSpans.push({
          startCol: colIndex,
          colSpan,
          remainingRows: rowSpan - 1,
          style,
        })
      }

      colIndex += colSpan
      sourceIndex += 1
    }

    while (flushPending()) {
      // keep consuming trailing carried row spans
    }

    parsedRows.push({ cells: rowCells })
  }

  return parsedRows
}

function parseHtmlTableColumnWidths(
  table: HTMLElement,
): { widthPercent?: number; widthPx?: number }[] | undefined {
  const colElements = Array.from(table.querySelectorAll(':scope > colgroup > col, :scope > col'))
  if (colElements.length === 0) return undefined

  const widths = colElements
    .map((col) => {
      const attrs = getElementAttributes(col as HTMLElement)
      const style = attrs.style ? attrs.style.split(';').reduce<Record<string, string>>((acc, raw) => {
        const separatorIndex = raw.indexOf(':')
        if (separatorIndex <= 0) return acc
        const property = raw.slice(0, separatorIndex).trim().toLowerCase()
        const value = raw.slice(separatorIndex + 1).trim()
        if (property && value) acc[property] = value
        return acc
      }, {}) : {}

      const widthPercent = parsePercentageWidth(style.width ?? attrs.width)
      const widthPx = widthPercent == null ? parsePixelWidth(style.width ?? attrs.width) : undefined
      if (widthPercent == null && widthPx == null) return undefined
      return {
        ...(widthPercent != null ? { widthPercent } : {}),
        ...(widthPx != null ? { widthPx } : {}),
      }
    })
    .filter((value): value is { widthPercent?: number; widthPx?: number } => value != null)

  return widths.length > 0 ? widths : undefined
}

function parsePercentageWidth(value: string | undefined): number | undefined {
  if (!value) return undefined
  const match = /^(\d+(\.\d+)?)%$/.exec(value.trim().toLowerCase())
  if (!match) return undefined
  const percent = Number(match[1])
  return Number.isFinite(percent) && percent > 0 ? Math.min(100, percent) : undefined
}

function parsePixelWidth(value: string | undefined): number | undefined {
  if (!value) return undefined
  const trimmed = value.trim().toLowerCase()
  const plain = /^(\d+(\.\d+)?)$/.exec(trimmed)
  if (plain) return Math.max(1, Math.round(Number(plain[1])))
  const px = /^(\d+(\.\d+)?)px$/.exec(trimmed)
  if (px) return Math.max(1, Math.round(Number(px[1])))
  return undefined
}

function imageElementToBlock(element: HTMLElement, ctx: HtmlWordModelContext): WordBlock | null {
  const sourcePath = element.getAttribute('src')
  if (!sourcePath) return null

  const assetId = ctx.nextAssetId()
  ctx.addAsset({
    id: assetId,
    kind: 'image',
    sourcePath,
  })

  return {
    type: 'image',
    assetId,
    alt: element.getAttribute('alt') || undefined,
    ...parseHtmlImageSize(getElementAttributes(element)),
  }
}

function mergeAdjacentTextRuns(runs: InlineRun[]): InlineRun[] {
  const merged: InlineRun[] = []

  for (const run of runs) {
    const prev = merged[merged.length - 1]
    if (
      prev &&
      run.type === 'text' &&
      prev.type === 'text' &&
      prev.bold === run.bold &&
      prev.italic === run.italic &&
      prev.code === run.code &&
      prev.strike === run.strike &&
      prev.underline === run.underline &&
      prev.color === run.color &&
      prev.backgroundColor === run.backgroundColor &&
      prev.fontSizePt === run.fontSizePt &&
      prev.fontFamily === run.fontFamily
    ) {
      prev.value += run.value
    } else {
      merged.push({ ...run })
    }
  }

  return merged
}

function mergeMarks(...markSets: TextMarks[]): TextMarks {
  return Object.assign({}, ...markSets)
}

function omitBlockLevelRunBackground(marks: TextMarks): TextMarks {
  if (marks.backgroundColor == null) return marks
  const { backgroundColor: _backgroundColor, ...rest } = marks
  return rest
}

function getElementAttributes(element: HTMLElement): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const attr of Array.from(element.attributes)) {
    attrs[attr.name.toLowerCase()] = attr.value
  }
  return attrs
}

function paragraphStyleOrUndefined<T extends object>(style: T): T | undefined {
  return Object.keys(style).length > 0 ? style : undefined
}

function tableCellStyleOrUndefined<T extends object>(style: T): T | undefined {
  return Object.keys(style).length > 0 ? style : undefined
}

function tableStyleOrUndefined<T extends object>(style: T): T | undefined {
  return Object.keys(style).length > 0 ? style : undefined
}

function parseTableCellSpanValue(value: string | null): number {
  if (!value) return 1
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}
