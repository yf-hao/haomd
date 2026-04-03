export function extractFrontMatter(markdown: string): {
  frontMatter: Record<string, string>
  body: string
  rawBlock: string
  rawContent: string
  hasFrontMatter: boolean
} {
  const normalized = markdown.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) {
    return {
      frontMatter: {},
      body: normalized,
      rawBlock: '',
      rawContent: '',
      hasFrontMatter: false,
    }
  }

  const endIndex = normalized.indexOf('\n---\n', 4)
  if (endIndex < 0) {
    return {
      frontMatter: {},
      body: normalized,
      rawBlock: '',
      rawContent: '',
      hasFrontMatter: false,
    }
  }

  const rawFrontMatter = normalized.slice(4, endIndex)
  const rawBlock = normalized.slice(0, endIndex + 5)
  const body = normalized.slice(endIndex + 5)
  const frontMatter: Record<string, string> = {}

  for (const line of rawFrontMatter.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separatorIndex = trimmed.indexOf(':')
    if (separatorIndex < 0) continue
    const key = trimmed.slice(0, separatorIndex).trim()
    const value = trimmed.slice(separatorIndex + 1).trim()
    if (!key) continue
    frontMatter[key] = stripWrappingQuotes(value)
  }

  return {
    frontMatter,
    body,
    rawBlock,
    rawContent: rawFrontMatter,
    hasFrontMatter: true,
  }
}

export function composeMarkdownWithFrontMatter(frontMatterBlock: string | null | undefined, body: string): string {
  const normalizedBody = body.replace(/\r\n/g, '\n')
  if (!frontMatterBlock) {
    return normalizedBody
  }
  return `${frontMatterBlock.replace(/\r\n/g, '\n')}${normalizedBody}`
}

function stripWrappingQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}
