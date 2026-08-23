type SourcePosition = {
  start?: {
    line?: number
  }
  end?: {
    line?: number
  }
}

type SourceLineAnchorOptions = {
  lineOffset?: number
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

function offsetExistingLineAttributes(node: any, lineOffset: number) {
  if (lineOffset === 0 || !node.properties) return

  for (const name of ['data-line-start', 'data-line-end', 'data-source-line']) {
    const value = Number(node.properties[name])
    if (Number.isInteger(value)) {
      node.properties[name] = String(value + lineOffset)
    }
  }
}

function addBlockLineAttributes(node: any, range: { start: number; end: number }, lineOffset: number) {
  if (!BLOCK_TAGS.has(node.tagName)) return

  const properties = ensureProperties(node)
  if (lineOffset !== 0 || properties['data-line-start'] == null) {
    properties['data-line-start'] = String(range.start + lineOffset)
  }
  if (lineOffset !== 0 || properties['data-line-end'] == null) {
    properties['data-line-end'] = String(range.end + lineOffset)
  }
}

function addSingleLineAttribute(
  node: any,
  range: { start: number; end: number },
  insidePre: boolean,
  lineOffset: number,
) {
  if (insidePre || range.start !== range.end) return

  const properties = ensureProperties(node)
  if (lineOffset !== 0 || properties['data-source-line'] == null) {
    properties['data-source-line'] = String(range.start + lineOffset)
  }
}

function createSourceLineSpan(value: string, line: number): any {
  return {
    type: 'element',
    tagName: 'span',
    properties: {
      'data-source-line': String(line),
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

export function rehypeSourceLineAnchors(options: SourceLineAnchorOptions = {}) {
  const lineOffset = options.lineOffset ?? 0

  return function attach(tree: any) {
    const visit = (node: any, insidePre = false): void => {
      if (!node || typeof node !== 'object') return

      if (node.type === 'element') {
        const tagName = typeof node.tagName === 'string' ? node.tagName.toLowerCase() : ''
        const nextInsidePre = insidePre || tagName === 'pre'
        const range = getLineRange(node.position)

        offsetExistingLineAttributes(node, lineOffset)
        if (range) {
          addBlockLineAttributes(node, range, lineOffset)
          if (!UNSAFE_INLINE_PARENT_TAGS.has(tagName)) {
            addSingleLineAttribute(node, range, insidePre, lineOffset)
          }
        }

        if (!Array.isArray(node.children)) return

        const nextChildren: any[] = []
        for (const child of node.children) {
          if (
            child?.type === 'text' &&
            !nextInsidePre &&
            !UNSAFE_INLINE_PARENT_TAGS.has(tagName) &&
            !node.properties?.['data-source-line'] &&
            child.position?.start?.line != null
          ) {
            nextChildren.push(...splitTextNode(child, child.position.start.line + lineOffset))
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
