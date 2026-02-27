import { invoke } from '@tauri-apps/api/core'
import { isTauriEnv } from './runtime'

export type OpenInFileManagerResult = {
  ok: boolean
  message?: string
}

/**
 * 在系统文件管理器中打开指定路径。
 * - 仅在 Tauri 桌面环境下有效
 * - macOS: Finder，Windows: Explorer，Linux: 默认文件管理器
 */
export async function openInFileManager(targetPath: string): Promise<OpenInFileManagerResult> {
  if (!targetPath) {
    return { ok: false, message: '无效路径，无法打开文件管理器' }
  }

  if (!isTauriEnv()) {
    return { ok: false, message: 'Open in File Manager 仅在桌面应用中可用' }
  }

  try {
    await invoke('open_in_file_explorer', { targetPath })
    return { ok: true }
  } catch (err) {
    console.error('[fileExplorerService] open_in_file_explorer failed', err)
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, message: `无法打开文件管理器：${message}` }
  }
}
