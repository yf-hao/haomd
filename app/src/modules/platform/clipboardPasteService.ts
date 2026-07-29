import { invoke } from '@tauri-apps/api/core'

export type ClipboardPasteContent =
  | { kind: 'image' }
  | { kind: 'text'; text: string }
  | { kind: 'empty' }

type ClipboardPasteResult = {
  Ok?: { data?: ClipboardPasteContent }
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
