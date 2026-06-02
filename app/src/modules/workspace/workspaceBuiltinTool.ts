import { invoke } from '@tauri-apps/api/core'
import type { OpenAIToolDef } from '../ai/domain/types'
import type { BackendResult } from '../platform/backendTypes'
import { getWorkspaceMountedRoots } from './workspaceMountedRoots'

export const WRITE_TO_WORKSPACE_TOOL_NAME = 'write_to_workspace'
export const RESOLVE_WORKSPACE_DIRECTORY_TOOL_NAME = 'resolve_workspace_directory'
export const CREATE_WORKSPACE_DIRECTORY_TOOL_NAME = 'create_workspace_directory'
export const GET_CURRENT_DIRECTORY_TOOL_NAME = 'get_current_directory'

type WorkspaceToolContext = {
  onDocumentSaved?: (path: string) => void
  setStatusMessage?: (message: string) => void
  getCurrentDirectoryPath?: () => string | null
}

type WriteWorkspaceResult =
  | {
    ok: true
    resolvedDirectory: string
    savedFilePath: string
  }
  | {
    ok: false
    reason: 'not_found' | 'ambiguous' | 'forbidden' | 'invalid_path'
    candidates?: string[]
  }

type ResolveWorkspaceDirectoryResult =
  | {
    ok: true
    resolvedDirectory: string
  }
  | {
    ok: false
    reason: 'not_found' | 'ambiguous' | 'forbidden' | 'invalid_path'
    candidates?: string[]
  }

type CreateWorkspaceDirectoryResult =
  | {
    ok: true
    resolvedParentDirectory: string
    createdDirectoryPath: string
  }
  | {
    ok: false
    reason: 'not_found' | 'ambiguous' | 'forbidden' | 'invalid_path' | 'already_exists'
    candidates?: string[]
  }

export const writeToWorkspaceToolSchema: OpenAIToolDef = {
  type: 'function',
  function: {
    name: WRITE_TO_WORKSPACE_TOOL_NAME,
    description:
      '将内容保存到当前文件浏览器挂载目录树中的某个目录下。' +
      '只有当用户明确要求将内容保存到某个课程目录、子目录、文件浏览器中的目录、或给出了明确的工作区目录路径时，才调用此工具。' +
      '如果用户没有指定工作区目录，不要调用此工具；只有用户同时明确表达保存意图时，才可考虑使用 write_to_notes。' +
      '只能写入当前文件浏览器已挂载的目录树内，不能写到其它路径。' +
      '目录名不唯一时应让用户确认。',
    parameters: {
      type: 'object',
      properties: {
        targetDirectory: {
          type: 'string',
          description: '目标目录名称或相对路径，例如“离散数学”或“离散数学/教案”或“教案”。',
        },
        fileName: {
          type: 'string',
          description: '要保存的文件名，例如“集合与关系教案.md”。未带扩展名时会自动补 .md。',
        },
        content: {
          type: 'string',
          description: '要保存的 Markdown 内容。',
        },
      },
      required: ['targetDirectory', 'fileName', 'content'],
    },
  },
}

export const resolveWorkspaceDirectoryToolSchema: OpenAIToolDef = {
  type: 'function',
  function: {
    name: RESOLVE_WORKSPACE_DIRECTORY_TOOL_NAME,
    description:
      '解析当前文件浏览器挂载目录树中的目标目录。' +
      '只有当用户已经明确提到工作区目录、课程目录或子目录，但模型不确定目录是否唯一或真实存在时，才先调用此工具。' +
      '如果用户根本没有指定工作区目录，不应调用此工具，也不要因此默认保存到随笔。' +
      '该工具只解析目录，不写入文件。',
    parameters: {
      type: 'object',
      properties: {
        targetDirectory: {
          type: 'string',
          description: '目标目录名称或相对路径，例如“离散数学”或“离散数学/教案”或“教案”。',
        },
      },
      required: ['targetDirectory'],
    },
  },
}

