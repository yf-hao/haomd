import type { SearchScope } from './types'

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function dedupe(list: string[]): string[] {
  return Array.from(new Set(list.map(normalizePath)))
}

export function buildSearchScope(params: {
  folderRoots: string[]
  standaloneFiles: Array<{ path: string }>
}): SearchScope {
  return {
    folderRoots: dedupe(params.folderRoots),
    standaloneFiles: dedupe(params.standaloneFiles.map((file) => file.path)),
  }
}
