export const UNTITLED_FILE_PATH = 'untitled'

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').trim()
}

export function getFilePathIdentity(path: string): string {
  let normalized = normalizePath(path).replace(/^\/\/\?\//, '')
  const isWindowsPath = /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//')
  normalized = normalized.replace(/\/+/g, '/')

  if (normalized.length > 1 && !/^[A-Za-z]:\/$/.test(normalized)) {
    normalized = normalized.replace(/\/+$/, '')
  }

  return isWindowsPath ? normalized.toLocaleLowerCase('en-US') : normalized
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
