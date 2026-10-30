import { expect, it, vi } from 'vitest'
import { copyFileBatch, runFileBatch } from './fileBatchOperations'
import type { FileBrowserEntry } from '../../../domain/fileBrowserSelection'
const entries: FileBrowserEntry[] = [
  { path: '/a', kind: 'tree-dir' }, { path: '/a/child.md', kind: 'tree-file' },
  { path: '/b.md', kind: 'tree-file' }, { path: '/c.md', kind: 'tree-file' },
]
it('operates on parents only, continues after failure, and reports exact successes', async () => {
  const remove = vi.fn(async (entry: FileBrowserEntry) => { if (entry.path === '/b.md') throw new Error('denied') })
  const result = await runFileBatch(entries, remove)
  expect(remove.mock.calls.map(([entry]) => entry.path)).toEqual(['/a', '/b.md', '/c.md'])
  expect(result.succeeded.map(item => item.entry.path)).toEqual(['/a', '/c.md'])
  expect(result.failed).toEqual([{ entry: entries[2], message: 'denied' }])
})
it('rejects recursive copy while allowing the other selected files to be pasted', async () => {
  const copy = vi.fn(async (path: string) => path + '-copy')
  const result = await copyFileBatch(entries, '/a/sub', copy, 'invalid destination')
  expect(copy.mock.calls.map(([path]) => path)).toEqual(['/b.md', '/c.md'])
  expect(result.failed[0]).toEqual({ entry: entries[0], message: 'invalid destination' })
  expect(result.succeeded).toHaveLength(2)
})
