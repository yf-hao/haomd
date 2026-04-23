export const UNTITLED_FILE_PATH = 'untitled'

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').trim()
}

export function isTransientFilePath(path?: string | null): boolean {
  if (!path) {
    return true
  }

  return normalizePath(path) === UNTITLED_FILE_PATH
}

export function normalizePersistableFilePath(path?: string | null): string | null {
  if (isTransientFilePath(path)) {
    return null
  }

  return normalizePath(path!)
}
