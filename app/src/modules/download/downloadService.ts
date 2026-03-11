/**
 * 文本下载接口：给定 URL，返回文本内容。
 */
export interface TextDownloadService {
  downloadText(url: string): Promise<string>
}

/**
 * 基于浏览器 fetch 的简单文本下载实现。
 * 如果后续需要走 Tauri 后端下载，可以新增 TauriTextDownloadService 实现同样接口。
 */
export class FetchTextDownloadService implements TextDownloadService {
  async downloadText(url: string): Promise<string> {
    const resp = await fetch(url)
    if (!resp.ok) {
      throw new Error(`下载失败：${resp.status} ${resp.statusText}`)
    }
    return await resp.text()
  }
}
