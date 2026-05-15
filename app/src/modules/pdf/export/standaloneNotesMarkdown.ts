import type { PdfNote } from '../types/note'

function sortNotes(notes: readonly PdfNote[]) {
  return [...notes].sort((left, right) => {
    const leftPage = left.page ?? Number.MAX_SAFE_INTEGER
    const rightPage = right.page ?? Number.MAX_SAFE_INTEGER
    if (leftPage !== rightPage) return leftPage - rightPage
    return left.updatedAt - right.updatedAt
  })
}

function formatDateTime(timestamp: number) {
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function toBlockQuote(input: string) {
  return input
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}

export function buildStandaloneNotesMarkdown(input: {
  fileName: string
  notes: readonly PdfNote[]
  exportedAt?: number
}) {
  const exportedAt = input.exportedAt ?? Date.now()
  const sortedNotes = sortNotes(input.notes)
  const lines: string[] = [
    '# PDF 独立笔记',
    `文件：${input.fileName}`,
    `导出时间：${formatDateTime(exportedAt)}`,
    '',
  ]

  if (sortedNotes.length === 0) {
    lines.push('暂无独立笔记。', '')
    return lines.join('\n')
  }

  let currentPageKey: string | null = null
  let noteIndex = 0

  for (const note of sortedNotes) {
    const pageKey = note.page ? `page-${note.page}` : 'unlinked'
    if (pageKey !== currentPageKey) {
      currentPageKey = pageKey
      lines.push(note.page ? `## 第 ${note.page} 页` : '## 未关联页码', '')
      noteIndex = 0
    }

    noteIndex += 1
    lines.push(`### 笔记 ${noteIndex}`, '')

    if (note.quote?.trim()) {
      lines.push('摘录：')
      lines.push(toBlockQuote(note.quote.trim()))
      lines.push('')
    }

    lines.push('内容：')
    lines.push(note.text.trim())
    lines.push('')
  }

  return lines.join('\n')
}

export function buildStandaloneNotesFileName(fileName: string) {
  const baseName = fileName.replace(/\.pdf$/i, '') || 'document'
  return `${baseName}-notes.md`
}
