function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/[\\/]+$/, '')
}

let mountedRoots: string[] = []

export function setWorkspaceMountedRoots(roots: string[]): void {
  mountedRoots = Array.from(
    new Set(
      roots
        .map((root) => root.trim())
        .filter(Boolean)
        .map(normalizePath),
    ),
  )
}

export function getWorkspaceMountedRoots(): string[] {
  return [...mountedRoots]
}
