const LOCAL_RENAME_CURRENT_DOCUMENT_PATTERNS = [
  /^重命名为\s+(.+)$/i,
  /^把当前文档重命名为\s+(.+)$/i,
  /^把当前文件重命名为\s+(.+)$/i,
  /^rename to\s+(.+)$/i,
  /^rename current document to\s+(.+)$/i,
  /^rename current file to\s+(.+)$/i,
] as const

function stripWrappingQuotes(input: string): string {
  const trimmed = input.trim()
  return trimmed.replace(/^["'“”‘’](.+)["'“”‘’]$/u, '$1').trim()
}

export function matchRenameCurrentDocument(input: string): { fileName: string } | null {
  const trimmed = input.trim()
  if (!trimmed) {
    return null
  }

  for (const pattern of LOCAL_RENAME_CURRENT_DOCUMENT_PATTERNS) {
    const match = trimmed.match(pattern)
    if (!match?.[1]) {
      continue
    }
    const fileName = stripWrappingQuotes(match[1])
    if (!fileName) {
      return null
    }
    return { fileName }
  }

  return null
}
