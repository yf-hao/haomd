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
  hasRawHtml: boolean
  containsToc: boolean
  sourceLineOffset: number
  lineCount: number
  blockChunks: PreviewBlockChunk[]
}

const MARKDOWN_BLOCK_RENDER_MIN_LINES = 60
const MARKDOWN_BLOCK_RENDER_MIN_CHARS = 2000
const BLOCK_RENDER_MAX_LINES_PER_CHUNK = 120
const PREVIEW_RESULT_CACHE_LIMIT = 8
const PREVIEW_RESULT_CACHE_MAX_CHARS = 1_000_000

const previewResultCache = new Map<string, PreviewMarkdownResult>()
let previewResultCacheChars = 0

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

function containsRawHtml(markdown: string): boolean {
  return /<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>/.test(markdown)
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
      pushChunk(lastBlankLine)
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
  const cached = previewResultCache.get(value)
  if (cached) {
    previewResultCache.delete(value)
    previewResultCache.set(value, cached)
    return cached
  }

  const document = extractFrontMatter(value)
  const bodyMarkdown = document.body
  const sourceLineOffset = document.hasFrontMatter
    ? document.rawBlock.split(/\r?\n/).length - 1
    : 0
  const processedMarkdown = replaceTextColorSyntaxWithHtml(normalizeLatexDelimiters(bodyMarkdown))
  const lineCount = processedMarkdown.split(/\r?\n/).length
  const containsToc = containsTocPlaceholder(processedMarkdown)
  const shouldBuildChunks =
    !containsToc &&
    (lineCount >= MARKDOWN_BLOCK_RENDER_MIN_LINES || processedMarkdown.length >= MARKDOWN_BLOCK_RENDER_MIN_CHARS)
  const chunks = shouldBuildChunks
    ? splitMarkdownIntoBlockChunks(processedMarkdown)
    : []
  const blockChunks = chunks.length > 1 ? assignStableChunkIds(chunks) : []
  const result: PreviewMarkdownResult = {
    processedMarkdown,
    hasMath: /\$/.test(processedMarkdown),
    hasRawHtml: containsRawHtml(processedMarkdown),
    containsToc,
    sourceLineOffset,
    lineCount,
    blockChunks,
  }

  const previous = previewResultCache.get(value)
  if (previous) {
    previewResultCacheChars -= previous.processedMarkdown.length
  }
  previewResultCache.set(value, result)
  previewResultCacheChars += result.processedMarkdown.length
  while (
    previewResultCache.size > PREVIEW_RESULT_CACHE_LIMIT ||
    previewResultCacheChars > PREVIEW_RESULT_CACHE_MAX_CHARS
  ) {
    const oldestKey = previewResultCache.keys().next().value
    if (oldestKey === undefined) break
    const oldest = previewResultCache.get(oldestKey)
    previewResultCache.delete(oldestKey)
    previewResultCacheChars -= oldest?.processedMarkdown.length ?? 0
  }

  return result
}
