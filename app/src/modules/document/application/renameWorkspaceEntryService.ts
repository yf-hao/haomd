import { listFolder, renameFsEntry } from '../../files/service'
import { resolveWorkspaceEntryByName, type WorkspaceEntryKind } from '../../workspace/workspaceEntryResolver'

export type RenameWorkspaceEntryArgs = {
  targetPath?: string
  newName?: string
  targetKind?: WorkspaceEntryKind
}

export type RenameWorkspaceEntryContext = {
  getWorkspaceRoot?: () => string | null
}

export type RenameWorkspaceEntryResult =
  | {
      ok: true
      oldPath: string
      renamedPath: string
      renamedName: string
      targetKind: WorkspaceEntryKind
      message: string
    }
  | { ok: false; message: string }

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/[\\/]+$/, '')
}

function joinPath(base: string, child: string): string {
  return `${normalizePath(base)}/${child.replace(/^\/+/, '')}`
}

function getParentDirectory(path: string): string {
  const normalized = normalizePath(path)
  const index = normalized.lastIndexOf('/')
  return index <= 0 ? normalized : normalized.slice(0, index)
}

export async function renameWorkspaceEntry(
  args: RenameWorkspaceEntryArgs,
  ctx: RenameWorkspaceEntryContext,
): Promise<RenameWorkspaceEntryResult> {
  const workspaceRoot = ctx.getWorkspaceRoot?.() ?? null
  const targetPath = args.targetPath?.trim() ?? ''
  const newName = args.newName?.trim() ?? ''

  if (!targetPath) {
    return { ok: false, message: '缺少目标名称，无法重命名。' }
  }
  if (!newName) {
    return { ok: false, message: '缺少新名称，无法重命名。' }
  }
  if (/[\\/]/.test(newName)) {
    return { ok: false, message: '新名称只能是名称本身，不能包含路径。' }
  }

  const resolved = await resolveWorkspaceEntryByName({
    workspaceRoot,
    targetPath,
    expectedKind: args.targetKind,
  })
  if (!resolved.ok) {
    return { ok: false, message: resolved.message }
  }

  const parentDirectory = getParentDirectory(resolved.resolvedPath)
  const renamedPath = joinPath(parentDirectory, newName)
  const siblings = await listFolder(parentDirectory)
  if (!siblings.ok) {
    return { ok: false, message: siblings.error.message || '读取父目录失败。' }
  }

  if (
    siblings.data.some((entry) => entry.name === newName && normalizePath(entry.path) !== normalizePath(resolved.resolvedPath))
  ) {
    return { ok: false, message: `${resolved.kind === 'dir' ? '目标目录' : '目标文件'}已存在：${newName}` }
  }

  const renamed = await renameFsEntry(resolved.resolvedPath, renamedPath)
  if (!renamed.ok) {
    return { ok: false, message: renamed.error.message || `重命名失败：${newName}` }
  }

  return {
    ok: true,
    oldPath: resolved.resolvedPath,
    renamedPath,
    renamedName: newName,
    targetKind: resolved.kind,
    message: `已将${resolved.kind === 'dir' ? '目录' : '文件'}重命名为 ${newName}`,
  }
}
