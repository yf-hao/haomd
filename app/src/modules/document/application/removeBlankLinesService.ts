export const REMOVE_BLANK_LINES_PATTERN = '(?:^|(?<=\\n))[ \\t]*(?:\\r\\n|\\n)'

function createRemoveBlankLinesRegex(): RegExp {
  return new RegExp(REMOVE_BLANK_LINES_PATTERN, 'g')
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
