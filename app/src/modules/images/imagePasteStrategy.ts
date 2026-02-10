export type ImagePathStrategyMode = 'current-file-dir' | 'workspace-root'

export interface ImagePathStrategyConfig {
  mode: ImagePathStrategyMode
  subdir: string
  filenamePrefix: string
}

export interface ResolvedImageTarget {
  targetDir: string
  relDir: string
}

export function loadDefaultImagePathStrategyConfig(): ImagePathStrategyConfig {
  return {
    mode: 'current-file-dir',
    subdir: 'images',
    filenamePrefix: 'image',
  }
}

function dirnameCrossPlatform(filePath: string): string {
  if (!filePath) return filePath
  const normalized = filePath.replace(/[\\/]/g, '/')
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash <= 0) return filePath
  return normalized.slice(0, lastSlash)
}

export function resolveImageTarget(
  currentFilePath: string,
  workspaceRoot: string | null,
  cfg: ImagePathStrategyConfig,
): ResolvedImageTarget {
  const baseDir = cfg.mode === 'workspace-root'
    ? (workspaceRoot || dirnameCrossPlatform(currentFilePath))
    : dirnameCrossPlatform(currentFilePath)

  const sep = baseDir.includes('\\') ? '\\' : '/'
  const targetDir = baseDir.endsWith(sep)
    ? `${baseDir}${cfg.subdir}`
    : `${baseDir}${sep}${cfg.subdir}`

  return {
    targetDir,
    relDir: cfg.subdir,
  }
}
