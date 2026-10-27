import type { PreviewBlockChunk, PreviewMarkdownResult } from '../previewPipeline'

type ChunkPatch = {
  baseId: number
  prefix: number
  suffix: number
  inserted: PreviewBlockChunk[]
}

export type PreviewResponse = Omit<PreviewMarkdownResult, 'blockChunks'> & { id: number } & (
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
  return (id: number, result: PreviewMarkdownResult): PreviewResponse => {
    const { blockChunks: chunks, ...metadata } = result
    let response: PreviewResponse = { id, ...result }
    if (previous) {
      const old = previous.chunks
      let prefix = 0
      let suffix = 0
      while (prefix < old.length && prefix < chunks.length && sameChunk(old[prefix], chunks[prefix])) prefix++
      while (suffix < old.length - prefix && suffix < chunks.length - prefix &&
        sameChunk(old[old.length - suffix - 1], chunks[chunks.length - suffix - 1])) suffix++
      if (prefix + suffix > 0) {
        response = { id, ...metadata, chunkPatch: {
          baseId: previous.id, prefix, suffix, inserted: chunks.slice(prefix, chunks.length - suffix),
        } }
      }
    }
    previous = { id, chunks }
    return response
  }
}

export function createPreviewDecoder() {
  let previous: { id: number; chunks: PreviewBlockChunk[] } | null = null
  return (response: PreviewResponse): PreviewMarkdownResult => {
    const { id, chunkPatch, blockChunks, ...metadata } = response
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
    previous = { id, chunks }
    return { ...metadata, blockChunks: chunks }
  }
}
