import type {
  ParsedTemplateMarkdown,
  TemplateContentModel,
  TemplateContentSource,
  WordTemplateConfig,
  WordTemplateBinding,
} from './types'
import { extractFrontMatter } from '../../../markdown/frontMatter'
import { markdownToWordModel } from '../markdownToWordModel'
import type { WordBlock } from '../types'

export function parseMarkdownToTemplateModel(
  markdown: string,
  templateConfig: WordTemplateConfig,
): ParsedTemplateMarkdown {
  const { frontMatter, body } = extractFrontMatter(markdown)
  const model = createEmptyTemplateContentModel()
  const richBlocksByField: Record<string, ReturnType<typeof markdownToWordModel>['blocks']> = {}
  const sections = splitTemplateSections(body)

  for (const binding of templateConfig.bindings) {
    const source = binding.source
    if (!source) continue

    if (source.kind === 'frontMatter') {
      const key = (source.key || getLastFieldSegment(binding.field)).trim()
      if (!key) continue
      setModelValue(model, binding.field, frontMatter[key] ?? '')
      continue
    }

    if (source.kind === 'table') {
      const key = getLastFieldSegment(binding.field)
      if (key) model.tables[key] = findMatchingTableColumn(body, source.header)
      continue
    }

    if (source.kind === 'inline') {
      const value = findInlineFieldValue(body, source.label)
      if (value != null) setModelValue(model, binding.field, value)
      continue
    }

    const section = findMatchingSection(sections, binding)
    if (!section) continue
    const normalizedContent = normalizeSectionContent(section.content)
    setModelValue(model, binding.field, normalizedContent)
    if (binding.type === 'richText') {
      const markdownContent = preserveLeadingSpacesForTemplate(section.content)
      const contentBlocks = applyTemplateHeadingStyle(
        markdownToWordModel(markdownContent, section.title).blocks,
        source,
      )
      const blocksWithHeading = prependHeadingBlockIfNeeded(contentBlocks, section.title, source)
      richBlocksByField[binding.field] = flattenListBlocksForTemplate(blocksWithHeading)
    }
  }

  return {
    frontMatter,
    body,
    model,
    richBlocksByField,
  }
}

export function findInlineFieldValue(markdown: string, label: string): string | null {
  if (typeof label !== 'string') return null
  const expectedLabel = label.trim()
  if (!expectedLabel) return null
  const markerPattern = /\{\{([^{}]*?)\}\}/g
  let match: RegExpExecArray | null

  while ((match = markerPattern.exec(markdown)) !== null) {
    const separatorIndex = match[1].search(/[:：]/)
    if (separatorIndex < 0) continue
    const markerLabel = match[1].slice(0, separatorIndex).trim()
    if (markerLabel !== expectedLabel) continue
    return match[1].slice(separatorIndex + 1).trim()
  }

  return null
}

export function resolveWordTemplateId(
  markdown: string,
): string | null {
  const { frontMatter } = extractFrontMatter(markdown)
  const raw = frontMatter.word_template || ''
  const normalized = raw.trim()
  return normalized || null
}

function createEmptyTemplateContentModel(): TemplateContentModel {
  return {
    meta: {},
    sections: {},
    tables: {},
  }
}

function findMatchingTableColumn(markdownBody: string, headerMarker: string): string[] {
  if (typeof headerMarker !== 'string' || !headerMarker.trim()) return []
  const lines = markdownBody.replace(/\r\n/g, '\n').split('\n')
  const expectedHeader = headerMarker.trim()

  for (let index = 0; index < lines.length - 1; index += 1) {
    const headers = splitMarkdownTableRow(lines[index])
    if (!headers || !isMarkdownTableDivider(lines[index + 1])) continue
    const columnIndex = headers.findIndex((header) => header.trim() === expectedHeader)
    if (columnIndex < 0) continue

    const values: string[] = []
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const cells = splitMarkdownTableRow(lines[rowIndex])
      if (!cells) break
      values.push(cells[columnIndex]?.trim() ?? '')
    }
    return values
  }

  return []
}

