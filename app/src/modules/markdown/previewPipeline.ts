import { extractFrontMatter } from './frontMatter'
import { normalizeLatexDelimiters } from './normalizeLatexDelimiters'
import { replaceTextColorSyntaxWithHtml } from './extensions/colorMark'

export type PreviewBlockChunk = {
  id: string
  startLine: number
  endLine: number
  markdown: string
  signature: string
}

export type PreviewMarkdownResult = {
  processedMarkdown: string
  hasMath: boolean
  containsToc: boolean
  lineCount: number
  blockChunks: PreviewBlockChunk[]
}

const MARKDOWN_BLOCK_RENDER_MIN_LINES = 120
const BLOCK_RENDER_MAX_LINES_PER_CHUNK = 120

function isFenceLine(line: string): boolean {
  return /^\s{0,3}(```|~~~)/.test(line)
}

function isBlockStartLine(line: string): boolean {
  const trimmed = line.trim()
  return (
    /^#{1,6}\s+\S/.test(trimmed) ||
    /^>\s?/.test(trimmed) ||
    /^([-*+]\s+\S|\d+\.\s+\S)/.test(trimmed) ||
    /^(-{3,}|\*{3,}|_{3,})$/.test(trimmed) ||
    /^\|.*\|$/.test(trimmed) ||
    /^(?:<[^!/?][\s\S]*?>|<!--)/.test(trimmed)
  )
}

function containsTocPlaceholder(markdown: string): boolean {
  return markdown.split(/\r?\n/).some((line) => /^\s*\[(?:toc)([^\]]*)?\]\s*$/i.test(line))
}

function hashMarkdownChunk(markdown: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < markdown.length; index += 1) {
    hash ^= markdown.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function getChunkSignature(markdown: string): string {
  return `${markdown.length}:${hashMarkdownChunk(markdown)}`
}

function splitMarkdownIntoBlockChunks(markdown: string): Array<Omit<PreviewBlockChunk, 'id' | 'signature'>> {
  const normalized = markdown.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  if (lines.length === 0) return []

  const chunks: Array<Omit<PreviewBlockChunk, 'id' | 'signature'>> = []
  let startLine = 1
  let inFence = false
  let fenceToken = ''
  let lastBlankLine = 0

  const pushChunk = (endLine: number) => {
    if (endLine < startLine) return
    const chunkMarkdown = lines.slice(startLine - 1, endLine).join('\n').trimEnd()
    if (!chunkMarkdown.trim()) {
      startLine = endLine + 1
      lastBlankLine = 0
      return
    }
    chunks.push({
      startLine,
      endLine,
      markdown: chunkMarkdown,
    })
    startLine = endLine + 1
    lastBlankLine = 0
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const trimmed = line.trim()
    const lineNumber = index + 1

    if (isFenceLine(line)) {
      const currentFence = line.includes('~~~') ? '~~~' : '```'
      if (!inFence) {
        inFence = true
        fenceToken = currentFence
      } else if (fenceToken === currentFence) {
        inFence = false
        fenceToken = ''
      }
    }

    if (inFence) {
      continue
    }

    if (!trimmed) {
      lastBlankLine = lineNumber
      continue
    }

    const currentLength = lineNumber - startLine + 1
    const shouldSplit = (
      lineNumber > startLine &&
      lastBlankLine >= startLine &&
      (isBlockStartLine(line) || currentLength >= BLOCK_RENDER_MAX_LINES_PER_CHUNK)
    )
    if (shouldSplit) {
      pushChunk(lastBlankLine - 1)
    }
  }

  pushChunk(lines.length)
  return chunks
}

function assignStableChunkIds(
  chunks: Array<Omit<PreviewBlockChunk, 'id' | 'signature'>>,
): PreviewBlockChunk[] {
  const signatureCounts = new Map<string, number>()
  return chunks.map((chunk) => {
    const signature = getChunkSignature(chunk.markdown)
    const occurrence = signatureCounts.get(signature) ?? 0
    signatureCounts.set(signature, occurrence + 1)
    return {
      ...chunk,
      id: `${signature}:${occurrence}`,
      signature,
    }
  })
}

export function preparePreviewMarkdown(value: string): PreviewMarkdownResult {
  const bodyMarkdown = extractFrontMatter(value).body
  const processedMarkdown = replaceTextColorSyntaxWithHtml(normalizeLatexDelimiters(bodyMarkdown))
  const lineCount = processedMarkdown.split(/\r?\n/).length
  const containsToc = containsTocPlaceholder(processedMarkdown)
  return {
    processedMarkdown,
    hasMath: /\$/.test(processedMarkdown),
    containsToc,
    lineCount,
    blockChunks:
      lineCount >= MARKDOWN_BLOCK_RENDER_MIN_LINES && !containsToc
        ? assignStableChunkIds(splitMarkdownIntoBlockChunks(processedMarkdown))
        : [],
  }
}
