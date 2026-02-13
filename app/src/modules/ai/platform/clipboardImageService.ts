import { invoke } from '@tauri-apps/api/core'

// 剪贴板图片 base64 读取：调用 Tauri 后端命令
export async function readClipboardImageBase64(): Promise<string> {
  const result = await invoke('read_clipboard_image_as_base64', {}) as any
  const okPart = result && 'Ok' in result ? result.Ok : null

  if (!okPart) {
    throw new Error('[clipboardImageService] readClipboardImageBase64: empty Ok payload')
  }

  // 兼容多种 ResultPayload 形态：
  // 1) Ok: "base64..."
  // 2) Ok: { data: "base64...", trace_id?: string }
  // 3) Ok: { base64: "..." } 或 { data_base64: "..." }
  if (typeof okPart === 'string') {
    return okPart
  }

  if (typeof okPart.data === 'string') {
    return okPart.data
  }

  const base64 = okPart.base64 ?? okPart.data_base64 ?? okPart.data?.base64
  if (!base64 || typeof base64 !== 'string') {
    console.error('[clipboardImageService] readClipboardImageBase64: unexpected Ok payload', result)
    throw new Error('[clipboardImageService] readClipboardImageBase64: invalid Ok payload')
  }

  return base64
}

// base64（不含 data: 前缀）转 Uint8Array
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

// Dify 模式需要：bytes → File
export function base64ToImageFile(base64: string, fileName: string, mime = 'image/png'): File {
  const bytes = base64ToBytes(base64)
  const blob = new Blob([bytes], { type: mime })
  return new File([blob], fileName, { type: mime })
}

// 非 Dify 模式需要：base64 → data URL
export function base64ToImageDataUrl(base64: string, mime = 'image/png'): string {
  return `data:${mime};base64,${base64}`
}