function splitMarkdownTableRow(line: string): string[] | null {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return null
  const cells: string[] = []
  let current = ''
  let escaped = false
  for (const character of trimmed) {
    if (character === '|' && !escaped) {
      cells.push(current.trim())
      current = ''
    } else {
      current += character
    }
    if (character === '\\' && !escaped) escaped = true
    else escaped = false
  }
  cells.push(current.trim())
  if (cells[0] === '') cells.shift()
  if (cells[cells.length - 1] === '') cells.pop()
  return cells
}

function isMarkdownTableDivider(line: string): boolean {
  const cells = splitMarkdownTableRow(line)
  return !!cells?.length && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
}

function setModelValue(model: TemplateContentModel, path: string, value: string) {
  const [scope, ...rest] = path.split('.')
  const key = rest.join('.')
  if (!scope || !key) return
  if (scope !== 'meta' && scope !== 'sections') return
  const target = model[scope]
  target[key] = value
}

function splitTemplateSections(
  markdownBody: string,
): Array<{ title: string; content: string; level: number }> {
  const lines = markdownBody.split('\n')
  const sections: Array<{ title: string; content: string; level: number }> = []

  for (let index = 0; index < lines.length; index += 1) {
    const heading = parseTemplateHeading(lines[index])
    if (!heading) continue

    const collected: string[] = []
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const nextHeading = parseTemplateHeading(lines[cursor])
      if (nextHeading && nextHeading.level <= heading.level) break
      collected.push(lines[cursor])
    }

    sections.push({
      title: heading.title,
      content: collected.join('\n').trim(),
      level: heading.level,
    })
  }
  return sections
}

function findMatchingSection(
  sections: Array<{ title: string; content: string; level: number }>,
  binding: WordTemplateBinding,
) {
  const source = binding.source
  if (!source || source.kind !== 'heading') return null
  const candidates = new Set<string>()
  if (source.match) candidates.add(source.match.trim())
  for (const item of source.matchAny ?? []) {
    const normalized = item.trim()
    if (normalized) candidates.add(normalized)
  }
  if (candidates.size === 0) return null
  return sections.find((section) => candidates.has(section.title)) ?? null
}

