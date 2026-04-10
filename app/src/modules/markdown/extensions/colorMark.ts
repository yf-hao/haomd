const COLOR_VALUE_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
const COLOR_BLOCK_RE = /\{color:(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}))\}([\s\S]*?)\{\/color\}/g
const COLOR_BLOCK_FULL_RE = /^\{color:(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}))\}([\s\S]*?)\{\/color\}$/i

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
  if (!markdown || from >= to) return null

  for (const match of markdown.matchAll(COLOR_BLOCK_RE)) {
    const index = match.index ?? -1
    if (index < 0) continue

    const color = normalizeTextColor(match[1])
    if (!color) continue

    const fullMatch = match[0]
    const openTag = `{color:${match[1]}}`
    const contentStart = index + openTag.length
    const contentEnd = index + fullMatch.length - '{/color}'.length
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
  if (!markdown || !markdown.includes('{color:')) return markdown
  return markdown.replace(COLOR_BLOCK_RE, (_match, color: string, content: string) => {
    const normalizedColor = normalizeTextColor(color)
    if (!normalizedColor) return content
    return `<span data-text-color="${normalizedColor}" style="color:${normalizedColor}">${escapeHtml(content)}</span>`
  })
}

export function remarkTextColorSyntax(this: { data: () => Record<string, unknown> }) {
  // eslint-disable-next-line unicorn/no-this-assignment
  const self = this
  const data = self.data()
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
    if (child.type === 'text' && typeof child.value === 'string' && child.value.includes('{color:')) {
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
  const nodes: MdastNode[] = []
  let lastIndex = 0

  for (const match of value.matchAll(COLOR_BLOCK_RE)) {
    const index = match.index ?? 0
    if (index > lastIndex) {
      nodes.push({ type: 'text', value: value.slice(lastIndex, index) })
    }

    const color = normalizeTextColor(match[1])
    const content = match[2] ?? ''
    if (!color) {
      nodes.push({ type: 'text', value: match[0] })
    } else if (content) {
      nodes.push({
        type: 'textColor',
        color,
        children: [{ type: 'text', value: content }],
      })
    }

    lastIndex = index + match[0].length
  }

  if (lastIndex < value.length) {
    nodes.push({ type: 'text', value: value.slice(lastIndex) })
  }

  return nodes.length > 0 ? nodes : [{ type: 'text', value }]
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
