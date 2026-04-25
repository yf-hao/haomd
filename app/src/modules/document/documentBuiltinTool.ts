import type { OpenAIToolDef } from '../ai/domain/types'
import { saveOrExportCurrentDocument, type DocumentSaveExportContext } from './application/documentSaveExportService'
import { renameCurrentDocument } from './application/documentRenameService'
import { createDirectoryFromSelection } from './application/createDirectoryFromSelectionService'
import { createDirectoryInWorkspace } from './application/createDirectoryInWorkspaceService'
import { renameWorkspaceEntry } from './application/renameWorkspaceEntryService'
import { normalizePersistableFilePath } from '../files/filePathState'
import type { WorkspaceEntryKind } from '../workspace/workspaceEntryResolver'

export const SAVE_OR_EXPORT_CURRENT_DOCUMENT_TOOL_NAME = 'save_or_export_current_document'
export const DELETE_CURRENT_DOCUMENT_TOOL_NAME = 'delete_current_document'
export const DELETE_CURRENT_FOLDER_TOOL_NAME = 'delete_current_folder'
export const RENAME_CURRENT_DOCUMENT_TOOL_NAME = 'rename_current_document'
export const CREATE_DIRECTORY_UNDER_SELECTION_TOOL_NAME = 'create_directory_under_selection'
export const DELETE_WORKSPACE_ENTRY_TOOL_NAME = 'delete_workspace_entry'
export const RENAME_WORKSPACE_ENTRY_TOOL_NAME = 'rename_workspace_entry'
export const CREATE_DIRECTORY_IN_WORKSPACE_TOOL_NAME = 'create_directory_in_workspace'

export type DeleteCurrentDocumentContext = {
  getCurrentFilePath?: () => string | null
  onRequestDeleteCurrentDocument?: (
    path: string,
  ) => Promise<{ ok: boolean; message: string }>
}

export type DeleteCurrentFolderContext = {
  getCurrentFolderPath?: () => string | null
  onRequestDeleteCurrentFolder?: (
    path: string,
  ) => Promise<{ ok: boolean; message: string }>
}

export type RenameCurrentDocumentContext = {
  getCurrentFilePath?: () => string | null
  onRenameCurrentDocument?: (fileName: string) => Promise<{ ok: boolean; message: string }>
}

export type CreateDirectoryUnderSelectionContext = {
  onCreateDirectoryUnderSelection?: (
    directoryName: string,
  ) => Promise<{ ok: boolean; message: string }>
  getSelectionBaseDirectory?: () => string | null
}

export type DeleteWorkspaceEntryContext = {
  getWorkspaceRoot?: () => string | null
  onRequestDeleteWorkspaceEntry?: (
    targetPath: string,
    targetKind?: WorkspaceEntryKind,
  ) => Promise<{ ok: boolean; message: string }>
}

export type RenameWorkspaceEntryContext = {
  getWorkspaceRoot?: () => string | null
  onRenameWorkspaceEntry?: (
    targetPath: string,
    newName: string,
    targetKind?: WorkspaceEntryKind,
  ) => Promise<{ ok: boolean; message: string }>
}

export type CreateDirectoryInWorkspaceContext = {
  getWorkspaceRoot?: () => string | null
  onCreateDirectoryInWorkspace?: (
    parentPath: string,
    directoryName: string,
  ) => Promise<{ ok: boolean; message: string }>
}

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

