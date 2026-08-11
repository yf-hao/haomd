const COLOR_VALUE_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
const COLOR_BLOCK_RE = /\{color:(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}))\}([\s\S]*?)\{\/color\}/g
const COLOR_BLOCK_FULL_RE = /^\{color:(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}))\}([\s\S]*?)\{\/color\}$/i
const BACKGROUND_BLOCK_RE = /\{background:(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}))\}([\s\S]*?)\{\/background\}/g
const BACKGROUND_BLOCK_FULL_RE = /^\{background:(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}))\}([\s\S]*?)\{\/background\}$/i
const STYLE_TOKEN_RE = /\{(\/?)(color|background)(?::(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})))?\}/g

type MdastNode = {
  type: string
  value?: string
  children?: MdastNode[]
  [key: string]: unknown
}

type MdastParent = MdastNode & { children: MdastNode[] }

export type TextColorBlockRange = {
  blockStart: number
  blockEnd: number
  contentStart: number
  contentEnd: number
  color: string
  content: string
}

export type BackgroundColorBlockRange = TextColorBlockRange

export function isSupportedTextColor(value: string | null | undefined): value is string {
  return typeof value === 'string' && COLOR_VALUE_RE.test(value)
}

export function normalizeTextColor(value: string | null | undefined): string | null {
  if (!isSupportedTextColor(value)) return null
  return value.toLowerCase()
}

export function applyTextColorSyntax(text: string, color: string): string | null {
  const normalizedColor = normalizeTextColor(color)
  if (!normalizedColor || !text) return null

  const wrapped = COLOR_BLOCK_FULL_RE.exec(text)
  if (wrapped) {
    return `{color:${normalizedColor}}${wrapped[2]}{/color}`
  }

  return `{color:${normalizedColor}}${text}{/color}`
}

export function clearTextColorSyntax(text: string): string {
  if (!text) return text
  return text.replace(COLOR_BLOCK_RE, (_match, _color, content: string) => content)
}

export function applyBackgroundColorSyntax(text: string, color: string): string | null {
  const normalizedColor = normalizeTextColor(color)
  if (!normalizedColor || !text) return null

  const wrapped = BACKGROUND_BLOCK_FULL_RE.exec(text)
  if (wrapped) {
    return `{background:${normalizedColor}}${wrapped[2]}{/background}`
  }

  return `{background:${normalizedColor}}${text}{/background}`
}

export function clearBackgroundColorSyntax(text: string): string {
  if (!text) return text
  return text.replace(BACKGROUND_BLOCK_RE, (_match, _color, content: string) => content)
}

export function getTextColorAtRange(markdown: string, from: number, to: number): string | null {
  if (!markdown || from >= to) return null

  let matchedColor: string | null = null

  for (const match of markdown.matchAll(COLOR_BLOCK_RE)) {
    const index = match.index ?? -1
    if (index < 0) continue
    const fullMatch = match[0]
    const color = normalizeTextColor(match[1])
    if (!color) continue

    const openTag = `{color:${match[1]}}`
    const contentStart = index + openTag.length
    const contentEnd = index + fullMatch.length - '{/color}'.length
    if (from < contentStart || to > contentEnd) continue

    if (matchedColor && matchedColor !== color) return null
    matchedColor = color
  }

  return matchedColor
}

export function getEnclosingTextColorBlock(markdown: string, from: number, to: number): TextColorBlockRange | null {
  return getEnclosingColorBlock(markdown, from, to, COLOR_BLOCK_RE, 'color')
}

export function getEnclosingBackgroundColorBlock(markdown: string, from: number, to: number): BackgroundColorBlockRange | null {
  return getEnclosingColorBlock(markdown, from, to, BACKGROUND_BLOCK_RE, 'background')
}

function getEnclosingColorBlock(
  markdown: string,
  from: number,
  to: number,
  pattern: RegExp,
  tag: 'color' | 'background',
): TextColorBlockRange | null {
  if (!markdown || from >= to) return null

  for (const match of markdown.matchAll(pattern)) {
    const index = match.index ?? -1
    if (index < 0) continue

    const color = normalizeTextColor(match[1])
    if (!color) continue

    const fullMatch = match[0]
    const openTag = `{${tag}:${match[1]}}`
    const contentStart = index + openTag.length
    const contentEnd = index + fullMatch.length - `{/${tag}}`.length
    if (from < contentStart || to > contentEnd) continue

    return {
      blockStart: index,
      blockEnd: index + fullMatch.length,
      contentStart,
      contentEnd,
      color,
      content: match[2] ?? '',
    }
  }

  return null
}

export function replaceTextColorSyntaxWithHtml(markdown: string): string {
  if (!markdown || (!markdown.includes('{color:') && !markdown.includes('{background:'))) return markdown
  return renderStyledMarkdown(markdown)
}

function renderStyledMarkdown(markdown: string): string {
  const parts = markdown.split(/(\r?\n)/)
  let output = ''
  let plainMarkdown = ''
  let fence: { marker: '`' | '~'; length: number } | null = null

  const flushPlainMarkdown = () => {
    if (!plainMarkdown) return
    output += renderStyledHtml(plainMarkdown).value
    plainMarkdown = ''
  }

  for (const part of parts) {
    const line = part.replace(/\r?\n$/, '')
    const fenceMatch = /^( {0,3})(`{3,}|~{3,})(?:[^`]*)$/.exec(line)

    if (fence) {
      output += part
      if (
        fenceMatch &&
        fenceMatch[2][0] === fence.marker &&
        fenceMatch[2].length >= fence.length
      ) {
        fence = null
      }
      continue
    }

    if (fenceMatch) {
      flushPlainMarkdown()
      output += part
      fence = {
        marker: fenceMatch[2][0] as '`' | '~',
        length: fenceMatch[2].length,
      }
      continue
    }

    plainMarkdown += part
  }

  flushPlainMarkdown()
  return output
}

