export type ResolveSelectionBaseDirectoryArgs = {
  selectedFolderPath?: string | null
  currentFilePath?: string | null
  fallbackRoot?: string | null
}

export function computeDirFromPath(targetPath: string): string {
  if (!targetPath) return targetPath

  const hasBackslash = targetPath.includes('\\')
  const normalized = targetPath.replace(/[\\/]/g, '/')
  const lastSlash = normalized.lastIndexOf('/')

  if (lastSlash <= 0) {
    return targetPath
  }

  let dir = normalized.slice(0, lastSlash)
  if (hasBackslash) {
    dir = dir.replace(/\//g, '\\')
  }

  return dir
}

export function resolveSelectionBaseDirectory(
  args: ResolveSelectionBaseDirectoryArgs,
): string | null {
  if (args.selectedFolderPath) {
    return args.selectedFolderPath
  }
  if (args.currentFilePath) {
    return computeDirFromPath(args.currentFilePath)
  }
  if (args.fallbackRoot) {
    return args.fallbackRoot
  }
  return null
}