export const deleteCurrentDocumentToolSchema: OpenAIToolDef = {
  type: 'function',
  function: {
    name: DELETE_CURRENT_DOCUMENT_TOOL_NAME,
    description:
      '删除当前文档文件。仅用于删除当前活动文档，且删除前必须弹出确认，不能直接删除任意路径。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
}

export const deleteCurrentFolderToolSchema: OpenAIToolDef = {
  type: 'function',
  function: {
    name: DELETE_CURRENT_FOLDER_TOOL_NAME,
    description:
      '删除当前选中的文件夹。仅用于删除当前文件浏览器中已选中的文件夹，删除前必须先确认，不能直接删除任意路径。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
}

export const renameCurrentDocumentToolSchema: OpenAIToolDef = {
  type: 'function',
  function: {
    name: RENAME_CURRENT_DOCUMENT_TOOL_NAME,
    description:
      '将当前文档重命名为新的文件名。仅重命名当前活动文档，保持所在目录不变。' +
      '当用户说“重命名为 demo”“把当前文档重命名为 demo”时使用。fileName 只能是文件名，不能包含目录。',
    parameters: {
      type: 'object',
      properties: {
        fileName: {
          type: 'string',
          description: '新的文件名，例如“demo”“demo.md”“chapter1.md”。不能包含目录分隔符。',
        },
      },
      required: ['fileName'],
    },
  },
}

export const createDirectoryUnderSelectionToolSchema: OpenAIToolDef = {
  type: 'function',
  function: {
    name: CREATE_DIRECTORY_UNDER_SELECTION_TOOL_NAME,
    description:
      '在当前选中的目录下创建子目录；如果当前选中的是文件，则在该文件同级目录创建子目录。' +
      '当用户说“创建 demo 目录”“创建 demo 文件夹”“新建 demo 文件夹”时使用。directoryName 只能是单个目录名，不能包含路径。',
    parameters: {
      type: 'object',
      properties: {
        directoryName: {
          type: 'string',
          description: '要创建的目录名，例如“demo”“离散数学”。不能包含目录分隔符。',
        },
      },
      required: ['directoryName'],
    },
  },
}

export const deleteWorkspaceEntryToolSchema: OpenAIToolDef = {
  type: 'function',
  function: {
    name: DELETE_WORKSPACE_ENTRY_TOOL_NAME,
    description:
      '在当前工作区内按名称解析并删除文件或文件夹。' +
      '例如“删除 temp 下的 demo 文件夹”“删除 temp 下的 hello.md”“删除 demo 文件夹”“删除 hello.md”。' +
      '当用户没有给出父路径，或者当前选择的不是该目标文件夹时，也必须先用这个工具按名称解析目标，不能先回复文字确认。' +
      '删除前必须先确认，不能删除工作区外路径。',
    parameters: {
      type: 'object',
      properties: {
        targetPath: {
          type: 'string',
          description: '当前工作区内的目标名称或相对路径，例如“temp/demo”“temp/hello.md”“demo”“hello.md”。',
        },
        targetKind: {
          type: 'string',
          enum: ['file', 'dir'],
          description: '可选。目标类型；删除文件夹时传 dir，删除文件时传 file。',
        },
      },
      required: ['targetPath'],
    },
  },
}

export const renameWorkspaceEntryToolSchema: OpenAIToolDef = {
  type: 'function',
  function: {
    name: RENAME_WORKSPACE_ENTRY_TOOL_NAME,
    description:
      '在当前工作区内按名称解析并重命名文件或文件夹。' +
      '例如“把 temp 下的 hello.md 重命名为 hi.md”“把 temp 下的 demo 文件夹改名为 demo2”。',
    parameters: {
      type: 'object',
      properties: {
        targetPath: {
          type: 'string',
          description: '当前工作区内的目标名称或相对路径，例如“temp/hello.md”“temp/demo”。',
        },
        newName: {
          type: 'string',
          description: '新的名称，只能是名称本身，不能包含路径。',
        },
        targetKind: {
          type: 'string',
          enum: ['file', 'dir'],
          description: '可选。目标类型；重命名文件夹时传 dir，文件时传 file。',
        },
      },
      required: ['targetPath', 'newName'],
    },
  },
}

export const createDirectoryInWorkspaceToolSchema: OpenAIToolDef = {
  type: 'function',
  function: {
    name: CREATE_DIRECTORY_IN_WORKSPACE_TOOL_NAME,
    description:
      '在当前工作区内按名称解析父目录，然后创建子目录。' +
      '例如“在 temp 下创建 demo 目录”“在离散数学下创建教案文件夹”。',
    parameters: {
      type: 'object',
      properties: {
        parentPath: {
          type: 'string',
          description: '当前工作区内的父目录名称或相对路径，例如“temp”“离散数学/教案”。',
        },
        directoryName: {
          type: 'string',
          description: '要创建的子目录名称，只能是单个目录名。',
        },
      },
      required: ['parentPath', 'directoryName'],
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

export async function executeDeleteCurrentDocument(
  _args: Record<string, never>,
  ctx: DeleteCurrentDocumentContext,
): Promise<string> {
  if (!ctx.getCurrentFilePath) {
    return '⚠️ 当前会话未挂载文档上下文，无法删除当前文档。'
  }

  const currentFilePath = normalizePersistableFilePath(ctx.getCurrentFilePath())
  if (!currentFilePath) {
    return '⚠️ 当前文档尚未保存，无法删除文件。'
  }

  if (!ctx.onRequestDeleteCurrentDocument) {
    return '⚠️ 当前会话未接入删除确认能力，无法删除当前文档。'
  }

  const result = await ctx.onRequestDeleteCurrentDocument(currentFilePath)
  if (!result.ok) {
    return `⚠️ ${result.message}`
  }

  return `✅ ${result.message}`
}

export async function executeDeleteCurrentFolder(
  _args: Record<string, never>,
  ctx: DeleteCurrentFolderContext,
): Promise<string> {
  if (!ctx.getCurrentFolderPath) {
    return '⚠️ 当前会话未挂载文件夹上下文，无法删除当前文件夹。'
  }

  const currentFolderPath = ctx.getCurrentFolderPath()?.trim() ?? ''
  if (!currentFolderPath) {
    return '⚠️ 当前未选中文件夹，无法删除文件夹。'
  }

  if (!ctx.onRequestDeleteCurrentFolder) {
    return '⚠️ 当前会话未接入文件夹删除能力，无法删除当前文件夹。'
  }

  const result = await ctx.onRequestDeleteCurrentFolder(currentFolderPath)
  if (!result.ok) {
    return `⚠️ ${result.message}`
  }

  return `✅ ${result.message}`
}

export async function executeRenameCurrentDocument(
  args: { fileName?: string },
  ctx: RenameCurrentDocumentContext,
): Promise<string> {
  const fileName = args.fileName?.trim()
  if (!fileName) {
    return '⚠️ 缺少必要参数：fileName。'
  }

  if (!ctx.onRenameCurrentDocument) {
    const result = await renameCurrentDocument(
      { fileName },
      {
        getCurrentFilePath: ctx.getCurrentFilePath,
      },
    )
    return result.ok ? `✅ ${result.message}` : `⚠️ ${result.message}`
  }

  const result = await ctx.onRenameCurrentDocument(fileName)
  return result.ok ? `✅ ${result.message}` : `⚠️ ${result.message}`
}

export async function executeCreateDirectoryUnderSelection(
  args: { directoryName?: string },
  ctx: CreateDirectoryUnderSelectionContext,
): Promise<string> {
  const directoryName = args.directoryName?.trim()
  if (!directoryName) {
    return '⚠️ 缺少必要参数：directoryName。'
  }

  if (!ctx.onCreateDirectoryUnderSelection) {
    const result = await createDirectoryFromSelection(
      { directoryName },
      {
        getBaseDirectory: ctx.getSelectionBaseDirectory,
      },
    )
    return result.ok ? `✅ ${result.message}` : `⚠️ ${result.message}`
  }

  const result = await ctx.onCreateDirectoryUnderSelection(directoryName)
  return result.ok ? `✅ ${result.message}` : `⚠️ ${result.message}`
}

export async function executeDeleteWorkspaceEntry(
  args: { targetPath?: string; targetKind?: WorkspaceEntryKind },
  ctx: DeleteWorkspaceEntryContext,
): Promise<string> {
  const targetPath = args.targetPath?.trim()
  if (!targetPath) {
    return '⚠️ 缺少必要参数：targetPath。'
  }

  if (!ctx.onRequestDeleteWorkspaceEntry) {
    return '⚠️ 当前会话未接入工作区目标删除能力，无法删除目标。'
  }

  const result = await ctx.onRequestDeleteWorkspaceEntry(targetPath, args.targetKind)
  return result.ok ? `✅ ${result.message}` : `⚠️ ${result.message}`
}

export async function executeRenameWorkspaceEntry(
  args: { targetPath?: string; newName?: string; targetKind?: WorkspaceEntryKind },
  ctx: RenameWorkspaceEntryContext,
): Promise<string> {
  const targetPath = args.targetPath?.trim()
  const newName = args.newName?.trim()
  if (!targetPath || !newName) {
    return '⚠️ 缺少必要参数：targetPath 或 newName。'
  }

  if (!ctx.onRenameWorkspaceEntry) {
    const result = await renameWorkspaceEntry(
      { targetPath, newName, targetKind: args.targetKind },
      { getWorkspaceRoot: ctx.getWorkspaceRoot },
    )
    return result.ok ? `✅ ${result.message}` : `⚠️ ${result.message}`
  }

  const result = await ctx.onRenameWorkspaceEntry(targetPath, newName, args.targetKind)
  return result.ok ? `✅ ${result.message}` : `⚠️ ${result.message}`
}

export async function executeCreateDirectoryInWorkspace(
  args: { parentPath?: string; directoryName?: string },
  ctx: CreateDirectoryInWorkspaceContext,
): Promise<string> {
  const parentPath = args.parentPath?.trim()
  const directoryName = args.directoryName?.trim()
  if (!parentPath || !directoryName) {
    return '⚠️ 缺少必要参数：parentPath 或 directoryName。'
  }

  if (!ctx.onCreateDirectoryInWorkspace) {
    const result = await createDirectoryInWorkspace(
      { parentPath, directoryName },
      { getWorkspaceRoot: ctx.getWorkspaceRoot },
    )
    return result.ok ? `✅ ${result.message}` : `⚠️ ${result.message}`
  }

  const result = await ctx.onCreateDirectoryInWorkspace(parentPath, directoryName)
  return result.ok ? `✅ ${result.message}` : `⚠️ ${result.message}`
}
