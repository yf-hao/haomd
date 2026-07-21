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
  const result = await invoke<ClipboardPasteResult>('read_clipboard_for_paste')
  const content = result?.Ok?.data

  if (content?.kind === 'image' || content?.kind === 'empty') {
    return content
  }

  if (content?.kind === 'text' && typeof content.text === 'string') {
    return content
  }

  throw new Error(result?.Err?.error?.message || '无法读取剪贴板内容')
}
