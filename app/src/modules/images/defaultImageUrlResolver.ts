import { invoke } from '@tauri-apps/api/core'
import type { ImageSource } from '../ai/domain/types'
import type { IImageUrlResolver } from './imageUrlResolver'

async function imagePathToDataUrl(path: string): Promise<string> {
  // 约定 Rust 侧提供 read_image_as_data_url 命令，返回 { data_url: string }
  const result = await invoke<{ data_url: string }>('read_image_as_data_url', { path })
  return result.data_url
}

/**
 * 默认图片 URL 解析器：
 * - url:      直接返回原字符串
 * - data_url: 直接返回原字符串
 * - path:     调用 Tauri 后端读取本地文件并转为 data URL
 */
export const defaultImageUrlResolver: IImageUrlResolver = {
  async resolve(source: ImageSource): Promise<string> {
    switch (source.kind) {
      case 'url':
        return source.url
      case 'data_url':
        return source.dataUrl
      case 'path':
        return await imagePathToDataUrl(source.path)
      default:
        throw new Error(`Unsupported ImageSource kind: ${(source as any).kind}`)
    }
  },
}
