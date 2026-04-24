import { createFolder, listFolder } from '../../files/service'
import { resolveWorkspaceChildPath } from '../../workspace/workspaceEntryResolver'

export type CreateDirectoryInWorkspaceArgs = {
  parentPath?: string
  directoryName?: string
}

export type CreateDirectoryInWorkspaceContext = {
  getWorkspaceRoot?: () => string | null
}

export type CreateDirectoryInWorkspaceResult =
  | { ok: true; createdDirectoryPath: string; directoryName: string; message: string }
  | { ok: false; message: string }

export async function createDirectoryInWorkspace(
  args: CreateDirectoryInWorkspaceArgs,
  ctx: CreateDirectoryInWorkspaceContext,
): Promise<CreateDirectoryInWorkspaceResult> {
  const workspaceRoot = ctx.getWorkspaceRoot?.() ?? null
  const parentPath = args.parentPath?.trim() ?? ''
  const directoryName = args.directoryName?.trim() ?? ''

  if (!parentPath) {
    return { ok: false, message: '缺少父目录名称，无法创建目录。' }
  }
  if (!directoryName) {
    return { ok: false, message: '缺少目录名称，无法创建目录。' }
  }
  if (/[\\/]/.test(directoryName)) {
    return { ok: false, message: '目录名只能是单个目录名，不能包含路径。' }
  }

  const resolved = await resolveWorkspaceChildPath({
    workspaceRoot,
    parentPath,
    childName: directoryName,
  })

  if (!resolved.ok) {
    return { ok: false, message: resolved.message }
  }

  const siblings = await listFolder(resolved.parentResolvedPath)
  if (!siblings.ok) {
    return { ok: false, message: siblings.error.message || '读取父目录失败。' }
  }

  if (siblings.data.some((entry) => entry.kind === 'dir' && entry.name === directoryName)) {
    return { ok: false, message: `目标目录已存在：${directoryName}` }
  }

  const created = await createFolder(resolved.createdPath)
  if (!created.ok) {
    return { ok: false, message: created.error.message || `创建目录失败：${directoryName}` }
  }

  return {
    ok: true,
    createdDirectoryPath: resolved.createdPath,
    directoryName,
    message: `已创建目录：${directoryName}`,
  }
}
