import type { EditorState } from '@codemirror/state'

export interface TextChunk {
  from: number
  to: number
  value: string
}

export interface ExtractChunkOptions {
  /** 以当前行为中心，上下各保留多少行上下文 */
  contextLines: number
  /** 单块最大行数上限，避免 chunk 过大失去意义 */
  maxLines: number
}

/**
 * 统计整篇文档的总行数（以 \n 作为换行分隔符）。
 */
export function countLines(doc: string): number {
  if (!doc) return 0
  return doc.split('\n').length
}

/**
 * 从整篇 markdown 中，围绕给定行号切出一个局部块。
 *
 * - 行号从 1 开始；
 * - 以该行作为中心，向前/向后扩展 contextLines；
 * - 如果超过 maxLines，则在上下边界处截断；
 * - 返回值中的 from/to 为字符级 offset（半开区间 [from, to)）。
 */
export function extractChunkAroundLine(
  doc: string,
  line: number,
  options: ExtractChunkOptions,
): TextChunk {
  const totalLines = countLines(doc)
  if (totalLines === 0) {
    return { from: 0, to: 0, value: '' }
  }

  const safeLine = Math.min(Math.max(line, 1), totalLines)
  const context = Math.max(options.contextLines, 0)
  const maxLines = Math.max(options.maxLines, 1)

  let startLine = safeLine - context
  let endLine = safeLine + context

  if (startLine < 1) startLine = 1
  if (endLine > totalLines) endLine = totalLines

  let span = endLine - startLine + 1
  if (span > maxLines) {
    const overflow = span - maxLines
    const shrinkHead = Math.ceil(overflow / 2)
    const shrinkTail = overflow - shrinkHead
    startLine += shrinkHead
    endLine -= shrinkTail
    span = endLine - startLine + 1
  }

  const { from, to } = lineRangeToOffsets(doc, startLine, endLine)
  return { from, to, value: doc.slice(from, to) }
}

/**
 * 将局部编辑后的块（newValue）合并回整篇文档，返回新的全文。
 */
export function applyChunkPatch(doc: string, chunk: { from: number; to: number }, newValue: string): string {
  const from = clamp(chunk.from, 0, doc.length)
  const to = clamp(chunk.to, from, doc.length)
  return doc.slice(0, from) + newValue + doc.slice(to)
}

/**
 * 将局部块中的行号映射回全局行号。
 *
 * - localLine 从 1 开始；
 * - chunkFromOffset 为 chunk 在全文中的字符起始 offset；
 * - 通过扫描 [0, chunkFromOffset) 部分的换行数，得到偏移行数。
 */
export function localToGlobalLine(doc: string, chunkFromOffset: number, localLine: number): number {
  if (!doc) return localLine
  const clampedOffset = clamp(chunkFromOffset, 0, doc.length)
  const before = doc.slice(0, clampedOffset)
  const baseLines = before ? before.split('\n').length : 1
  const safeLocal = Math.max(localLine, 1)
  return baseLines - 1 + safeLocal
}

/**
 * 将整篇文档中从 startLine 到 endLine（包含）对应到字符 offset 区间。
 *
 * 假设行号从 1 开始，行与行之间以单个 \n 分隔。
 */
export function lineRangeToOffsets(
  doc: string,
  startLine: number,
  endLine: number,
): { from: number; to: number } {
  const totalLines = countLines(doc)
  if (totalLines === 0) return { from: 0, to: 0 }

  const safeStart = Math.min(Math.max(startLine, 1), totalLines)
  const safeEnd = Math.min(Math.max(endLine, safeStart), totalLines)

  let line = 1
  let from = 0
  let to = doc.length

  for (let i = 0; i < doc.length; i += 1) {
    if (line === safeStart) {
      from = i
      break
    }
    if (doc[i] === '\n') {
      line += 1
    }
  }

  line = safeStart
  for (let i = from; i < doc.length; i += 1) {
    if (doc[i] === '\n') {
      if (line === safeEnd) {
        to = i
        break
      }
      line += 1
    }
  }

  return { from, to }
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  if (value < min) return min
  if (value > max) return max
  return value
}

// 一个轻量级的帮助函数，允许在需要时从 CodeMirror 的 EditorState 中
// 快速基于行号提取 chunk。当前项目中不强制依赖它，但预留给后续使用。
export function extractChunkFromEditorState(
  state: EditorState,
  line: number,
  options: ExtractChunkOptions,
): TextChunk {
  const doc = state.doc.toString()
  return extractChunkAroundLine(doc, line, options)
}
