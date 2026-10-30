import { renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useSidebarBatchDelete } from './useSidebarBatchDelete'
import type { FileBrowserEntry } from '../domain/fileBrowserSelection'
const entries: FileBrowserEntry[] = [{ path: '/a', kind: 'tree-dir' }, { path: '/a/note.md', kind: 'tree-file' }, { path: '/b.md', kind: 'tree-file' }]
it('confirms once, reconciles only successes once, and reports partial failure', async () => {
  const options = {
    confirm: vi.fn(async () => true),
    remove: vi.fn(async (entry: FileBrowserEntry) => { if (entry.path === '/b.md') throw new Error('denied') }),
    onDeleted: vi.fn(async () => {}), report: vi.fn(), onError: vi.fn(),
  }
  const { result } = renderHook(() => useSidebarBatchDelete(options))
  await result.current(entries)
  expect(options.confirm).toHaveBeenCalledExactlyOnceWith([entries[0], entries[2]])
  expect(options.onDeleted).toHaveBeenCalledExactlyOnceWith([entries[0]])
  expect(options.report.mock.calls[0][0].failed).toHaveLength(1)
  expect(options.onError).not.toHaveBeenCalled()
})
it('does not delete after cancellation and prevents duplicate confirmations', async () => {
  let finish!: (value: boolean) => void
  const options = {
    confirm: vi.fn(() => new Promise<boolean>(resolve => { finish = resolve })),
    remove: vi.fn(async () => {}), onDeleted: vi.fn(async () => {}), report: vi.fn(), onError: vi.fn(),
  }
  const { result } = renderHook(() => useSidebarBatchDelete(options))
  const pending = result.current(entries)
  await result.current(entries)
  expect(options.confirm).toHaveBeenCalledTimes(1)
  finish(false)
  await pending
  expect(options.remove).not.toHaveBeenCalled()
})
