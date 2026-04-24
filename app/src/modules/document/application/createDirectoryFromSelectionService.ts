import { createFolder, listFolder } from '../../files/service'

export type CreateDirectoryFromSelectionContext = {
  getBaseDirectory?: () => string | null
}

export type CreateDirectoryFromSelectionResult =
  | {
      ok: true
      createdDirectoryPath: string
      directoryName: string
      message: string
    }
  | {
      ok: false
      message: string
    }

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/[\\/]+$/, '')
}

export async function createDirectoryFromSelection(
  args: { directoryName?: string },
  ctx: CreateDirectoryFromSelectionContext,
): Promise<CreateDirectoryFromSelectionResult> {
  const directoryName = args.directoryName?.trim() ?? ''
  if (!directoryName) {
    return { ok: false, message: '缺少必要参数：directoryName。' }
  }
  if (/[\\/]/.test(directoryName)) {
    return { ok: false, message: '目录名只能是单个目录名，不能包含路径。' }
  }

  const baseDirectory = ctx.getBaseDirectory?.()
  if (!baseDirectory) {
    return { ok: false, message: '当前未选中文件或目录，无法创建子目录。' }
  }

  const normalizedBaseDirectory = normalizePath(baseDirectory)
  const siblings = await listFolder(normalizedBaseDirectory)
  if (!siblings.ok) {
    return { ok: false, message: siblings.error.message }
  }

  const exists = siblings.data.some((entry) => entry.kind === 'dir' && entry.name === directoryName)
  if (exists) {
    return { ok: false, message: `目标目录已存在：${directoryName}` }
  }

  const createdDirectoryPath = `${normalizedBaseDirectory}/${directoryName}`
  const resp = await createFolder(createdDirectoryPath)
  if (!resp.ok) {
    return { ok: false, message: resp.error.message }
  }

  return {
    ok: true,
    createdDirectoryPath,
    directoryName,
    message: `已创建目录：${directoryName}`,
  }
}
