import type { AiInputHistoryEntry } from './localStorageAiChatInputHistory'
import { getAiInputHistory } from './localStorageAiChatInputHistory'

export type HistoryItemView = {
  ordinal: number
  text: string
  createdAt: string
}

export type HistoryPage = {
  directoryKey: string
  pageIndex: number
  pageSize: number
  totalCount: number
  totalPages: number
  items: HistoryItemView[]
}

/**
 * 将某个目录下的输入历史按时间顺序编号（最早为 1，最新编号最大），并按页返回。
 * pageIndex = 0 表示“最新页”（包含编号最大的一组记录）。
 */
export function getHistoryPage(directoryKey: string, pageIndex: number, pageSize = 10): HistoryPage {
  const all = getAiInputHistory(directoryKey)
  const totalCount = all.length
  const safePageSize = pageSize > 0 ? pageSize : 10
  const totalPages = totalCount === 0 ? 0 : Math.ceil(totalCount / safePageSize)

  if (totalPages === 0) {
    return {
      directoryKey,
      pageIndex: 0,
      pageSize: safePageSize,
      totalCount: 0,
      totalPages: 0,
      items: [],
    }
  }

  // pageIndex 按“从最新往前”的顺序计数：0 = 最新页
  const clampedPageIndex = Math.min(Math.max(pageIndex, 0), totalPages - 1)

  // 计算最新页的结束索引（在 all 中索引从 0 到 totalCount-1，时间从早到晚）
  const latestPageEnd = totalCount - 1

  // 向更早的页翻时，每增加 1 页，就往前偏移一段 pageSize
  const offsetFromLatest = clampedPageIndex
  let end = latestPageEnd - offsetFromLatest * safePageSize
  let start = end - safePageSize + 1

  if (end < 0) {
    end = -1
    start = 0
  }

  if (start < 0) {
    start = 0
  }

  if (end < start) {
    return {
      directoryKey,
      pageIndex: clampedPageIndex,
      pageSize: safePageSize,
      totalCount,
      totalPages,
      items: [],
    }
  }

  const items: HistoryItemView[] = []
  for (let index = start; index <= end && index < totalCount; index++) {
    const entry = all[index] as AiInputHistoryEntry
    items.push({
      ordinal: index + 1,
      text: entry.text,
      createdAt: entry.createdAt,
    })
  }

  return {
    directoryKey,
    pageIndex: clampedPageIndex,
    pageSize: safePageSize,
    totalCount,
    totalPages,
    items,
  }
}

/**
 * 根据“时间顺序编号”（最早为 1，最新为 N）解析出对应的历史条目。
 */
export function resolveHistoryEntryByOrdinal(
  directoryKey: string,
  ordinal: number,
): AiInputHistoryEntry | null {
  if (!Number.isFinite(ordinal) || ordinal <= 0) return null
  const all = getAiInputHistory(directoryKey)
  if (!all.length) return null
  if (ordinal > all.length) return null
  return all[ordinal - 1] ?? null
}
