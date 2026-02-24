import type { DocConversationRecord, DocConversationMessage } from '../domain/docConversations'
import type { SessionDigest } from './types'
import { loadPendingSessionDigests, savePendingSessionDigests } from './repo'

function pickSummaryMessages(
  record: DocConversationRecord,
  options?: { summaryCreatedAfter?: number },
): DocConversationMessage[] {
  const all = record.messages.filter((m) => (m.meta?.summaryLevel ?? 0) >= 1)
  if (!all.length) return []

  if (options?.summaryCreatedAfter == null) {
    return all
  }

  const cutoff = options.summaryCreatedAfter
  return all.filter((m) => m.timestamp >= cutoff)
}

function buildSessionDigestFromSummaries(record: DocConversationRecord, summaries: DocConversationMessage[]): SessionDigest | null {
  if (!summaries.length) return null

  const timeRanges = summaries
    .map((m) => m.meta?.coveredTimeRange)
    .filter((r): r is { from: number; to: number } => !!r)

  let from: number
  let to: number

  if (timeRanges.length) {
    from = Math.min(...timeRanges.map((r) => r.from))
    to = Math.max(...timeRanges.map((r) => r.to))
  } else {
    const timestamps = summaries.map((m) => m.timestamp)
    if (!timestamps.length) return null
    from = Math.min(...timestamps)
    to = Math.max(...timestamps)
  }

  const digest: SessionDigest = {
    docPath: record.docPath,
    period: { from, to },
    summaries: summaries.map((m) => m.content),
    source: 'conversation-compress',
  }

  return digest
}

/**
 * 根据压缩后的 DocConversationRecord 生成一条 SessionDigest 并写入待学习队列。
 *
 * - 默认只会采集本次压缩过程中新增的摘要消息（通过 timestamp 截断近似判断）；
 * - 如果未检测到新的摘要消息，则不会入队。
 */
export function enqueueSessionDigestFromCompressedRecord(
  record: DocConversationRecord,
  options?: { summaryCreatedAfter?: number },
): void {
  const summaryMessages = pickSummaryMessages(record, options)
  if (!summaryMessages.length) return

  const digest = buildSessionDigestFromSummaries(record, summaryMessages)
  if (!digest) return

  const pending = loadPendingSessionDigests()
  pending.push(digest)
  savePendingSessionDigests(pending)
}

/**
 * 从 AI Chat 会话中构造一条 SessionDigest 并入队。
 *
 * - 用于 /remember 等命令，将用户提供的摘要和自动摘要写入 Global Memory 待学习队列；
 * - 当前版本不依赖 docConversations 记录，直接按当前时间构造一个极简时间范围。
 */
export function enqueueSessionDigestFromChat(options: {
  docPath: string
  summaries: string[]
  periodFrom?: number
  periodTo?: number
  source?: string
}): void {
  const now = Date.now()
  const from = options.periodFrom ?? now
  const to = options.periodTo ?? now

  const digest: SessionDigest = {
    docPath: options.docPath,
    period: { from, to },
    summaries: options.summaries,
  }

  const pending = loadPendingSessionDigests()
  pending.push(digest)
  savePendingSessionDigests(pending)
}

/**
 * 从 AI Chat 的手工摘要中直接构造一条 SessionDigest 并入队。
 *
 * - 保留向后兼容用法：仅接收单条 summary，并包装成 summaries 数组。
 */
export function enqueueSessionDigestFromChatSummary(options: {
  docPath: string
  summary: string
  periodFrom?: number
  periodTo?: number
}): void {
  enqueueSessionDigestFromChat({
    docPath: options.docPath,
    summaries: [options.summary],
    periodFrom: options.periodFrom,
    periodTo: options.periodTo,
    source: 'chat-remember',
  })
}
