const LOCAL_CREATE_DIRECTORY_PATTERNS = [
  /^创建(?:一个)?名为\s*(.+?)\s*的(?:目录|文件夹)$/i,
  /^创建(?:一个)?叫做\s*(.+?)\s*的(?:目录|文件夹)$/i,
  /^新建(?:一个)?名为\s*(.+?)\s*的(?:目录|文件夹)$/i,
  /^新建(?:一个)?叫做\s*(.+?)\s*的(?:目录|文件夹)$/i,
  /^创建\s*(.+?)\s*(?:目录|文件夹)$/i,
  /^新建\s*(.+?)\s*(?:目录|文件夹)$/i,
  /^create\s+(?:a\s+)?(?:folder|directory)\s+named\s+(.+)$/i,
  /^create\s+(?:folder|directory)\s+(.+)$/i,
] as const

function stripWrappingQuotes(input: string): string {
  const trimmed = input.trim()
  return trimmed.replace(/^["'“”‘’](.+)["'“”‘’]$/u, '$1').trim()
}

export function matchCreateDirectoryUnderSelection(input: string): { directoryName: string } | null {
  const trimmed = input.trim()
  if (!trimmed) {
    return null
  }

  for (const pattern of LOCAL_CREATE_DIRECTORY_PATTERNS) {
    const match = trimmed.match(pattern)
    if (!match?.[1]) {
      continue
    }
    const directoryName = stripWrappingQuotes(match[1])
    if (!directoryName) {
      return null
    }
    return { directoryName }
  }

  return null
}
