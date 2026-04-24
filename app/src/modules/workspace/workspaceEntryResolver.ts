import { listFolder } from '../files/service'
import { getWorkspaceMountedRoots } from './workspaceMountedRoots'

export type WorkspaceEntryKind = 'file' | 'dir'

export type ResolvedWorkspaceEntry =
  | {
      ok: true
      workspaceRoot: string
      resolvedPath: string
      kind: WorkspaceEntryKind
      name: string
      relativePath: string
    }
  | {
      ok: false
      reason: 'no_workspace' | 'invalid_target' | 'not_found' | 'ambiguous' | 'io_error'
      message: string
      candidates?: string[]
    }

type IndexedWorkspaceEntry = {
  path: string
  relativePath: string
  name: string
  kind: WorkspaceEntryKind
}

type WorkspaceRootsResolution =
  | { ok: true; workspaceRoots: string[] }
  | { ok: false; reason: 'no_workspace'; message: string }

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/[\\/]+$/, '')
}

function normalizeTargetPath(targetPath: string): string {
  return normalizePath(targetPath.trim()).replace(/^\/+/, '')
}

function joinPath(base: string, child: string): string {
  return `${normalizePath(base)}/${child.replace(/^\/+/, '')}`
}

function buildCandidateDisplay(relativePath: string): string {
  return relativePath || '.'
}

function getPathBaseName(path: string): string {
  const normalized = normalizePath(path)
  const segments = normalized.split('/').filter(Boolean)
  return segments[segments.length - 1] ?? normalized
}

function resolveWorkspaceRoots(workspaceRoot?: string | null): WorkspaceRootsResolution {
  const normalizedWorkspaceRoot = workspaceRoot ? normalizePath(workspaceRoot) : ''
  if (normalizedWorkspaceRoot) {
    return { ok: true, workspaceRoots: [normalizedWorkspaceRoot] }
  }

  const mountedRoots = getWorkspaceMountedRoots().map(normalizePath)
  if (!mountedRoots.length) {
    return {
      ok: false,
      reason: 'no_workspace',
      message: '当前工作区未确定，无法按名称解析目标。',
    }
  }

  return { ok: true, workspaceRoots: mountedRoots }
}

async function collectWorkspaceEntries(
  workspaceRoot: string,
  currentDirectory: string,
  relativeDirectory: string,
  output: IndexedWorkspaceEntry[],
): Promise<{ ok: true } | { ok: false; message: string }> {
  const listed = await listFolder(currentDirectory)
  if (!listed.ok) {
    return { ok: false, message: listed.error.message || `读取目录失败：${currentDirectory}` }
  }

  for (const entry of listed.data) {
    const childRelativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name

    output.push({
      path: entry.path,
      relativePath: childRelativePath,
      name: entry.name,
      kind: entry.kind,
    })

    if (entry.kind === 'dir') {
      const nested = await collectWorkspaceEntries(
        workspaceRoot,
        entry.path,
        childRelativePath,
        output,
      )
      if (!nested.ok) {
        return nested
      }
    }
  }

  return { ok: true }
}

function findMatchingEntries(
  entries: IndexedWorkspaceEntry[],
  targetPath: string,
  expectedKind?: WorkspaceEntryKind,
): IndexedWorkspaceEntry[] {
  const normalizedTarget = normalizeTargetPath(targetPath)
  if (!normalizedTarget) {
    return []
  }

  const filtered = expectedKind
    ? entries.filter((entry) => entry.kind === expectedKind)
    : entries

  if (!normalizedTarget.includes('/')) {
    return filtered.filter((entry) => entry.name === normalizedTarget)
  }

  return filtered.filter((entry) => {
    const normalizedRelative = normalizePath(entry.relativePath)
    return (
      normalizedRelative === normalizedTarget ||
      normalizedRelative.endsWith(`/${normalizedTarget}`)
    )
  })
}

export function resolveCurrentWorkspaceRoot(args: {
  selectedFolderPath?: string | null
  currentFilePath?: string | null
  folderRoots: string[]
}): string | null {
  const selectedFolderPath = args.selectedFolderPath ? normalizePath(args.selectedFolderPath) : null
  const currentFilePath = args.currentFilePath ? normalizePath(args.currentFilePath) : null
  const normalizedRoots = args.folderRoots.map(normalizePath)

  const findContainingRoot = (targetPath: string | null): string | null => {
    if (!targetPath) return null
    return normalizedRoots.find((root) => targetPath === root || targetPath.startsWith(`${root}/`)) ?? null
  }

  return findContainingRoot(selectedFolderPath) ??
    findContainingRoot(currentFilePath) ??
    (normalizedRoots.length === 1 ? normalizedRoots[0]! : null)
}

