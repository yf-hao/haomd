import { invoke } from '@tauri-apps/api/core'
import type { BackendResult } from '../platform/backendTypes'
import type { RecentFile } from '../files/types'

// 与后端 PdfRecentEntry 对应的类型
interface BackendPdfRecentEntry {
  path: string
  display_name: string
  last_opened_at: number
  folder_id?: string | null
}

export interface PdfFolder {
  id: string
  name: string
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
      // 前端 RecentFile 增加可选 folderId，未分类为 undefined
      folderId: item.folder_id ?? undefined,
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

/**
 * 加载 PDF 虚拟文件夹列表。
 */
export async function loadPdfFolders(): Promise<PdfFolder[]> {
  const resp = await invoke<BackendResult<PdfFolder[]>>('load_pdf_folders', {})

  if ('Ok' in resp) {
    const items = resp.Ok.data ?? []
    // 按名称本地化排序
    return [...items].sort((a, b) => a.name.localeCompare(b.name))
  }

  const { error } = resp.Err
  const err: any = new Error(error.message)
  err.code = error.code
  err.traceId = error.trace_id
  throw err
}

/**
 * 保存 PDF 虚拟文件夹列表。
 */
export async function savePdfFolders(folders: PdfFolder[]): Promise<void> {
  await invoke('save_pdf_folders', { folders })
}

/**
 * 更新单个 PDF 的虚拟文件夹归属。
 *
 * @param path     PDF 路径
 * @param folderId 目标虚拟文件夹 id，传 null 表示移回根列表
 */
export async function updatePdfRecentFolder(path: string, folderId: string | null): Promise<void> {
  await invoke('update_pdf_recent_folder', { path, folder_id: folderId })
}
