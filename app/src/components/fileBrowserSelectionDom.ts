import type { FileBrowserEntry } from '../domain/fileBrowserSelection'

export const fileBrowserRowSelector = '[data-file-source], [data-file-directory]'
export function entryFromRow(row: HTMLElement): FileBrowserEntry {
  return {
    path: row.dataset.fileDirectory ?? row.dataset.fileSource!,
    kind: row.dataset.fileKind as FileBrowserEntry['kind'],
  }
}
export function visibleFileEntries(container: HTMLElement): FileBrowserEntry[] {
  return Array.from(container.querySelectorAll<HTMLElement>(fileBrowserRowSelector), entryFromRow)
}
