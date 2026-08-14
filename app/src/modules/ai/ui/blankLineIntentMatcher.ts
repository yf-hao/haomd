const REMOVE_BLANK_LINES_PATTERNS = [
  /^去除空行$/,
  /^删除空行$/,
  /^清除空行$/,
  /^移除空行$/,
  /^去掉空行$/,
  /^去除当前文档空行$/,
  /^删除当前文档空行$/,
  /^清除当前文档空行$/,
  /^移除当前文档空行$/,
  /^去掉当前文档空行$/,
  /^去除当前文档中的空行$/,
  /^删除当前文档中的空行$/,
  /^清除当前文档中的空行$/,
  /^remove blank lines$/,
  /^remove blank lines from current document$/,
  /^delete blank lines$/,
  /^delete blank lines from current document$/,
] as const

function normalizeInput(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[，。！？、；：]+$/u, '')
    .replace(/\s+/g, ' ')
}

export function shouldRemoveBlankLines(input: string): boolean {
  const normalized = normalizeInput(input)
  if (!normalized) return false

  return REMOVE_BLANK_LINES_PATTERNS.some((pattern) => pattern.test(normalized))
}
