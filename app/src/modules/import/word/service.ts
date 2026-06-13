import { invoke } from '@tauri-apps/api/core'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import type { FinalizedImportedWordDocument, ImportedWordDocument, ImportedWordState } from './types'

export function isWordDocxPath(path: string | null | undefined): path is string {
  return typeof path === 'string' && path.toLowerCase().endsWith('.docx')
}

export function buildImportedWordTabTitle(sourceDocxPath: string): string {
  const fileName = sourceDocxPath.split(/[/\\]/).pop() || 'document.docx'
  return fileName.replace(/\.docx$/i, '.md')
}

export async function importWordDocxToTempMarkdown(path: string): Promise<ImportedWordDocument> {
  return invoke<ImportedWordDocument>('import_word_docx_to_temp_markdown', { path })
}

export async function finalizeImportedWordDocument(
  importState: ImportedWordState,
  markdown: string,
  outputPath: string,
): Promise<FinalizedImportedWordDocument> {
  return invoke<FinalizedImportedWordDocument>('finalize_imported_word_markdown', {
    tempDir: importState.tempDir,
    markdown,
    outputPath,
  })
}

export async function cleanupImportedWordTemp(tempDir: string): Promise<void> {
  await invoke('cleanup_imported_word_temp', { tempDir })
}

export async function cleanupStaleImportedWordTemps(): Promise<void> {
  await invoke('cleanup_stale_imported_word_temps')
}

export async function pickWordDocxImportPath(): Promise<string | null> {
  const chosen = await openDialog({
    multiple: false,
    directory: false,
    filters: [{ name: 'Word', extensions: ['docx'] }],
  })
  if (!chosen) return null
  const selected = Array.isArray(chosen) ? chosen[0] : chosen
  const path = String(selected)
  return isWordDocxPath(path) ? path : null
}

export async function pickImportedWordSavePath(sourceDocxPath: string): Promise<string | null> {
  const fileName = buildImportedWordTabTitle(sourceDocxPath)
  const chosen = await saveDialog({
    defaultPath: fileName,
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'mdx'] },
      { name: 'Text', extensions: ['txt'] },
    ],
  })

  if (!chosen) return null

  const chosenPath = String(chosen)
  const lastSep = Math.max(chosenPath.lastIndexOf('/'), chosenPath.lastIndexOf('\\'))
  const dirPart = lastSep >= 0 ? chosenPath.slice(0, lastSep + 1) : ''
  const namePart = lastSep >= 0 ? chosenPath.slice(lastSep + 1) : chosenPath
  const trimmedName = namePart.trim()
  const dotIndex = trimmedName.lastIndexOf('.')
  const hasExt = dotIndex > 0 && dotIndex < trimmedName.length - 1
  const finalName = hasExt ? trimmedName : `${trimmedName}.md`
  return `${dirPart}${finalName}`
}