export const createWorkspaceDirectoryToolSchema: OpenAIToolDef = {
  type: 'function',
  function: {
    name: CREATE_WORKSPACE_DIRECTORY_TOOL_NAME,
    description:
      '在当前文件浏览器挂载目录树中的某个已存在目录下创建子目录。' +
      '当用户明确要求在课程目录或子目录下创建文件夹、章节目录、资料目录时调用。' +
      '只能在当前文件浏览器已挂载的目录树内创建，不能越界。' +
      '如果父目录不唯一，应让用户确认。',
    parameters: {
      type: 'object',
      properties: {
        parentDirectory: {
          type: 'string',
          description: '父目录名称或相对路径，例如“离散数学”或“离散数学/教案”或“教案”。',
        },
        directoryName: {
          type: 'string',
          description: '要创建的子目录名称，例如“第四章”。',
        },
      },
      required: ['parentDirectory', 'directoryName'],
    },
  },
}

export const getCurrentDirectoryToolSchema: OpenAIToolDef = {
  type: 'function',
  function: {
    name: GET_CURRENT_DIRECTORY_TOOL_NAME,
    description:
      '获取当前工作区目录。' +
      '如果当前点击的是目录，则返回该目录；如果当前打开的是文件，则返回该文件所在目录。' +
      '当用户询问“当前目录是哪里”“我现在在哪个目录”“current directory”时调用。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
}

export function buildWorkspaceMountedRootsPrompt(): string {
  const mountedRoots = getWorkspaceMountedRoots()
  if (!mountedRoots.length) return ''

  const labels = mountedRoots
    .map((root) => root.split('/').filter(Boolean).pop() ?? root)
    .slice(0, 8)

  return (
    '\n\n当前文件浏览器已挂载的可写目录根如下：\n' +
    labels.map((label) => `- ${label}`).join('\n') +
    '\n仅当用户明确要求保存到这些目录树内的目录或子目录时，才可调用 write_to_workspace。' +
    '\n如果用户明确要求在这些目录树内创建子目录，可调用 create_workspace_directory。' +
    '\n如果用户询问当前目录是哪里，应调用 get_current_directory。' +
    '\n如果用户没有指定工作区目录，不要默认保存；只有用户明确表达保存意图时，才可考虑使用 write_to_notes。' +
    '\n当用户已指定工作区目录，但你不确定目录是否存在或是否唯一时，应先调用 resolve_workspace_directory，再决定是否写入。'
  )
}

export async function executeGetCurrentDirectory(
  _args: Record<string, never>,
  ctx?: WorkspaceToolContext,
): Promise<string> {
  const currentDirectoryPath = ctx?.getCurrentDirectoryPath?.()?.trim() ?? ''
  if (!currentDirectoryPath) {
    return '⚠️ 当前没有可确定的目录。'
  }
  return `✅ 当前目录是：${currentDirectoryPath}`
}

export async function executeResolveWorkspaceDirectory(args: {
  targetDirectory?: string
}): Promise<string> {
  const targetDirectory = args.targetDirectory?.trim() ?? ''
  const mountedRoots = getWorkspaceMountedRoots()

  if (!mountedRoots.length) {
    return '⚠️ 当前文件浏览器没有挂载目录，无法解析工作区目录。'
  }
  if (!targetDirectory) {
    return '⚠️ 未提供目标目录。'
  }

  try {
    const resp = await invoke<BackendResult<ResolveWorkspaceDirectoryResult>>(
      'resolve_workspace_directory',
      {
        mountedRoots,
        targetDirectory,
      },
    )

    if ('Err' in resp) {
      return `❌ 目录解析失败：${resp.Err.error.message || '未知错误'}`
    }

    const result = resp.Ok.data
    if (result.ok) {
      return `✅ 已解析目标目录：${result.resolvedDirectory}`
    }
    if (result.reason === 'ambiguous') {
      const candidates = (result.candidates ?? []).join('、')
      return `⚠️ 目录名存在歧义，请指定更完整的目录：${candidates}`
    }
    if (result.reason === 'not_found') {
      return '⚠️ 未找到目标目录。请确认它位于当前文件浏览器挂载的目录树中。'
    }
    if (result.reason === 'forbidden') {
      return '⚠️ 目标路径不在当前文件浏览器挂载目录树内，已拒绝解析。'
    }
    return '⚠️ 目标路径无效，无法解析。'
  } catch (error) {
    return `❌ 目录解析失败：${String(error)}`
  }
}

export async function executeWriteToWorkspace(args: {
  targetDirectory?: string
  fileName?: string
  content?: string
}, ctx?: WorkspaceToolContext): Promise<string> {
  const targetDirectory = args.targetDirectory?.trim() ?? ''
  const fileName = args.fileName?.trim() ?? ''
  const content = args.content ?? ''
  const mountedRoots = getWorkspaceMountedRoots()

  if (!mountedRoots.length) {
    return '⚠️ 当前文件浏览器没有挂载目录，无法保存到工作区目录。'
  }
  if (!targetDirectory) {
    return '⚠️ 未提供目标目录。'
  }
  if (!fileName) {
    return '⚠️ 未提供文件名。'
  }

  try {
    const resp = await invoke<BackendResult<WriteWorkspaceResult>>('write_workspace_file', {
      mountedRoots,
      targetDirectory,
      fileName,
      content,
    })

    if ('Err' in resp) {
      return `❌ 保存失败：${resp.Err.error.message || '未知错误'}`
    }

    const result = resp.Ok.data
    if (result.ok) {
      ctx?.onDocumentSaved?.(result.savedFilePath)
      const message = `✅ 已保存：${result.savedFilePath}`
      ctx?.setStatusMessage?.(message)
      return message
    }

    if (result.reason === 'ambiguous') {
      const candidates = (result.candidates ?? []).join('、')
      return `⚠️ 目录名存在歧义，请指定更完整的目录：${candidates}`
    }
    if (result.reason === 'not_found') {
      return '⚠️ 未找到目标目录。请确认它位于当前文件浏览器挂载的目录树中。'
    }
    if (result.reason === 'forbidden') {
      return '⚠️ 目标路径不在当前文件浏览器挂载目录树内，已拒绝保存。'
    }
    return '⚠️ 目标路径无效，未保存。'
  } catch (error) {
    return `❌ 保存失败：${String(error)}`
  }
}

export async function executeCreateWorkspaceDirectory(args: {
  parentDirectory?: string
  directoryName?: string
}): Promise<string> {
  const parentDirectory = args.parentDirectory?.trim() ?? ''
  const directoryName = args.directoryName?.trim() ?? ''
  const mountedRoots = getWorkspaceMountedRoots()

  if (!mountedRoots.length) {
    return '⚠️ 当前文件浏览器没有挂载目录，无法在工作区创建目录。'
  }
  if (!parentDirectory) {
    return '⚠️ 未提供父目录。'
  }
  if (!directoryName) {
    return '⚠️ 未提供要创建的目录名。'
  }

  try {
    const resp = await invoke<BackendResult<CreateWorkspaceDirectoryResult>>(
      'create_workspace_directory',
      {
        mountedRoots,
        parentDirectory,
        directoryName,
      },
    )

    if ('Err' in resp) {
      return `❌ 创建目录失败：${resp.Err.error.message || '未知错误'}`
    }

    const result = resp.Ok.data
    if (result.ok) {
      return `✅ 已创建目录：${result.createdDirectoryPath}`
    }
    if (result.reason === 'ambiguous') {
      const candidates = (result.candidates ?? []).join('、')
      return `⚠️ 父目录存在歧义，请指定更完整的目录：${candidates}`
    }
    if (result.reason === 'not_found') {
      return '⚠️ 未找到父目录。请确认它位于当前文件浏览器挂载的目录树中。'
    }
    if (result.reason === 'forbidden') {
      return '⚠️ 目标路径不在当前文件浏览器挂载目录树内，已拒绝创建。'
    }
    if (result.reason === 'already_exists') {
      return '⚠️ 该目录已存在，未重复创建。'
    }
    return '⚠️ 目录名无效，未创建。'
  } catch (error) {
    return `❌ 创建目录失败：${String(error)}`
  }
}
