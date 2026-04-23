function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/[\\/]+$/, '')
}

let activeWorkspaceDirectory: string | null = null

export function setActiveWorkspaceDirectory(path: string | null | undefined): void {
  const trimmed = path?.trim()
  activeWorkspaceDirectory = trimmed ? normalizePath(trimmed) : null
}

export function getActiveWorkspaceDirectory(): string | null {
  return activeWorkspaceDirectory
}
