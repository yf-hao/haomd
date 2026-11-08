import type { PreviewBlockChunk, PreviewMarkdownResult } from '../previewPipeline'

type ChunkPatch = {
  baseId: number
  prefix: number
  suffix: number
  inserted: PreviewBlockChunk[]
}

export type TextPatch = {
  from: number
  to: number
  insert: string
}

type ProcessedTextPatch = {
  baseId: number
  from: number
  to: number
  insert: string
}

export type PreviewResponse = Omit<PreviewMarkdownResult, 'blockChunks' | 'processedMarkdown'> & { id: number } & (
  | { processedMarkdown: string; processedTextPatch?: never }
  | { processedMarkdown?: never; processedTextPatch: ProcessedTextPatch }
) & (
  | { blockChunks: PreviewBlockChunk[]; chunkPatch?: never }
  | { blockChunks?: never; chunkPatch: ChunkPatch }
)

function sameChunk(a: PreviewBlockChunk, b: PreviewBlockChunk): boolean {
  return a.id === b.id && a.startLine === b.startLine && a.endLine === b.endLine &&
    a.signature === b.signature && a.markdown === b.markdown
}

/** Session-local transport: unchanged blocks stay on the receiving thread. */
export function createPreviewEncoder() {
  let previous: { id: number; chunks: PreviewBlockChunk[] } | null = null
  let previousText: { id: number; value: string } | null = null
  return (id: number, result: PreviewMarkdownResult, textPatch?: TextPatch): PreviewResponse => {
    const { blockChunks: chunks, ...metadata } = result
    const processedMarkdown = metadata.processedMarkdown
    let response: PreviewResponse = { id, ...metadata, blockChunks: chunks }
    if (previous) {
      const old = previous.chunks
      let prefix = 0
      let suffix = 0
      while (prefix < old.length && prefix < chunks.length && sameChunk(old[prefix], chunks[prefix])) prefix++
      while (suffix < old.length - prefix && suffix < chunks.length - prefix &&
        sameChunk(old[old.length - suffix - 1], chunks[chunks.length - suffix - 1])) suffix++
      if (prefix + suffix > 0) {
        response = { ...response, blockChunks: undefined, chunkPatch: {
          baseId: previous.id, prefix, suffix, inserted: chunks.slice(prefix, chunks.length - suffix),
        } } as PreviewResponse
      }
    }
    if (previousText) {
      const patch = textPatch ?? createTextPatch(previousText.value, processedMarkdown)
      response = {
        ...response,
        processedMarkdown: undefined,
        processedTextPatch: {
          baseId: previousText.id,
          from: patch.from,
          to: patch.to,
          insert: patch.insert,
        },
      } as PreviewResponse
    }
    previous = { id, chunks }
    previousText = { id, value: processedMarkdown }
    return response
  }
}

export function createPreviewDecoder() {
  let previous: { id: number; chunks: PreviewBlockChunk[] } | null = null
  let previousText: { id: number; value: string } | null = null
  return (response: PreviewResponse): PreviewMarkdownResult => {
    const { id, chunkPatch, blockChunks, processedTextPatch, processedMarkdown, ...metadata } = response
    let chunks: PreviewBlockChunk[]
    if (chunkPatch) {
      const { baseId, prefix, suffix, inserted } = chunkPatch
      if (!previous || previous.id !== baseId || !Number.isInteger(prefix) || !Number.isInteger(suffix) ||
        prefix < 0 || suffix < 0 || prefix + suffix > previous.chunks.length) {
        throw new Error('Preview transport base mismatch')
      }
      const old = previous.chunks
      chunks = old.slice(0, prefix).concat(inserted, suffix ? old.slice(old.length - suffix) : [])
    } else {
      chunks = blockChunks
    }
    let text: string
    if (processedTextPatch) {
      if (!previousText || previousText.id !== processedTextPatch.baseId ||
        processedTextPatch.from < 0 || processedTextPatch.to < processedTextPatch.from ||
        processedTextPatch.to > previousText.value.length) {
        throw new Error('Preview text transport base mismatch')
      }
      text = previousText.value.slice(0, processedTextPatch.from) + processedTextPatch.insert +
        previousText.value.slice(processedTextPatch.to)
    } else {
      text = processedMarkdown
    }
    previous = { id, chunks }
    previousText = { id, value: text }
    return { ...metadata, processedMarkdown: text, blockChunks: chunks }
  }
}

export function createTextPatch(previous: string, next: string): TextPatch {
  let from = 0
  const maxPrefix = Math.min(previous.length, next.length)
  while (from < maxPrefix && previous.charCodeAt(from) === next.charCodeAt(from)) from++
  let suffix = 0
  while (suffix < previous.length - from && suffix < next.length - from &&
    previous.charCodeAt(previous.length - suffix - 1) === next.charCodeAt(next.length - suffix - 1)) suffix++
  return { from, to: previous.length - suffix, insert: next.slice(from, next.length - suffix) }
}

export function applyTextPatch(value: string, patch: TextPatch): string {
  if (patch.from < 0 || patch.to < patch.from || patch.to > value.length) {
    throw new Error('Invalid preview text patch')
  }
  return value.slice(0, patch.from) + patch.insert + value.slice(patch.to)
}
