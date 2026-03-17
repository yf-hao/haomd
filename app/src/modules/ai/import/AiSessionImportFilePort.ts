import { open } from '@tauri-apps/plugin-dialog'
import { readFile } from '../../files/service'

export interface AiSessionImportFilePort {
  /**
   * 弹出文件打开对话框并读取 AI Sessions JSON 文本。
   * - 用户取消时返回 null；
   * - 成功选择并读取时返回 JSON 字符串。
   */
  openAndReadJsonWithDialog(options?: { title?: string }): Promise<string | null>
}

export class TauriAiSessionImportFileAdapter implements AiSessionImportFilePort {
  async openAndReadJsonWithDialog(options?: { title?: string }): Promise<string | null> {
    const selected = await open({
      title: options?.title ?? 'Import AI Sessions JSON',
      multiple: false,
      filters: [
        {
          name: 'JSON',
          extensions: ['json'],
        },
      ],
    })

    if (!selected) return null

    // plugin-dialog 的 open 在 multiple=false 时可能返回 string 或 string[]，这里只做防御性处理
    const filePath = Array.isArray(selected) ? selected[0] : selected
    if (!filePath || typeof filePath !== 'string') return null

    const resp = await readFile(filePath)
    if (!resp.ok) {
      console.error('[AiSessionImportFilePort] readFile failed', resp.error)
      throw new Error('Failed to read AI sessions JSON file')
    }

    return resp.data.content
  }
}
