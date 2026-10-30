import { getFilePathIdentity } from '../modules/files/filePathState'

export type FileBrowserEntry = {
  path: string
  kind: 'standalone-file' | 'folder-root' | 'tree-file' | 'tree-dir'
}
export const entryKey = (entry: FileBrowserEntry) => getFilePathIdentity(entry.path)
export const isDirectoryEntry = (entry: FileBrowserEntry) => entry.kind === 'tree-dir' || entry.kind === 'folder-root'
export function entryContainsPath(entry: FileBrowserEntry, path: string): boolean {
  const parent = entryKey(entry)
  const child = getFilePathIdentity(path)
  return child === parent || (isDirectoryEntry(entry) && child.startsWith(parent.endsWith('/') ? parent : parent + '/'))
}

/** One operation per normalized path; a selected directory already includes its descendants. */
export function operationEntries(entries: readonly FileBrowserEntry[]): FileBrowserEntry[] {
  const unique = [...new Map(entries.map(entry => [entryKey(entry), entry])).values()]
  return unique.filter(entry => !unique.some(parent => parent !== entry && isDirectoryEntry(parent) && entryContainsPath(parent, entry.path)))
}

export type FileSelection = { entries: FileBrowserEntry[]; anchor: string | null }
export const emptyFileSelection: FileSelection = { entries: [], anchor: null }
export function selectFileEntry(
  previous: FileSelection, target: FileBrowserEntry, visible: readonly FileBrowserEntry[],
  mode: 'single' | 'toggle' | 'range' | 'context',
): FileSelection {
  const key = entryKey(target)
  const selected = previous.entries.some(entry => entryKey(entry) === key)
  if (mode === 'context' && selected) return previous
  if (mode === 'range' && previous.anchor) {
    const start = visible.findIndex(entry => entryKey(entry) === previous.anchor)
    const end = visible.findIndex(entry => entryKey(entry) === key)
    if (start >= 0 && end >= 0) {
      const range = visible.slice(Math.min(start, end), Math.max(start, end) + 1)
      return { anchor: previous.anchor, entries: [...new Map(range.map(entry => [entryKey(entry), entry])).values()] }
    }
  }
  if (mode === 'toggle') {
    return { anchor: key, entries: selected
      ? previous.entries.filter(entry => entryKey(entry) !== key)
      : [...previous.entries, target] }
  }
  return { anchor: key, entries: [target] }
}
