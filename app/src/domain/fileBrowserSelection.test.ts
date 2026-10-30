import { expect, it } from 'vitest'
import { emptyFileSelection, operationEntries, selectFileEntry, type FileBrowserEntry } from './fileBrowserSelection'
const file = (path: string): FileBrowserEntry => ({ path, kind: 'tree-file' })
const visible = [file('/a.md'), { path: '/folder', kind: 'tree-dir' as const }, file('/z.md')]

it('selects a visible range in either direction without changing the anchor', () => {
  const first = selectFileEntry(emptyFileSelection, visible[2], visible, 'single')
  const range = selectFileEntry(first, visible[0], visible, 'range')
  expect(range.entries).toEqual(visible)
  expect(range.anchor).toBe('/z.md')
  expect(selectFileEntry(range, visible[1], visible, 'range').entries).toEqual(visible.slice(1))
})
it('toggles items and preserves selection only when right-clicking a selected entry', () => {
  const first = selectFileEntry(emptyFileSelection, visible[0], visible, 'single')
  const two = selectFileEntry(first, visible[2], visible, 'toggle')
  expect(two.entries).toEqual([visible[0], visible[2]])
  expect(selectFileEntry(two, visible[0], visible, 'context')).toBe(two)
  expect(selectFileEntry(two, visible[1], visible, 'context').entries).toEqual([visible[1]])
  expect(selectFileEntry(two, visible[0], visible, 'toggle').entries).toEqual([visible[2]])
})
it('falls back to a single selection if the range anchor is no longer visible', () => {
  const first = selectFileEntry(emptyFileSelection, file('/hidden.md'), visible, 'single')
  expect(selectFileEntry(first, visible[1], visible, 'range').entries).toEqual([visible[1]])
})
it('deduplicates aliases and removes descendants without treating similar folder names as children', () => {
  const entries: FileBrowserEntry[] = [
    file('C:\\Root\\sub\\a.md'), file('c:/root/sub/a.md'),
    { path: 'C:/Root/sub', kind: 'tree-dir' }, file('C:/Root/sub2/b.md'),
  ]
  expect(operationEntries(entries)).toEqual(entries.slice(2))
})
