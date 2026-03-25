import { invoke } from '@tauri-apps/api/core'
import { save } from '@tauri-apps/plugin-dialog'
import { collectWordAssets } from './collectAssets'
import { markdownToWordModel, plainTextToWordModel } from './markdownToWordModel'
import { renderWordDiagramAssets } from './renderDiagramAssets'
import { getWordExportStyleSettings } from '../../settings/editorSettings'

export async function exportToWord(ctx: {
  setStatusMessage: (msg: string) => void
  getCurrentMarkdown: () => string
  getCurrentFileName: () => string | null
  getFilePath?: () => string | null
  confirmContinue?: (options: {
    title: string
    message: string
    confirmText?: string
    cancelText?: string
  }) => Promise<boolean>
  t?: (key: string, params?: Record<string, string | number>) => string
}) {
  const tr = (key: string, fallback: string, params?: Record<string, string | number>) =>
    ctx.t?.(key, params) ?? fallback
  try {
    const rawTitle = ctx.getCurrentFileName() || 'Document'
    const title = buildWordExportBaseName(rawTitle)
    const filePath = ctx.getFilePath ? ctx.getFilePath() : null
    const markdown = ctx.getCurrentMarkdown()
    const isPlainText = /\.txt$/i.test(rawTitle) || /\.txt$/i.test(filePath || '')
    const styleSettings = await getWordExportStyleSettings()
    let preferInkscapeForMermaid = false
    let mermaidExportFormat = styleSettings.mermaidExportFormat

    if (containsMermaidBlock(markdown)) {
      const needsInkscape =
        styleSettings.enableInkscapeForWordExport && styleSettings.mermaidExportFormat !== 'png'

      if (needsInkscape) {
        const hasInkscape = await checkInkscapeAvailability()
        preferInkscapeForMermaid = hasInkscape
        if (!hasInkscape) {
          if (styleSettings.inkscapeFallback === 'cancel') return false
          if (styleSettings.inkscapeFallback === 'ask') {
            const shouldContinue = await (ctx.confirmContinue
              ? ctx.confirmContinue({
                  title: tr('export.wordMermaidFallbackTitle', '未检测到 Inkscape'),
                  message: tr(
                    'export.wordMermaidFallbackMessage',
                    '当前系统未安装 Inkscape。Mermaid 图表将回退为现有导出方式，清晰度可能受影响。是否继续导出 Word？',
                  ),
                  confirmText: tr('export.wordMermaidFallbackContinue', '继续导出'),
                  cancelText: tr('common.cancel', '取消'),
                })
              : Promise.resolve(window.confirm(
                  tr(
                    'export.wordMermaidFallbackConfirm',
                    '当前系统未安装 Inkscape。Mermaid 图表将回退为现有导出方式，清晰度可能受影响。是否继续导出 Word？',
                  ),
                )))
            if (!shouldContinue) return false
          }
          mermaidExportFormat = 'png'
          preferInkscapeForMermaid = false
        }
      }
    }

    const outputPath = await save({
      defaultPath: `${title}.docx`,
      filters: [{ name: 'Word 文件', extensions: ['docx'] }],
    })
    if (!outputPath) return false

    ctx.setStatusMessage(tr('export.wordParsing', '正在解析 Markdown 结构...'))
    let payload = isPlainText
      ? plainTextToWordModel(markdown, title)
      : markdownToWordModel(markdown, title)
    payload.styleSettings = styleSettings

    ctx.setStatusMessage(tr('export.wordCollectingAssets', '正在收集文档资源...'))
    payload = await collectWordAssets({ payload, filePath })

    payload = await renderWordDiagramAssets({
      payload,
      setStatusMessage: ctx.setStatusMessage,
      preferInkscapeForMermaid,
      mermaidExportFormat,
    })

    ctx.setStatusMessage(tr('export.wordGenerating', '正在生成 Word 文档...'))
    await invoke('export_word_docx', {
      payloadJson: JSON.stringify(payload),
      outputPath,
    })

    ctx.setStatusMessage(tr('export.wordSuccess', `Word 导出成功: ${outputPath}`, { path: outputPath }))
    return true
  } catch (error) {
    console.error('[Export Word] 导出失败:', error)
    ctx.setStatusMessage(tr('export.wordFailed', 'Word 导出失败: ' + (error as Error).message, { message: (error as Error).message }))
    return false
  }
}

export function buildWordExportBaseName(fileName: string | null): string {
  const raw = (fileName || 'Document').trim()
  if (!raw) return 'Document'
  return raw.replace(/\.[^./\\]+$/i, '')
}

function containsMermaidBlock(markdown: string): boolean {
  return /```[\t ]*mermaid(?:[\t ]|\r?\n)/i.test(markdown)
}

async function checkInkscapeAvailability(): Promise<boolean> {
  try {
    return await invoke<boolean>('is_inkscape_available')
  } catch {
    return false
  }
}
