export type OutlineItem = {
  id: string
  level: 1 | 2 | 3 | 4 | 5 | 6
  text: string
  line: number
  searchText: string // 用于精确定位的搜索文本
  children?: OutlineItem[] // 子节点
}

export function buildOutlineFromMarkdown(source: string): OutlineItem[] {
  const items: OutlineItem[] = []
  let counter = 0
  let line = 1 // 与 CodeMirror 的 line() 保持一致，从 1 开始
  let inFencedCodeBlock = false // 是否处于 ``` / ~~~ 代码块内部

  // 逐字符遍历，准确计算行号，避免 split 方法的换行符处理差异
  let i = 0
  while (i < source.length) {
    const lineStart = i

    // 找到行尾
    while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
      i++
    }

    const lineContent = source.slice(lineStart, i)
    const trimmed = lineContent.trimStart()

    // 检测 fenced code block（``` 或 ~~~），在代码块内部不解析标题
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      // 遇到 fence 行，切换代码块状态，但本行不参与标题解析
      inFencedCodeBlock = !inFencedCodeBlock
    } else if (!inFencedCodeBlock) {
      const match = /^(#{1,6})\s+(.+)$/.exec(lineContent)

      if (match) {
        const level = match[1].length as 1 | 2 | 3 | 4 | 5 | 6
        const text = match[2].trim()

        items.push({
          id: `h-${level}-${counter++}`,
          level,
          text,
          line: line, // 使用计数器确保与 CodeMirror 行号一致
          searchText: text, // 保存纯文本用于精确查找
        })
      }
    }

    // 处理换行符，更新行号
    if (i < source.length) {
      if (source[i] === '\r' && i + 1 < source.length && source[i + 1] === '\n') {
        i += 2 // Windows CRLF
      } else {
        i++ // Unix LF 或旧版 Mac CR
      }
      line++
    }
  }

  return items
}

/**
 * 将扁平的 outline 列表转换为树形结构
 */
export function buildOutlineTree(items: OutlineItem[]): OutlineItem[] {
  if (items.length === 0) return []

  const result: OutlineItem[] = []
  const stack: OutlineItem[] = []

  for (const item of items) {
    const node = { ...item, children: [] }

    // 如果栈为空，直接添加到结果中
    if (stack.length === 0) {
      stack.push(node)
      result.push(node)
      continue
    }

    // 找到父节点（最后一个 level 小于当前 level 的节点）
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
      stack.pop()
    }

    if (stack.length > 0) {
      // 添加到父节点的 children
      const parent = stack[stack.length - 1]
      if (!parent.children) parent.children = []
      parent.children.push(node)
      stack.push(node)
    } else {
      // 没有父节点，作为根节点
      stack.push(node)
      result.push(node)
    }
  }

  return result
}
