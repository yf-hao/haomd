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
