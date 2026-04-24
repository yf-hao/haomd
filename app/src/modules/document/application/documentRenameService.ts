import { normalizePersistableFilePath } from '../../files/filePathState'
import { listFolder, renameFsEntry } from '../../files/service'

export type DocumentRenameContext = {
  getCurrentFilePath?: () => string | null
}

export type DocumentRenameResult =
  | {
      ok: true
      oldFilePath: string
      renamedPath: string
      renamedFileName: string
      message: string
    }
  | {
      ok: false
      message: string
    }

function getParentPath(path: string): string | null {
  const normalized = path.replace(/\\/g, '/')
  const idx = normalized.lastIndexOf('/')
  if (idx <= 0) {
    return null
  }
  return normalized.slice(0, idx)
}

function getLastSegment(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const idx = normalized.lastIndexOf('/')
  return idx >= 0 ? normalized.slice(idx + 1) : normalized
}

function normalizeComparePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function hasExtension(fileName: string): boolean {
  return /\.[^./\\]+$/i.test(fileName)
}

function getExtension(fileName: string): string {
  const match = fileName.match(/(\.[^./\\]+)$/i)
  return match?.[1] ?? ''
}

function normalizeTargetFileName(input: string, currentPath: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) {
    return null
  }
  if (/[\\/]/.test(trimmed)) {
    return null
  }

  if (hasExtension(trimmed)) {
    return trimmed
  }

  const currentName = getLastSegment(currentPath)
  const currentExt = getExtension(currentName) || '.md'
  return `${trimmed}${currentExt}`
}

export async function renameCurrentDocument(
  args: { fileName?: string },
  ctx: DocumentRenameContext,
): Promise<DocumentRenameResult> {
  const currentFilePath = normalizePersistableFilePath(ctx.getCurrentFilePath?.())
  if (!currentFilePath) {
    return { ok: false, message: '当前文档尚未保存，无法重命名文件。' }
  }

  const parentPath = getParentPath(currentFilePath)
  if (!parentPath) {
    return { ok: false, message: '当前文档路径无效，无法重命名文件。' }
  }

  const normalizedFileName = normalizeTargetFileName(args.fileName ?? '', currentFilePath)
  if (!normalizedFileName) {
    return { ok: false, message: '新文件名只能是文件名，不能包含路径。' }
  }

  const renamedPath = `${parentPath}/${normalizedFileName}`
  if (renamedPath === currentFilePath) {
    return {
      ok: true,
      oldFilePath: currentFilePath,
      renamedPath,
      renamedFileName: normalizedFileName,
      message: `当前文档名称已是 ${normalizedFileName}`,
    }
  }

  const siblings = await listFolder(parentPath)
  if (!siblings.ok) {
    return { ok: false, message: siblings.error.message }
  }

  const normalizedCurrentPath = normalizeComparePath(currentFilePath)
  const existingTarget = siblings.data.find((entry) => {
    if (entry.kind !== 'file') {
      return false
    }
    if (entry.name !== normalizedFileName) {
      return false
    }
    return normalizeComparePath(entry.path) !== normalizedCurrentPath
  })

  if (existingTarget) {
    return { ok: false, message: `目标文件已存在：${normalizedFileName}` }
  }

  const resp = await renameFsEntry(currentFilePath, renamedPath)
  if (!resp.ok) {
    return { ok: false, message: resp.error.message }
  }

  return {
    ok: true,
    oldFilePath: currentFilePath,
    renamedPath,
    renamedFileName: normalizedFileName,
    message: `已将当前文档重命名为 ${normalizedFileName}`,
  }
}
