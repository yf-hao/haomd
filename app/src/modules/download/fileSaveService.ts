import { invoke } from '@tauri-apps/api/core'

/**
 * 文件保存服务接口：通过系统对话框将文本保存到本地。
 */
export interface FileSaveService {
  saveTextWithDialog(params: { defaultFileName: string; content: string }): Promise<void>
}

/**
 * 基于 Tauri 命令 `save_text_with_dialog` 的实现。
 * 后端负责弹出保存对话框并写入文件。
 */
export class TauriFileSaveService implements FileSaveService {
  async saveTextWithDialog(params: { defaultFileName: string; content: string }): Promise<void> {
    await invoke('save_text_with_dialog', {
      defaultFileName: params.defaultFileName,
      content: params.content,
    })
  }
}
