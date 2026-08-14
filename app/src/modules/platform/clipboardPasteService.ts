import { invoke } from '@tauri-apps/api/core'

export type ClipboardPasteContent =
  | { kind: 'image' }
  | { kind: 'text'; text: string }
  | { kind: 'empty' }

type ClipboardPasteResult = {
  Ok?: { data?: ClipboardPasteContent }
  Err?: { error?: { message?: string } }
}

export type ClipboardMatchStyleContent = {
  html: string
  text: string
}

type ClipboardMatchStyleResponse = {
  Ok?: { data?: ClipboardMatchStyleContent }
  Err?: { error?: { message?: string } }
}

export async function readClipboardForPaste(): Promise<ClipboardPasteContent> {
  console.log('[clipboardPasteService] invoking read_clipboard_for_paste...')
  const result = await invoke<ClipboardPasteResult>('read_clipboard_for_paste')
  console.log('[clipboardPasteService] raw result:', JSON.stringify(result))

  const content = result?.Ok?.data

  if (content?.kind === 'image' || content?.kind === 'empty') {
    return content
  }

  if (content?.kind === 'text' && typeof content.text === 'string') {
    return content
  }

  const errMsg = result?.Err?.error?.message || '无法读取剪贴板内容'
  console.error('[clipboardPasteService] failed:', errMsg)
  throw new Error(errMsg)
}

export async function readClipboardForMatchStyle(): Promise<ClipboardMatchStyleContent> {
  const result = await invoke<ClipboardMatchStyleResponse>('read_clipboard_for_match_style')
  const content = result?.Ok?.data

  if (
    content &&
    typeof content.html === 'string' &&
    typeof content.text === 'string'
  ) {
    return content
  }

  throw new Error(result?.Err?.error?.message || '无法读取剪贴板内容')
}

export type ClipboardImageSaveResult = {
  file_name: string
}

type ClipboardImageSaveResponse = {
  Ok?: { data?: ClipboardImageSaveResult }
  Err?: { error?: { message?: string } }
}

export async function pasteClipboardImage(
  targetDir: string,
  suggestedName?: string,
): Promise<string> {
  console.log('[clipboardPasteService] invoking paste_clipboard_image...')
  const result = await invoke<ClipboardImageSaveResponse>('paste_clipboard_image', {
    targetDir,
    suggestedName: suggestedName ?? undefined,
  })
  console.log('[clipboardPasteService] raw result:', JSON.stringify(result))

  const fileName = result?.Ok?.data?.file_name

  if (fileName) {
    return fileName
  }

  const errMsg = result?.Err?.error?.message || '无法粘贴剪贴板图片'
  console.error('[clipboardPasteService] failed:', errMsg)
  throw new Error(errMsg)
}

export type RemoteImageDownloadResult = {
  source_url: string
  file_name?: string | null
  error?: string | null
}

type RemoteImageDownloadResponse = {
  Ok?: { data?: RemoteImageDownloadResult[] }
  Err?: { error?: { message?: string } }
}

export async function downloadRemoteImages(
  targetDir: string,
  urls: string[],
  suggestedName?: string,
): Promise<RemoteImageDownloadResult[]> {
  const result = await invoke<RemoteImageDownloadResponse>('download_remote_images', {
    targetDir,
    urls,
    suggestedName: suggestedName ?? undefined,
  })

  const downloads = result?.Ok?.data
  if (Array.isArray(downloads)) {
    return downloads
  }

  const errMsg = result?.Err?.error?.message || '无法下载网络图片'
  console.error('[clipboardPasteService] remote image download failed:', errMsg)
  throw new Error(errMsg)
}
