export type OutlineItem = {
  id: string
  level: 1 | 2 | 3 | 4 | 5 | 6
  text: string
  line: number
  searchText: string // 用于精确定位的搜索文本
}

export function buildOutlineFromMarkdown(source: string): OutlineItem[] {
  const items: OutlineItem[] = []
  let counter = 0
  let line = 1 // 与 CodeMirror 的 line() 保持一致，从 1 开始

  // 逐字符遍历，准确计算行号，避免 split 方法的换行符处理差异
  let i = 0
  while (i < source.length) {
    const lineStart = i

    // 找到行尾
    while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
      i++
    }

    const lineContent = source.slice(lineStart, i)
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
