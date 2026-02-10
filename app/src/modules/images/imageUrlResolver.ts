import type { ImageSource } from '../ai/domain/types'

/**
 * ImageSource -> 可被各 Vision Provider 直接使用的 URL 字符串
 * - 对于 HTTP(S) 远程图片，直接返回原始 URL
 * - 对于 data_url，原样返回
 * - 对于本地路径，由具体实现决定如何解析（例如调用 Tauri 后端读文件并转为 data URL）
 */
export interface IImageUrlResolver {
  resolve(source: ImageSource): Promise<string>
}
