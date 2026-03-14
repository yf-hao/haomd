// remark 插件：将文档中的第一个独立行 [TOC] 占位符替换为目录列表
// 目录根据文档内的 heading 节点生成，生成形如：
// - [标题 1](#...)
//   - [标题 1.1](#...)
//
// 设计目标：
// - 仅处理第一个 [TOC] / [toc] / [TOC depth=3] 占位符
// - 支持 depth 参数（最大 heading 层级），默认 3
// - 无 heading 或未找到 [TOC] 时保持 AST 不变
// - 不依赖具体的 mdast 类型定义，使用 any，避免额外依赖

function getPlainText(node: any): string {
  if (!node || typeof node !== 'object') return ''

  if (typeof node.value === 'string') {
    return node.value
  }

  const children = (node as any).children
  if (!Array.isArray(children)) return ''

  let text = ''
  for (const child of children) {
    text += getPlainText(child)
  }
  return text
}

function slugify(text: string, used: Record<string, number>): string {
  const baseRaw = text.trim().toLowerCase()
  // 将空白压缩为单个连字符
  let base = baseRaw.replace(/\s+/g, '-').replace(/[`~!@#$%^&*()\[\]{};:'",.<>/?\\|+=]/g, '')
  if (!base) {
    base = 'heading'
  }

  const count = used[base] ?? 0
  used[base] = count + 1
  if (count === 0) return base
  return `${base}-${count}`
}

function parseTocConfigFromText(raw: string): { depth: number } | null {
  const text = raw.trim()
  // 只接受形如 [TOC] / [toc] / [TOC depth=3] 这样的模式
  if (!/^\[(toc)([^\]]*)\]$/i.test(text)) return null

  let depth = 3
  const m = /depth\s*=\s*(\d+)/i.exec(text)
  if (m) {
    const parsed = Number(m[1])
    if (!Number.isNaN(parsed)) {
      depth = parsed
    }
  }

  if (depth < 1) depth = 1
  if (depth > 6) depth = 6

  return { depth }
}

export function remarkToc() {
  return function transformer(tree: any) {
    if (!tree || typeof tree !== 'object') return

    const root: any = tree
    const children: any[] = Array.isArray(root.children) ? root.children : []
    if (!children.length) return

    // 1. 查找第一个 [TOC] 段落
    let tocIndex = -1
    let depth = 3

    for (let i = 0; i < children.length; i += 1) {
      const node = children[i]
      if (!node || node.type !== 'paragraph') continue

      const paraText = getPlainText(node)
      const config = parseTocConfigFromText(paraText)
      if (!config) continue

      tocIndex = i
      depth = config.depth
      break
    }

    if (tocIndex === -1) return

    // 2. 收集所有 heading
    type HeadingItem = {
      depth: number
      text: string
      node: any
    }

    const headings: HeadingItem[] = []

    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return

      if (node.type === 'heading' && typeof node.depth === 'number') {
        const headingDepth = node.depth as number
        if (headingDepth >= 1 && headingDepth <= depth) {
          const text = getPlainText(node) || ''
          headings.push({ depth: headingDepth, text, node })
        }
      }

      const children = (node as any).children
      if (Array.isArray(children)) {
        for (const child of children) walk(child)
      }
    }

    walk(tree)

    if (!headings.length) {
      // 没有任何标题时，直接移除 [TOC] 段落
      children.splice(tocIndex, 1)
      return
    }

    // 3. 为每个 heading 生成唯一的 id
    const used: Record<string, number> = Object.create(null)

    const tocHeadings = headings.map((h) => {
      const id = slugify(h.text || '', used)

      // 尝试把 id 写回原 heading 节点的 data.hProperties，以便后续 rehype/React 使用
      if (!h.node.data) h.node.data = {}
      if (!h.node.data.hProperties) h.node.data.hProperties = {}
      if (!h.node.data.hProperties.id) {
        h.node.data.hProperties.id = id
      }

      return { ...h, id }
    })

    // 4. 构造 TOC list AST
    const listChildren = tocHeadings.map((h) => ({
      type: 'listItem',
      spread: false,
      data: {
        hProperties: {
          className: ['md-toc-item', `md-toc-level-${h.depth}`],
        },
      },
      children: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'link',
              url: `#${h.id}`,
              data: {
                hProperties: {
                  href: `#${h.id}`,
                },
              },
              children: [
                {
                  type: 'text',
                  value: h.text || '',
                },
              ],
            },
          ],
        },
      ],
    }))

    const tocList = {
      type: 'list',
      ordered: false,
      spread: false,
      children: listChildren,
    }

    // 5. 用 list 替换原来的 [TOC] 段落
    children.splice(tocIndex, 1, tocList)
  }
}
