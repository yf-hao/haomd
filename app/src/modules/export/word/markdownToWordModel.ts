import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import katex from 'katex'
import type { Root, Content, Image, List, ListItem, PhrasingContent, TableCell, TableRow } from 'mdast'
import { toString } from 'mdast-util-to-string'
import type { InlineRun, WordAsset, WordBlock, WordDocPayload } from './types'
import { htmlFragmentToBlocks, htmlFragmentToInlineRuns, type HtmlWordModelContext } from './htmlToWordModel'
import { parseHtmlTextStyle } from './htmlStyleParser'

type TextRun = Extract<InlineRun, { type: 'text' }>
type TextMarks = Pick<TextRun, 'bold' | 'italic' | 'code' | 'strike' | 'underline' | 'color' | 'backgroundColor' | 'fontSizePt' | 'fontFamily'>

type ParseContext = {
  definitions: Map<string, string>
  assets: WordAsset[]
  assetCounter: number
}

export function markdownToWordModel(markdown: string, title: string): WordDocPayload {
  const tree = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .parse(markdown) as Root

  const ctx: ParseContext = {
    definitions: collectDefinitions(tree),
    assets: [],
    assetCounter: 0,
  }

  const blocks = tree.children
    .flatMap((node) => transformBlock(node, ctx))
    .filter((block): block is WordBlock => block != null)

  return {
    title,
    blocks,
    assets: ctx.assets,
  }
}

export function plainTextToWordModel(text: string, title: string): WordDocPayload {
  const normalized = text.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const blocks: WordBlock[] = lines.map((line) => ({
    type: 'paragraph',
    text: line ? [{ type: 'text', value: line }] : [],
  }))

  return {
    title,
    blocks,
    assets: [],
  }
}

function collectDefinitions(tree: Root): Map<string, string> {
  const map = new Map<string, string>()
  for (const node of tree.children) {
    if (node.type === 'definition' && typeof node.identifier === 'string' && typeof node.url === 'string') {
      map.set(normalizeIdentifier(node.identifier), node.url)
    }
  }
  return map
}

function transformBlock(node: Content, ctx: ParseContext): WordBlock[] {
  switch (node.type) {
    case 'heading':
      return [{
        type: 'heading',
        level: clampHeadingLevel(node.depth),
        text: transformInline(node.children, ctx),
      }]
    case 'paragraph':
      if (node.children.length === 1 && node.children[0]?.type === 'image') {
        const imageBlock = imageNodeToBlock(node.children[0], ctx)
        return imageBlock ? [imageBlock] : []
      }
      return [{
        type: 'paragraph',
        text: transformInline(node.children, ctx),
      }]
    case 'blockquote':
      return [{
        type: 'blockquote',
        children: node.children.flatMap((child) => transformBlock(child, ctx)),
      }]
    case 'math':
      return [{
        type: 'math',
        content: node.value,
        mathMl: renderMathMl(node.value, true),
      }]
    case 'code':
      return [{
        type: 'code',
        language: node.lang || undefined,
        content: node.value,
      }]
    case 'list':
      return [listNodeToBlock(node, ctx)]
    case 'table':
      return [{
        type: 'table',
        rows: node.children.map((row) => tableRowToModel(row, ctx)),
      }]
    case 'thematicBreak':
      return [{
        type: 'paragraph',
        text: [{ type: 'text', value: '----------------' }],
      }]
    case 'html':
      return htmlFragmentToBlocks(node.value, htmlContextFromParseContext(ctx))
    case 'definition':
      return []
    default: {
      const text = toString(node).trim()
      return text ? [{
        type: 'paragraph',
        text: [{ type: 'text', value: text }],
      }] : []
    }
  }
}

function listNodeToBlock(node: List, ctx: ParseContext): WordBlock {
  return {
    type: 'list',
    ordered: !!node.ordered,
    items: node.children.map((item) => listItemToBlocks(item, ctx)),
  }
}

function listItemToBlocks(node: ListItem, ctx: ParseContext): WordBlock[] {
  const blocks = node.children.flatMap((child) => transformBlock(child, ctx))
  if (blocks.length > 0) return blocks
  const fallback = toString(node).trim()
  return fallback ? [{ type: 'paragraph', text: [{ type: 'text', value: fallback }] }] : []
}

function tableRowToModel(row: TableRow, ctx: ParseContext): { cells: { blocks: WordBlock[] }[] } {
  return {
    cells: row.children.map((cell) => ({ blocks: tableCellToBlocks(cell, ctx) })),
  }
}

function tableCellToBlocks(cell: TableCell, ctx: ParseContext): WordBlock[] {
  const blocks = cell.children.flatMap((child) => transformBlock(child, ctx))
  if (blocks.length > 0) return blocks
  const fallback = toString(cell).trim()
  return fallback ? [{ type: 'paragraph', text: [{ type: 'text', value: fallback }] }] : []
}

