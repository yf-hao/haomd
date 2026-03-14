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

    // 4. 构造 TOC list AST（为二级标题添加可折叠结构）
    const createLinkNode = (h: { id: string; text: string; node: any }) => {
      const pos = (h.node as any)?.position
      const startLine = pos?.start?.line

      const hProps: any = {
        href: `#${h.id}`,
      }
      if (typeof startLine === 'number') {
        hProps['data-target-line'] = String(startLine)
      }

      return {
        type: 'link',
        url: `#${h.id}`,
        data: {
          hProperties: hProps,
        },
        children: [
          {
            type: 'text',
            value: h.text || '',
          },
        ],
      }
    }

    const listChildren: any[] = []

    for (let i = 0; i < tocHeadings.length; i += 1) {
      const h = tocHeadings[i]

      // 仅当当前是二级标题时，尝试把后续更深层级（>2）的标题归为它的子项
      if (h.depth === 2) {
        const childHeadings: typeof tocHeadings = []
        let j = i + 1
        while (j < tocHeadings.length && tocHeadings[j].depth > 2) {
          childHeadings.push(tocHeadings[j])
          j += 1
        }

        if (childHeadings.length > 0) {
          // 有子项：构造一个包含 <details> 的 listItem，使子标题可折叠
          const childListItems = childHeadings.map((ch) => ({
            type: 'listItem',
            spread: false,
            data: {
              hProperties: {
                className: ['md-toc-item', `md-toc-level-${ch.depth}`],
              },
            },
            children: [
              {
                type: 'paragraph',
                children: [createLinkNode(ch)],
              },
            ],
          }))

          const nestedList = {
            type: 'list',
            ordered: false,
            spread: false,
            children: childListItems,
          }

          listChildren.push({
            type: 'listItem',
            spread: false,
            data: {
              hProperties: {
                className: ['md-toc-item', `md-toc-level-${h.depth}`],
              },
            },
            children: [
              {
                // 使用 details + summary 包裹当前二级标题及其子项
                type: 'paragraph',
                data: {
                  hName: 'details',
                  hProperties: {},
                },
                children: [
                  {
                    type: 'paragraph',
                    data: {
                      hName: 'summary',
                    },
                    children: [createLinkNode(h)],
                  },
                  nestedList,
                ],
              },
            ],
          })

          // 跳过已经作为子项处理的 heading
          i = j - 1
          continue
        }
      }

      // 默认分支：没有子项的二级标题，或其他层级，保持原有的平铺结构
      listChildren.push({
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
            children: [createLinkNode(h)],
          },
        ],
      })
    }

    const tocList: any = {
      type: 'list',
      ordered: false,
      spread: false,
      children: listChildren,
    }

    const tocDetailsNode = {
      type: 'paragraph',
      data: {
        hName: 'details',
        hProperties: {
          className: ['md-toc-container'],
          open: true,
        },
      },
      children: [
        {
          type: 'paragraph',
          data: {
            hName: 'summary',
            hProperties: { className: ['md-toc-summary'] },
          },
          children: [{ type: 'text', value: '目录' }],
        },
        {
          ...tocList,
          data: {
            ...(tocList as any).data,
            hProperties: {
              ...((tocList as any).data?.hProperties ?? {}),
              className: ['md-toc-root'],
            },
          },
        },
      ],
    }

    // 5. 用 details+summary+list 替换原来的 [TOC] 段落
    children.splice(tocIndex, 1, tocDetailsNode)
  }
}
