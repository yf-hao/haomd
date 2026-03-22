type Segment = {
  kind: 'text' | 'code'
  value: string
}

export function normalizeLatexDelimiters(markdown: string): string {
  if (!markdown) return markdown

  return splitFencedCodeBlocks(markdown)
    .map((segment) => (segment.kind === 'code' ? segment.value : normalizeTextSegment(segment.value)))
    .join('')
}

function splitFencedCodeBlocks(markdown: string): Segment[] {
  const lines = markdown.match(/[^\n]*\n|[^\n]+/g) ?? []
  const segments: Segment[] = []
  let textBuffer = ''
  let codeBuffer = ''
  let activeFence: { marker: '`' | '~'; minLength: number } | null = null

  const flushText = () => {
    if (textBuffer) {
      segments.push({ kind: 'text', value: textBuffer })
      textBuffer = ''
    }
  }

  const flushCode = () => {
    if (codeBuffer) {
      segments.push({ kind: 'code', value: codeBuffer })
      codeBuffer = ''
    }
  }

  for (const line of lines) {
    const fenceMatch = /^([ \t]*)(`{3,}|~{3,})/.exec(line)
    if (!activeFence && fenceMatch) {
      flushText()
      activeFence = {
        marker: fenceMatch[2][0] as '`' | '~',
        minLength: fenceMatch[2].length,
      }
      codeBuffer += line
      continue
    }

    if (activeFence) {
      codeBuffer += line
      const closeFencePattern = new RegExp(
        `^[ \\t]*${escapeForRegex(activeFence.marker)}{${activeFence.minLength},}[ \\t]*(?:\\n)?$`,
      )
      if (closeFencePattern.test(line)) {
        flushCode()
        activeFence = null
      }
      continue
    }

    textBuffer += line
  }

  if (activeFence) {
    flushCode()
  } else {
    flushText()
  }

  return segments
}

function normalizeTextSegment(text: string): string {
  const parts: string[] = []
  const inlineCodePattern = /(`+)([\s\S]*?)(\1)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = inlineCodePattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(rewriteLatexDelimiters(text.slice(lastIndex, match.index)))
    }
    parts.push(match[0])
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push(rewriteLatexDelimiters(text.slice(lastIndex)))
  }

  return parts.join('')
}

function rewriteLatexDelimiters(text: string): string {
  return text
    .replace(/(?<!\\)\\\[([\s\S]*?)(?<!\\)\\\]/g, (_match, expression: string) => `$$${expression}$$`)
    .replace(/(?<!\\)\\\(([\s\S]*?)(?<!\\)\\\)/g, (_match, expression: string) => `$${expression}$`)
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
