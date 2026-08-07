export const SOURCE_LINE_ATTRIBUTE = 'data-source-line-local'
export const SOURCE_LINE_START_ATTRIBUTE = 'data-line-start-local'
export const SOURCE_LINE_END_ATTRIBUTE = 'data-line-end-local'

type SourcePosition = {
  start?: {
    line?: number
  }
  end?: {
    line?: number
  }
}

const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
])

const UNSAFE_INLINE_PARENT_TAGS = new Set(['script', 'style', 'svg', 'template', 'textarea', 'title'])

function getLineRange(position: SourcePosition | undefined): { start: number; end: number } | null {
  const start = position?.start?.line
  if (typeof start !== 'number') return null
  const end = position?.end?.line ?? start
  return { start, end: Math.max(start, end) }
}

function ensureProperties(node: any): Record<string, any> {
  if (!node.properties) node.properties = {}
  return node.properties
}

function addBlockLineAttributes(node: any, range: { start: number; end: number }) {
  if (!BLOCK_TAGS.has(node.tagName)) return

  const properties = ensureProperties(node)
  properties[SOURCE_LINE_START_ATTRIBUTE] = String(range.start)
  properties[SOURCE_LINE_END_ATTRIBUTE] = String(range.end)
}

function addSingleLineAttribute(node: any, range: { start: number; end: number }, insidePre: boolean) {
  if (insidePre || range.start !== range.end) return

  const properties = ensureProperties(node)
  properties[SOURCE_LINE_ATTRIBUTE] = String(range.start)
}

function createSourceLineSpan(value: string, line: number): any {
  return {
    type: 'element',
    tagName: 'span',
    properties: {
      [SOURCE_LINE_ATTRIBUTE]: String(line),
    },
    children: [{ type: 'text', value }],
  }
}

function splitTextNode(node: any, line: number): any[] {
  if (!node.value || typeof node.value !== 'string' || node.value.trim().length === 0) {
    return [node]
  }

  const segments = node.value.split(/(\r?\n)/)
  const nextChildren: any[] = []
  let currentLine = line

  for (const segment of segments) {
    if (/^\r?\n$/.test(segment)) {
      nextChildren.push({ type: 'text', value: segment })
      currentLine += 1
      continue
    }
    if (segment.length > 0 && segment.trim().length > 0) {
      nextChildren.push(createSourceLineSpan(segment, currentLine))
    } else if (segment.length > 0) {
      nextChildren.push({ type: 'text', value: segment })
    }
  }

  return nextChildren
}

export function rehypeSourceLineAnchors() {
  return function attach(tree: any) {
    const visit = (node: any, insidePre = false): void => {
      if (!node || typeof node !== 'object') return

      if (node.type === 'element') {
        const tagName = typeof node.tagName === 'string' ? node.tagName.toLowerCase() : ''
        const nextInsidePre = insidePre || tagName === 'pre'
        const range = getLineRange(node.position)

        if (range) {
          addBlockLineAttributes(node, range)
          if (!UNSAFE_INLINE_PARENT_TAGS.has(tagName)) {
            addSingleLineAttribute(node, range, insidePre)
          }
        }

        if (!Array.isArray(node.children)) return

        const nextChildren: any[] = []
        for (const child of node.children) {
          if (
            child?.type === 'text' &&
            !nextInsidePre &&
            !UNSAFE_INLINE_PARENT_TAGS.has(tagName) &&
            !node.properties?.[SOURCE_LINE_ATTRIBUTE] &&
            child.position?.start?.line != null
          ) {
            nextChildren.push(...splitTextNode(child, child.position.start.line))
            continue
          }

          visit(child, nextInsidePre)
          nextChildren.push(child)
        }
        node.children = nextChildren
        return
      }

      if (Array.isArray(node.children)) {
        for (const child of node.children) {
          visit(child, insidePre)
        }
      }
    }

    visit(tree)
  }
}
