import { invoke } from '@tauri-apps/api/core'
import type { BackendResult } from '../platform/backendTypes'
import type { RecentFile } from '../files/types'

// 与后端 PdfRecentEntry 对应的类型
interface BackendPdfRecentEntry {
  path: string
  display_name: string
  last_opened_at: number
}

/**
 * 列出 PDF 最近文件列表。
 *
 * - 数据来源：后端 pdf_recent.json
 * - 返回值：已经映射为前端的 RecentFile 结构，isFolder 恒为 false
 */
export async function listPdfRecent(limit?: number): Promise<RecentFile[]> {
  const args: Record<string, unknown> = {}
  if (typeof limit === 'number') {
    args.limit = limit
  }

  const resp = await invoke<BackendResult<BackendPdfRecentEntry[]>>('list_pdf_recent', args)

  if ('Ok' in resp) {
    const items = resp.Ok.data
    return items.map<RecentFile>((item) => ({
      path: item.path,
      displayName: item.display_name,
      lastOpenedAt: item.last_opened_at,
      isFolder: false,
    }))
  }

  const { error } = resp.Err
  const err: any = new Error(error.message)
  err.code = error.code
  err.traceId = error.trace_id
  throw err
}

/**
 * 记录单个 PDF 文件到 pdf_recent.json。
 *
 * - 不关心返回值，仅确保命令被正确触发。
 */
export async function logPdfRecent(path: string): Promise<void> {
  await invoke('log_pdf_recent_file', { path })
}

/**
 * 从 pdf_recent.json 中删除指定 PDF 记录。
 */
export async function deletePdfRecent(path: string): Promise<void> {
  await invoke('delete_pdf_recent_entry', { path })
}
