import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import type { Root, Content, Image, List, ListItem, PhrasingContent, TableCell, TableRow } from 'mdast'
import { toString } from 'mdast-util-to-string'
import type { InlineRun, WordAsset, WordBlock, WordDocPayload } from './types'

type TextRun = Extract<InlineRun, { type: 'text' }>
type TextMarks = Pick<TextRun, 'bold' | 'italic' | 'code' | 'strike'>

type ParseContext = {
  definitions: Map<string, string>
  assets: WordAsset[]
  assetCounter: number
}

export function markdownToWordModel(markdown: string, title: string): WordDocPayload {
  const tree = unified()
    .use(remarkParse)
    .use(remarkGfm)
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
      return [{
        type: 'paragraph',
        text: [{ type: 'text', value: node.value }],
      }]
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

function tableRowToModel(row: TableRow, ctx: ParseContext): { cells: WordBlock[][] } {
  return {
    cells: row.children.map((cell) => tableCellToBlocks(cell, ctx)),
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

  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        if (node.value) {
          runs.push({ type: 'text', value: node.value, ...marks })
        }
        break
      case 'strong':
        runs.push(...transformInline(node.children, ctx, { ...marks, bold: true }))
        break
      case 'emphasis':
        runs.push(...transformInline(node.children, ctx, { ...marks, italic: true }))
        break
      case 'delete':
        runs.push(...transformInline(node.children, ctx, { ...marks, strike: true }))
        break
      case 'inlineCode':
        runs.push({ type: 'text', value: node.value, ...marks, code: true })
        break
      case 'break':
        runs.push({ type: 'text', value: '\n', ...marks })
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
          runs.push({ type: 'text', value: fallback, ...marks })
        }
        break
      }
      default: {
        const value = toString(node)
        if (value) {
          runs.push({ type: 'text', value, ...marks })
        }
        break
      }
    }
  }

  return mergeAdjacentTextRuns(runs)
}

function flattenInlineText(nodes: PhrasingContent[], ctx: ParseContext): string {
  return transformInline(nodes, ctx)
    .map((run) => run.value)
    .join('')
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
