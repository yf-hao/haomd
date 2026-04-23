import type { OpenAIToolDef } from '../ai/domain/types'
import { saveOrExportCurrentDocument, type DocumentSaveExportContext } from './application/documentSaveExportService'

export const SAVE_OR_EXPORT_CURRENT_DOCUMENT_TOOL_NAME = 'save_or_export_current_document'

export const saveOrExportCurrentDocumentToolSchema: OpenAIToolDef = {
  type: 'function',
  function: {
    name: SAVE_OR_EXPORT_CURRENT_DOCUMENT_TOOL_NAME,
    description:
      '保存或导出当前文档。支持保存为 Markdown，或导出为 Word / HTML。' +
      '当用户说“保存文档”或“保存为 md”时使用 format=md；当用户说“保存为 word/docx”时使用 format=word；当用户说“保存为 html”时使用 format=html。' +
      '当用户要求保存到当前文件所在目录时，使用 target=current_file_dir。' +
      '当用户明确要求保存到文件浏览器挂载目录树中的某个目录时，使用 target=workspace_directory，并提供 targetDirectory，例如“网络笔记”或“离散数学/教案”。' +
      '只能保存当前文档，不能用于任意路径写文件。',
    parameters: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['md', 'word', 'html'],
          description: '保存或导出的格式。当前支持 md、word、html。',
        },
        target: {
          type: 'string',
          enum: ['current_file_dir', 'workspace_directory'],
          description: '保存目标类型。current_file_dir 表示当前文件所在目录；workspace_directory 表示文件浏览器挂载目录树中的某个目录。',
        },
        targetDirectory: {
          type: 'string',
          description: '当 target=workspace_directory 时必填。目标目录名称或相对路径，例如“网络笔记”或“离散数学/教案”。',
        },
        fileName: {
          type: 'string',
          description: '可选。用户明确指定的目标文件名，例如“demo.md”“教案.docx”“chapter1.html”。不能包含目录分隔符。',
        },
      },
      required: ['format', 'target'],
    },
  },
}

export async function executeSaveOrExportCurrentDocument(
  args: {
    format?: 'md' | 'word' | 'html'
    target?: 'current_file_dir' | 'workspace_directory'
    targetDirectory?: string
    fileName?: string
  },
  ctx: DocumentSaveExportContext,
): Promise<string> {
  const format = args.format
  const target = args.target

  if (!format || !target) {
    return '⚠️ 缺少必要参数：format 或 target。'
  }
  if (target === 'workspace_directory' && !(args.targetDirectory?.trim())) {
    return '⚠️ 保存到工作区目录时必须提供 targetDirectory。'
  }

  const result = await saveOrExportCurrentDocument(
    {
      format,
      target,
      targetDirectory: args.targetDirectory,
      fileName: args.fileName,
    },
    ctx,
  )

  if (!result.ok) {
    return `❌ ${result.message}`
  }

  ctx.onDocumentSaved?.(result.savedFilePath)
  return `✅ 已保存：${result.savedFilePath}`
}