function transformInline(nodes: PhrasingContent[], ctx: ParseContext, marks: TextMarks = {}): InlineRun[] {
  const runs: InlineRun[] = []
  let htmlMarks: TextMarks = {}
  let htmlLinkHref: string | null = null

  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        if (node.value) {
          if (htmlLinkHref) {
            runs.push({ type: 'link', value: node.value, href: htmlLinkHref })
          } else {
            runs.push({ type: 'text', value: node.value, ...mergeMarks(marks, htmlMarks) })
          }
        }
        break
      case 'strong':
        runs.push(...transformInline(node.children, ctx, mergeMarks(marks, htmlMarks, { bold: true })))
        break
      case 'emphasis':
        runs.push(...transformInline(node.children, ctx, mergeMarks(marks, htmlMarks, { italic: true })))
        break
      case 'delete':
        runs.push(...transformInline(node.children, ctx, mergeMarks(marks, htmlMarks, { strike: true })))
        break
      case 'inlineCode':
        runs.push({ type: 'text', value: node.value, ...mergeMarks(marks, htmlMarks, { code: true }) })
        break
      case 'inlineMath':
        runs.push({ type: 'math', value: node.value, mathMl: renderMathMl(node.value, false) })
        break
      case 'break':
        runs.push({ type: 'text', value: '\n', ...mergeMarks(marks, htmlMarks) })
        break
      case 'link': {
        const value = flattenInlineText(node.children, ctx)
        runs.push({ type: 'link', value: value || node.url, href: node.url })
        break
      }
      case 'linkReference': {
        const href = ctx.definitions.get(normalizeIdentifier(node.identifier))
        const value = flattenInlineText(node.children, ctx)
        if (href) {
          runs.push({ type: 'link', value: value || href, href })
        } else if (value) {
          runs.push({ type: 'text', value, ...marks })
        }
        break
      }
      case 'image': {
        const fallback = node.alt || node.url
        if (fallback) {
          runs.push({ type: 'text', value: fallback, ...marks })
        }
        break
      }
      case 'imageReference': {
        const href = ctx.definitions.get(normalizeIdentifier(node.identifier))
        const fallback = node.alt || href || node.identifier
        if (fallback) {
          runs.push({ type: 'text', value: fallback, ...mergeMarks(marks, htmlMarks) })
        }
        break
      }
      case 'html': {
        const token = parseSimpleInlineHtmlTag(node.value)
        if (token) {
          if (token.kind === 'self' && token.tag === 'br') {
            runs.push({ type: 'text', value: '\n', ...mergeMarks(marks, htmlMarks) })
            break
          }

          if (token.tag === 'a') {
            htmlLinkHref = token.kind === 'open' ? token.attrs.href || null : null
            break
          }

          const tokenMarks = parseHtmlTextStyle(token.tag, token.attrs)
          if (Object.keys(tokenMarks).length > 0) {
            htmlMarks = token.kind === 'open'
              ? mergeMarks(htmlMarks, tokenMarks)
              : clearHtmlMarks(htmlMarks, tokenMarks)
            break
          }
        }

        runs.push(
          ...htmlFragmentToInlineRuns(
            node.value,
            htmlContextFromParseContext(ctx),
            mergeMarks(marks, htmlMarks),
          ),
        )
        break
      }
      default: {
        const value = toString(node)
        if (value) {
          runs.push({ type: 'text', value, ...mergeMarks(marks, htmlMarks) })
        }
        break
      }
    }
  }

  return mergeAdjacentTextRuns(runs)
}

function mergeMarks(...markSets: TextMarks[]): TextMarks {
  return Object.assign({}, ...markSets)
}

function updateHtmlMarks(current: TextMarks, key: keyof TextMarks, enabled: boolean): TextMarks {
  if (enabled) {
    return { ...current, [key]: true }
  }

  const next = { ...current }
  delete next[key]
  return next
}

function clearHtmlMarks(current: TextMarks, removing: TextMarks): TextMarks {
  const next = { ...current }
  for (const key of Object.keys(removing) as (keyof TextMarks)[]) {
    delete next[key]
  }
  return next
}

function parseSimpleInlineHtmlTag(value: string): {
  kind: 'open' | 'close' | 'self'
  tag: string
  attrs: Record<string, string>
} | null {
  const trimmed = value.trim()
  const match = /^<\s*(\/)?\s*([a-zA-Z0-9]+)([^>]*)>$/.exec(trimmed)
  if (!match) return null

  const [, closingSlash, rawTag, rawAttrs] = match
  const tag = rawTag.toLowerCase()
  const attrs = closingSlash ? {} : parseHtmlAttributes(rawAttrs || '')
  const selfClosing = /\/\s*>$/.test(trimmed) || tag === 'br'

  return {
    kind: closingSlash ? 'close' : selfClosing ? 'self' : 'open',
    tag,
    attrs,
  }
}

function parseHtmlAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const match of raw.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attrs[match[1].toLowerCase()] = match[2] || match[3] || ''
  }
  return attrs
}

function flattenInlineText(nodes: PhrasingContent[], ctx: ParseContext): string {
  return transformInline(nodes, ctx)
    .map((run) => run.value)
    .join('')
}

function htmlContextFromParseContext(ctx: ParseContext): HtmlWordModelContext {
  return {
    addAsset: (asset) => {
      ctx.assets.push(asset)
    },
    nextAssetId: () => `asset_${ctx.assetCounter++}`,
  }
}

function imageNodeToBlock(node: Image, ctx: ParseContext): WordBlock | null {
  if (!node.url) return null

  const assetId = `asset_${ctx.assetCounter++}`
  ctx.assets.push({
    id: assetId,
    kind: 'image',
    sourcePath: node.url,
  })

  return {
    type: 'image',
    assetId,
    alt: node.alt || undefined,
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
      prev.strike === run.strike
    ) {
      prev.value += run.value
    } else {
      merged.push({ ...run })
    }
  }

  return merged
}

function normalizeIdentifier(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function clampHeadingLevel(level: number): 1 | 2 | 3 | 4 | 5 | 6 {
  const safe = Math.min(6, Math.max(1, level))
  return safe as 1 | 2 | 3 | 4 | 5 | 6
}

function renderMathMl(expression: string, displayMode: boolean): string | undefined {
  try {
    const html = katex.renderToString(expression, {
      displayMode,
      throwOnError: false,
      output: 'mathml',
    })
    const doc = new DOMParser().parseFromString(html, 'text/html')
    return doc.querySelector('math')?.outerHTML
  } catch {
    return undefined
  }
}