export function remarkTextColorSyntax(this: { data: () => Record<string, unknown> }) {
  const data = this.data()
  const toMarkdownExtensions = (data.toMarkdownExtensions ??= []) as Array<Record<string, unknown>>
  toMarkdownExtensions.push({
    handlers: {
      textColor(node: MdastNode, _parent: MdastNode | undefined, state: any, info: any) {
        const color = normalizeTextColor(String(node.color ?? ''))
        const content =
          typeof node.value === 'string'
            ? node.value
            : state.containerPhrasing(node, info)
        if (!color) return content
        return `{color:${color}}${content}{/color}`
      },
      backgroundColor(node: MdastNode, _parent: MdastNode | undefined, state: any, info: any) {
        const color = normalizeTextColor(String(node.color ?? ''))
        const content =
          typeof node.value === 'string'
            ? node.value
            : state.containerPhrasing(node, info)
        if (!color) return content
        return `{background:${color}}${content}{/background}`
      },
    },
  })

  return (tree: MdastNode) => {
    transformTextColorTree(tree)
  }
}

function transformTextColorTree(node: MdastNode): void {
  if (!Array.isArray(node.children)) return

  const nextChildren: MdastNode[] = []
  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string' && (child.value.includes('{color:') || child.value.includes('{background:'))) {
      nextChildren.push(...splitTextColorNodes(child.value))
      continue
    }

    if (child.type !== 'html' && child.type !== 'code' && child.type !== 'inlineCode' && child.type !== 'math' && child.type !== 'inlineMath') {
      transformTextColorTree(child)
    }
    nextChildren.push(child)
  }

  ;(node as MdastParent).children = nextChildren
}

function splitTextColorNodes(value: string): MdastNode[] {
  return parseStyledNodes(value).nodes
}

function parseStyledNodes(
  value: string,
  start = 0,
  closingTag?: 'color' | 'background',
): { nodes: MdastNode[]; end: number; closed: boolean } {
  const nodes: MdastNode[] = []
  let cursor = start
  STYLE_TOKEN_RE.lastIndex = start

  for (let match = STYLE_TOKEN_RE.exec(value); match; match = STYLE_TOKEN_RE.exec(value)) {
    const index = match.index
    const isClosing = match[1] === '/'
    const tag = match[2] as 'color' | 'background'
    const color = normalizeTextColor(match[3])

    if (isClosing) {
      if (tag === closingTag) {
        if (index > cursor) nodes.push({ type: 'text', value: value.slice(cursor, index) })
        return { nodes, end: STYLE_TOKEN_RE.lastIndex, closed: true }
      }
      continue
    }

    if (!color) continue
    if (index > cursor) nodes.push({ type: 'text', value: value.slice(cursor, index) })
    const inner = parseStyledNodes(value, STYLE_TOKEN_RE.lastIndex, tag)
    if (!inner.closed) {
      nodes.push({ type: 'text', value: value.slice(index) })
      return { nodes, end: value.length, closed: false }
    }
    if (inner.nodes.length > 0) {
      nodes.push({
        type: tag === 'color' ? 'textColor' : 'backgroundColor',
        color,
        children: inner.nodes,
      })
    }
    cursor = inner.end
    STYLE_TOKEN_RE.lastIndex = cursor
  }

  if (cursor < value.length) nodes.push({ type: 'text', value: value.slice(cursor) })
  return { nodes, end: value.length, closed: false }
}

function renderStyledHtml(
  value: string,
  start = 0,
  closingTag?: 'color' | 'background',
): { value: string; end: number; closed: boolean } {
  let output = ''
  let cursor = start
  STYLE_TOKEN_RE.lastIndex = start

  for (let match = STYLE_TOKEN_RE.exec(value); match; match = STYLE_TOKEN_RE.exec(value)) {
    const index = match.index
    const isClosing = match[1] === '/'
    const tag = match[2] as 'color' | 'background'
    const color = normalizeTextColor(match[3])

    if (isClosing) {
      if (tag === closingTag) {
        output += escapeHtml(value.slice(cursor, index))
        return { value: output, end: STYLE_TOKEN_RE.lastIndex, closed: true }
      }
      continue
    }

    if (!color) continue
    output += escapeHtml(value.slice(cursor, index))
    const inner = renderStyledHtml(value, STYLE_TOKEN_RE.lastIndex, tag)
    if (!inner.closed) {
      output += escapeHtml(value.slice(index))
      return { value: output, end: value.length, closed: false }
    }
    const attr = tag === 'color' ? 'data-text-color' : 'data-background-color'
    const style = tag === 'color' ? `color:${color}` : `background-color:${color}`
    output += `<span ${attr}="${color}" style="${style}">${inner.value}</span>`
    cursor = inner.end
    STYLE_TOKEN_RE.lastIndex = cursor
  }

  output += escapeHtml(value.slice(cursor))
  return { value: output, end: value.length, closed: false }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