function parseTemplateHeading(line: string): { title: string; level: number } | null {
  const match = line.match(/^(#{1,4})\s+(.+?)\s*$/)
  if (!match) return null
  return {
    level: match[1].length,
    title: match[2].trim(),
  }
}

function prependHeadingBlockIfNeeded(
  contentBlocks: WordBlock[],
  sectionTitle: string,
  source: TemplateContentSource,
): WordBlock[] {
  if (source.kind !== 'heading' || !source.includeHeading) {
    return contentBlocks
  }
  const titleBlock: WordBlock = {
    type: 'paragraph',
    text: [
      {
        type: 'text',
        value: sectionTitle,
        bold: source.headingBold ?? true,
        fontSizePt:
          typeof source.headingFontSizePt === 'number' ? source.headingFontSizePt : undefined,
      },
    ],
  }
  return [titleBlock, ...contentBlocks]
}

function applyTemplateHeadingStyle(
  blocks: WordBlock[],
  source: TemplateContentSource,
): WordBlock[] {
  if (source.kind !== 'heading' || source.childHeadingBold == null) {
    return blocks
  }

  return blocks.map((block) => applyHeadingStyleToBlock(block, source.childHeadingBold ?? false))
}

function applyHeadingStyleToBlock(block: WordBlock, childHeadingBold: boolean): WordBlock {
  switch (block.type) {
    case 'heading':
      return {
        ...block,
        text: block.text.map((run) =>
          run.type === 'text' ? { ...run, bold: childHeadingBold } : run,
        ),
      }
    case 'blockquote':
      return {
        ...block,
        children: block.children.map((child) => applyHeadingStyleToBlock(child, childHeadingBold)),
      }
    case 'callout':
      return {
        ...block,
        children: block.children.map((child) => applyHeadingStyleToBlock(child, childHeadingBold)),
      }
    case 'list':
      return {
        ...block,
        items: block.items.map((item) =>
          item.map((child) => applyHeadingStyleToBlock(child, childHeadingBold)),
        ),
      }
    case 'table':
      return {
        ...block,
        rows: block.rows.map((row) => ({
          ...row,
          cells: row.cells.map((cell) => ({
            ...cell,
            blocks: cell.blocks.map((child) => applyHeadingStyleToBlock(child, childHeadingBold)),
          })),
        })),
      }
    case 'paragraph':
    case 'math':
    case 'code':
    case 'image':
      return block
  }
}

function normalizeSectionContent(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  return normalized.replace(/\n{3,}/g, '\n\n')
}

function preserveLeadingSpacesForTemplate(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  let fence: { marker: '`' | '~'; length: number } | null = null

  return lines.map((line) => {
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (fence) {
      if (
        fenceMatch &&
        fenceMatch[1][0] === fence.marker &&
        fenceMatch[1].length >= fence.length &&
        fenceMatch[2].trim() === ''
      ) {
        fence = null
      }
      // Preserve code-fence lines and every line inside the fence verbatim.
      return line
    }

    if (fenceMatch) {
      fence = {
        marker: fenceMatch[1][0] as '`' | '~',
        length: fenceMatch[1].length,
      }
      return line
    }

    return preserveLeadingSpacesInLine(line)
  }).join('\n')
}

function preserveLeadingSpacesInLine(line: string): string {
  const match = line.match(/^( +)(.*)$/)
  if (!match) return line
  if (shouldKeepMarkdownIndentation(match[2])) return line
  return `${'\u00A0'.repeat(match[1].length)}${match[2]}`
}

function shouldKeepMarkdownIndentation(content: string): boolean {
  if (!content) return false
  return (
    /^(#{1,6})\s/.test(content) ||
    /^([-+*])\s/.test(content) ||
    /^\d+\.\s/.test(content) ||
    /^>\s?/.test(content) ||
    /^```/.test(content) ||
    /^~~~/.test(content) ||
    /^\|/.test(content)
  )
}

function flattenListBlocksForTemplate(blocks: WordBlock[]): WordBlock[] {
  return blocks.flatMap((block) => flattenWordBlock(block, 0))
}

function flattenWordBlock(block: WordBlock, depth: number): WordBlock[] {
  switch (block.type) {
    case 'list':
      return block.items.flatMap((item, index) => {
        const prefix = block.ordered ? `${index + 1}. ` : '• '
        return flattenListItemBlocks(item, prefix, depth)
      })
    case 'blockquote':
      return [
        {
          ...block,
          children: flattenListBlocksForTemplate(block.children),
        },
      ]
    case 'callout':
      return [
        {
          ...block,
          children: flattenListBlocksForTemplate(block.children),
        },
      ]
    case 'table':
    case 'image':
    case 'code':
    case 'math':
    case 'heading':
    case 'paragraph':
      return [block]
  }
}

function flattenListItemBlocks(blocks: WordBlock[], prefix: string, depth: number): WordBlock[] {
  const indent = '\u00A0\u00A0'.repeat(depth)
  const flattened: WordBlock[] = []
  let prefixed = false

  for (const block of blocks) {
    if ((block.type === 'paragraph' || block.type === 'heading') && !prefixed) {
      flattened.push({
        type: 'paragraph',
        text: [{ type: 'text', value: `${indent}${prefix}` }, ...block.text],
        style: block.style,
      })
      prefixed = true
      continue
    }

    if (block.type === 'list') {
      flattened.push(
        ...block.items.flatMap((item, index) => {
          const nestedPrefix = block.ordered ? `${index + 1}. ` : '• '
          return flattenListItemBlocks(item, nestedPrefix, depth + 1)
        }),
      )
      continue
    }

    if (!prefixed) {
      flattened.push({
        type: 'paragraph',
        text: [{ type: 'text', value: `${indent}${prefix}` }],
      })
      prefixed = true
    }
    flattened.push(...flattenWordBlock(block, depth))
  }

  if (!prefixed) {
    flattened.push({
      type: 'paragraph',
      text: [{ type: 'text', value: `${indent}${prefix}` }],
    })
  }

  return flattened
}

function getLastFieldSegment(path: string): string {
  const parts = path.split('.')
  return parts[parts.length - 1] ?? path
}