export async function resolveWorkspaceEntryByName(args: {
  workspaceRoot?: string | null
  targetPath?: string | null
  expectedKind?: WorkspaceEntryKind
}): Promise<ResolvedWorkspaceEntry> {
  const targetPath = args.targetPath?.trim() ?? ''
  const expectedKind = args.expectedKind

  const normalizedTarget = normalizeTargetPath(targetPath)
  if (!normalizedTarget || normalizedTarget === '.' || normalizedTarget.includes('//')) {
    return {
      ok: false,
      reason: 'invalid_target',
      message: '目标名称无效，无法解析。',
    }
  }

  const rootsResult = resolveWorkspaceRoots(args.workspaceRoot)
  if (!rootsResult.ok) {
    return rootsResult
  }

  const matches: Array<IndexedWorkspaceEntry & { workspaceRoot: string }> = []
  for (const workspaceRoot of rootsResult.workspaceRoots) {
    const entries: IndexedWorkspaceEntry[] = []
    const rootName = getPathBaseName(workspaceRoot)
    if (rootName) {
      entries.push({
        path: workspaceRoot,
        relativePath: rootName,
        name: rootName,
        kind: 'dir',
      })
    }
    const collected = await collectWorkspaceEntries(workspaceRoot, workspaceRoot, '', entries)
    if (!collected.ok) {
      return {
        ok: false,
        reason: 'io_error',
        message: collected.message,
      }
    }

    const directMatches = findMatchingEntries(entries, normalizedTarget, expectedKind)
    const rootPrefixedMatches =
      rootName && normalizedTarget.startsWith(`${rootName}/`)
        ? findMatchingEntries(
          entries,
          normalizedTarget.slice(rootName.length + 1),
          expectedKind,
        )
        : []
    const rootMatches = [...directMatches, ...rootPrefixedMatches]
      .filter((entry, index, array) =>
        array.findIndex((candidate) => normalizePath(candidate.path) === normalizePath(entry.path)) === index,
      )
      .map((entry) => ({
        ...entry,
        workspaceRoot,
      }))
    matches.push(...rootMatches)
  }

  if (!matches.length) {
    return {
      ok: false,
      reason: 'not_found',
      message: `未在当前工作区中找到目标：${normalizedTarget}`,
    }
  }

  if (matches.length > 1) {
    return {
      ok: false,
      reason: 'ambiguous',
      message: `目标存在歧义，请指定更完整的路径：${matches.map((entry) => buildCandidateDisplay(entry.relativePath)).join('、')}`,
      candidates: matches.map((entry) => buildCandidateDisplay(entry.relativePath)),
    }
  }

  const match = matches[0]!
  return {
    ok: true,
    workspaceRoot: match.workspaceRoot,
    resolvedPath: normalizePath(match.path),
    kind: match.kind,
    name: match.name,
    relativePath: normalizePath(match.relativePath),
  }
}

export async function resolveWorkspaceChildPath(args: {
  workspaceRoot?: string | null
  parentPath?: string | null
  childName?: string | null
}): Promise<
  | { ok: true; workspaceRoot: string; parentResolvedPath: string; createdPath: string }
  | { ok: false; reason: 'no_workspace' | 'invalid_target' | 'not_found' | 'ambiguous' | 'io_error'; message: string; candidates?: string[] }
> {
  const childName = args.childName?.trim() ?? ''
  if (!childName || /[\\/]/.test(childName)) {
    return {
      ok: false,
      reason: 'invalid_target',
      message: '目录名只能是单个名称，不能包含路径。',
    }
  }

  const parent = await resolveWorkspaceEntryByName({
    workspaceRoot: args.workspaceRoot,
    targetPath: args.parentPath,
    expectedKind: 'dir',
  })

  if (!parent.ok) {
    return parent
  }

  return {
    ok: true,
    workspaceRoot: parent.workspaceRoot,
    parentResolvedPath: parent.resolvedPath,
    createdPath: joinPath(parent.resolvedPath, childName),
  }
}
