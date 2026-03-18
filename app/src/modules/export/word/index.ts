import { invoke } from '@tauri-apps/api/core'
import { save } from '@tauri-apps/plugin-dialog'
import { collectWordAssets } from './collectAssets'
import { markdownToWordModel, plainTextToWordModel } from './markdownToWordModel'
import { renderWordDiagramAssets } from './renderDiagramAssets'

export async function exportToWord(ctx: {
  setStatusMessage: (msg: string) => void
  getCurrentMarkdown: () => string
  getCurrentFileName: () => string | null
  getFilePath?: () => string | null
}) {
  try {
    const rawTitle = ctx.getCurrentFileName() || 'Document'
    const title = buildWordExportBaseName(rawTitle)
    const filePath = ctx.getFilePath ? ctx.getFilePath() : null
    const markdown = ctx.getCurrentMarkdown()
    const isPlainText = /\.txt$/i.test(rawTitle) || /\.txt$/i.test(filePath || '')

    const outputPath = await save({
      defaultPath: `${title}.docx`,
      filters: [{ name: 'Word 文件', extensions: ['docx'] }],
    })
    if (!outputPath) return false

    ctx.setStatusMessage('正在解析 Markdown 结构...')
    let payload = isPlainText
      ? plainTextToWordModel(markdown, title)
      : markdownToWordModel(markdown, title)

    ctx.setStatusMessage('正在收集文档资源...')
    payload = await collectWordAssets({ payload, filePath })

    payload = await renderWordDiagramAssets({
      payload,
      setStatusMessage: ctx.setStatusMessage,
    })

    ctx.setStatusMessage('正在生成 Word 文档...')
    await invoke('export_word_docx', {
      payloadJson: JSON.stringify(payload),
      outputPath,
    })

    ctx.setStatusMessage(`Word 导出成功: ${outputPath}`)
    return true
  } catch (error) {
    console.error('[Export Word] 导出失败:', error)
    ctx.setStatusMessage('Word 导出失败: ' + (error as Error).message)
    return false
  }
}

export function buildWordExportBaseName(fileName: string | null): string {
  const raw = (fileName || 'Document').trim()
  if (!raw) return 'Document'
  return raw.replace(/\.[^./\\]+$/i, '')
}
