import type { WebLiteNote } from '../domain/models'

function trimByteOrderMark(input: string): string {
  return input.replace(/^\uFEFF/, '')
}

function stripMarkdownExtension(name: string): string {
  return name.replace(/\.md$/i, '')
}

export function serializeNoteToMarkdown(note: WebLiteNote): string {
  const body = note.content.trim()
  if (!body) return `# ${note.title}\n`
  return `# ${note.title}\n\n${body}\n`
}

export function parseMarkdownToNote(input: {
  fileName: string
  content: string
}): Pick<WebLiteNote, 'title' | 'content'> {
  const normalized = trimByteOrderMark(input.content).replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const firstNonEmptyIndex = lines.findIndex((line) => line.trim())

  if (firstNonEmptyIndex >= 0) {
    const firstLine = lines[firstNonEmptyIndex].trim()
    const headingMatch = firstLine.match(/^#\s+(.+)$/)
    if (headingMatch) {
      const title = headingMatch[1].trim() || stripMarkdownExtension(input.fileName)
      const body = lines
        .slice(firstNonEmptyIndex + 1)
        .join('\n')
        .replace(/^\n+/, '')
        .trim()
      return { title, content: body }
    }
  }

  return {
    title: stripMarkdownExtension(input.fileName) || '导入随笔',
    content: normalized.trim(),
  }
}

export async function readMarkdownFile(file: File): Promise<Pick<WebLiteNote, 'title' | 'content'>> {
  const content = await file.text()
  return parseMarkdownToNote({
    fileName: file.name,
    content,
  })
}

export function downloadNoteMarkdown(note: WebLiteNote): void {
  const blob = new Blob([serializeNoteToMarkdown(note)], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${note.title || 'untitled'}.md`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
