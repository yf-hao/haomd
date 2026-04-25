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

function getRelativePathFromWorkspaceRoot(workspaceRoot: string, targetPath: string): string {
  const normalizedWorkspaceRoot = normalizePath(workspaceRoot)
  const normalizedTargetPath = normalizePath(targetPath)
  if (normalizedTargetPath === normalizedWorkspaceRoot) {
    return getPathBaseName(normalizedWorkspaceRoot)
  }
  const prefix = `${normalizedWorkspaceRoot}/`
  if (!normalizedTargetPath.startsWith(prefix)) {
    return getPathBaseName(normalizedTargetPath)
  }
  return normalizedTargetPath.slice(prefix.length)
}

function buildCandidateDisplay(relativePath: string, workspaceRootName?: string): string {
  const normalizedRelativePath = relativePath || '.'
  const normalizedWorkspaceRootName = workspaceRootName?.trim() ?? ''
  if (!normalizedWorkspaceRootName) {
    return normalizedRelativePath
  }
  if (
    normalizedRelativePath === normalizedWorkspaceRootName ||
    normalizedRelativePath.startsWith(`${normalizedWorkspaceRootName}/`)
  ) {
    return normalizedRelativePath
  }
  return `${normalizedWorkspaceRootName}/${normalizedRelativePath}`
}

function buildWorkspaceScopedCandidateDisplay(args: {
  relativePath: string
  workspaceRoot: string
  duplicatedRelativePath: boolean
  duplicatedWorkspaceRootName: boolean
}): string {
  if (!args.duplicatedRelativePath) {
    return buildCandidateDisplay(args.relativePath)
  }

  if (args.duplicatedWorkspaceRootName) {
    return buildCandidateDisplay(args.relativePath, normalizePath(args.workspaceRoot))
  }

  return buildCandidateDisplay(args.relativePath, getPathBaseName(args.workspaceRoot))
}

function getPathBaseName(path: string): string {
  const normalized = normalizePath(path)
  const segments = normalized.split('/').filter(Boolean)
  return segments[segments.length - 1] ?? normalized
}

function debugWorkspaceEntryResolver(label: string, payload: Record<string, unknown>): void {
  console.debug(`[workspaceEntryResolver] ${label}`, payload)
}

function resolveWorkspaceRoots(workspaceRoot?: string | null): WorkspaceRootsResolution {
  const normalizedWorkspaceRoot = workspaceRoot ? normalizePath(workspaceRoot) : ''
  if (normalizedWorkspaceRoot) {
    return { ok: true, workspaceRoots: [normalizedWorkspaceRoot] }
  }

  const mountedRoots = Array.from(new Set(getWorkspaceMountedRoots().map(normalizePath)))
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
  output: IndexedWorkspaceEntry[],
): Promise<{ ok: true } | { ok: false; message: string }> {
  const listed = await listFolder(workspaceRoot)
  if (!listed.ok) {
    return { ok: false, message: listed.error.message || `读取目录失败：${workspaceRoot}` }
  }

  for (const entry of listed.data) {
    output.push({
      path: entry.path,
      relativePath: getRelativePathFromWorkspaceRoot(workspaceRoot, entry.path),
      name: entry.name,
      kind: entry.kind,
    })
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

  debugWorkspaceEntryResolver('resolve:start', {
    requestedWorkspaceRoot: args.workspaceRoot ?? null,
    normalizedTarget,
    expectedKind: expectedKind ?? null,
    workspaceRoots: rootsResult.workspaceRoots,
  })

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
    const collected = await collectWorkspaceEntries(workspaceRoot, entries)
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
    debugWorkspaceEntryResolver('resolve:rootMatches', {
      workspaceRoot,
      normalizedTarget,
      directMatches: directMatches.map((entry) => ({
        path: normalizePath(entry.path),
        relativePath: normalizePath(entry.relativePath),
        kind: entry.kind,
      })),
      rootPrefixedMatches: rootPrefixedMatches.map((entry) => ({
        path: normalizePath(entry.path),
        relativePath: normalizePath(entry.relativePath),
        kind: entry.kind,
      })),
      rootMatches: rootMatches.map((entry) => ({
        path: normalizePath(entry.path),
        relativePath: normalizePath(entry.relativePath),
        kind: entry.kind,
      })),
    })
    matches.push(...rootMatches)
  }

  const uniqueMatches = matches.filter((entry, index, array) =>
    array.findIndex((candidate) => normalizePath(candidate.path) === normalizePath(entry.path)) === index,
  )

  debugWorkspaceEntryResolver('resolve:deduped', {
    normalizedTarget,
    matches: matches.map((entry) => ({
      workspaceRoot: entry.workspaceRoot,
      path: normalizePath(entry.path),
      relativePath: normalizePath(entry.relativePath),
      kind: entry.kind,
    })),
    uniqueMatches: uniqueMatches.map((entry) => ({
      workspaceRoot: entry.workspaceRoot,
      path: normalizePath(entry.path),
      relativePath: normalizePath(entry.relativePath),
      kind: entry.kind,
    })),
  })

  if (!uniqueMatches.length) {
    return {
      ok: false,
      reason: 'not_found',
      message: `未在当前工作区中找到目标：${normalizedTarget}`,
    }
  }

  if (uniqueMatches.length > 1) {
    const relativePathCounts = new Map<string, number>()
    const workspaceRootNameCounts = new Map<string, number>()
    uniqueMatches.forEach((entry) => {
      const currentCount = relativePathCounts.get(entry.relativePath) ?? 0
      relativePathCounts.set(entry.relativePath, currentCount + 1)
      const workspaceRootName = getPathBaseName(entry.workspaceRoot)
      const currentRootNameCount = workspaceRootNameCounts.get(workspaceRootName) ?? 0
      workspaceRootNameCounts.set(workspaceRootName, currentRootNameCount + 1)
    })

    const candidates = uniqueMatches.map((entry) => {
      const workspaceRootName = getPathBaseName(entry.workspaceRoot)
      return buildWorkspaceScopedCandidateDisplay({
        relativePath: entry.relativePath,
        workspaceRoot: entry.workspaceRoot,
        duplicatedRelativePath: (relativePathCounts.get(entry.relativePath) ?? 0) > 1,
        duplicatedWorkspaceRootName: (workspaceRootNameCounts.get(workspaceRootName) ?? 0) > 1,
      })
    })
    debugWorkspaceEntryResolver('resolve:ambiguous', {
      normalizedTarget,
      candidates,
      uniqueMatches: uniqueMatches.map((entry) => ({
        workspaceRoot: entry.workspaceRoot,
        path: normalizePath(entry.path),
        relativePath: normalizePath(entry.relativePath),
        kind: entry.kind,
      })),
    })
    return {
      ok: false,
      reason: 'ambiguous',
      message: `目标存在歧义，请指定更完整的路径：${candidates.join('、')}`,
      candidates,
    }
  }

  const match = uniqueMatches[0]!
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
