export const REMOVE_BLANK_LINES_PATTERN = '(?:^|(?<=\\n))[ \\t]*(?:\\r\\n|\\n)'

export type RemoveBlankLinesScope = 'all' | 'table_code_gap'

function createRemoveBlankLinesRegex(): RegExp {
  return new RegExp(REMOVE_BLANK_LINES_PATTERN, 'g')
}

function isBlankLine(line: string): boolean {
  return /^[ \t]*$/.test(line)
}

function getFence(line: string): { marker: '`' | '~'; length: number } | null {
  const match = line.match(/^\s{0,3}(`{3,}|~{3,})/)
  if (!match) return null
  return {
    marker: match[1][0] as '`' | '~',
    length: match[1].length,
  }
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return false
  const hasLeadingPipe = trimmed.startsWith('|')
  const hasTrailingPipe = trimmed.endsWith('|')
  const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|')
  return (
    (cells.length >= 2 || (hasLeadingPipe && hasTrailingPipe)) &&
    cells.some((cell) => cell.trim() !== '')
  )
}

function isTableDelimiter(line: string): boolean {
  if (!isTableRow(line)) return false
  const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|')
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
}

function isTableBlockEndingAt(lines: string[], endIndex: number): boolean {
  if (endIndex < 0 || !isTableRow(lines[endIndex])) return false

  let cursor = endIndex
  let hasDelimiter = false
  while (cursor >= 0 && isTableRow(lines[cursor])) {
    hasDelimiter = hasDelimiter || isTableDelimiter(lines[cursor])
    cursor -= 1
  }
  return hasDelimiter
}

export type RemoveBlankLinesResult = {
  content: string
  removedCount: number
}

export function removeBlankLines(markdown: string): RemoveBlankLinesResult {
  const matches = markdown.match(createRemoveBlankLinesRegex()) ?? []

  return {
    content: markdown.replace(createRemoveBlankLinesRegex(), ''),
    removedCount: matches.length,
  }
}

export function removeTableCodeGapBlankLines(markdown: string): RemoveBlankLinesResult {
  const newline = markdown.includes('\r\n') ? '\r\n' : '\n'
  const lines = markdown.split(/\r\n|\n/)
  const removedIndexes = new Set<number>()
  let activeFence: { marker: '`' | '~'; length: number } | null = null

  for (let index = 0; index < lines.length; index += 1) {
    const fence = getFence(lines[index])
    if (activeFence) {
      if (
        fence &&
        fence.marker === activeFence.marker &&
        fence.length >= activeFence.length
      ) {
        activeFence = null
      }
      continue
    }
    if (!fence) continue

    let gapStart = index
    while (gapStart > 0 && isBlankLine(lines[gapStart - 1])) {
      gapStart -= 1
    }
    if (gapStart < index && isTableBlockEndingAt(lines, gapStart - 1)) {
      for (let gapIndex = gapStart; gapIndex < index; gapIndex += 1) {
        removedIndexes.add(gapIndex)
      }
    }
    activeFence = fence
  }

  if (removedIndexes.size === 0) {
    return { content: markdown, removedCount: 0 }
  }

  return {
    content: lines.filter((_line, index) => !removedIndexes.has(index)).join(newline),
    removedCount: removedIndexes.size,
  }
}
