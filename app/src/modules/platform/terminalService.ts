import { invoke } from '@tauri-apps/api/core'
import { isTauriEnv } from './runtime'

export type OpenTerminalResult = {
  ok: boolean
  message?: string
}

/**
 * 在指定目录打开系统终端。
 * - 仅在 Tauri 环境下有效
 * - 调用后端 open_terminal(cwd) 命令
 */
export async function openTerminalAt(cwd: string): Promise<OpenTerminalResult> {
  if (!cwd) {
    return { ok: false, message: '无效路径，无法打开终端' }
  }

  if (!isTauriEnv()) {
    return { ok: false, message: 'Open in Terminal 仅在桌面应用中可用' }
  }

  try {
    await invoke('open_terminal', { cwd })
    return { ok: true }
  } catch (err) {
    console.error('[terminalService] open_terminal failed', err)
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, message: `无法打开终端：${message}` }
  }
}
