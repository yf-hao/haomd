import { invoke } from '@tauri-apps/api/core'
import { insertMarkdownAtCursorBelow } from '../../platform/editorInsertService'

function sanitizeFileNamePart(input: string): string {
  return input
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

export function buildImageGenerationFileName(prompt: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const summary = sanitizeFileNamePart(prompt) || 'generated-image'
  return `${summary}-${timestamp}.png`
}

export function buildImageMarkdown(params: { imageUrl: string; prompt: string }): string {
  const alt = params.prompt.trim() || 'generated image'
  return `![${alt}](${params.imageUrl})`
}

export async function saveRemoteImageWithDialog(params: {
  imageUrl: string
  prompt: string
}): Promise<void> {
  await invoke('save_remote_image_with_dialog', {
    defaultFileName: buildImageGenerationFileName(params.prompt),
    imageUrl: params.imageUrl,
  })
}

export async function insertGeneratedImageIntoEditor(params: {
  imageUrl: string
  prompt: string
}): Promise<void> {
  await insertMarkdownAtCursorBelow({
    text: `\n${buildImageMarkdown(params)}\n`,
  })
}
