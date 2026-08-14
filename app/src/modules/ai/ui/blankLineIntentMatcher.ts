import type { RemoveBlankLinesScope } from '../../document/application/removeBlankLinesService'

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

const REMOVE_TABLE_CODE_GAP_PATTERNS = [
  /^删除表格与代码块之间的空行$/,
  /^去除表格与代码块之间的空行$/,
  /^清除表格与代码块之间的空行$/,
  /^删除表格和代码块之间的空行$/,
  /^去除表格和代码块之间的空行$/,
  /^删除 table 与 code 之间的空行$/,
  /^去除 table 与 code 之间的空行$/,
  /^remove blank lines between table and code$/,
] as const

function normalizeInput(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[，。！？、；：]+$/u, '')
    .replace(/\s+/g, ' ')
}

export function matchRemoveBlankLinesScope(input: string): RemoveBlankLinesScope | null {
  const normalized = normalizeInput(input)
  if (!normalized) return null

  if (REMOVE_TABLE_CODE_GAP_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return 'table_code_gap'
  }
  if (REMOVE_BLANK_LINES_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return 'all'
  }
  return null
}

export function shouldRemoveBlankLines(input: string): boolean {
  return matchRemoveBlankLinesScope(input) !== null
}
