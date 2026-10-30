import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useSidebarClipboard } from './useSidebarClipboard'
import { copyFsEntry } from '../modules/files/service'

vi.mock('../modules/files/service', () => ({ copyFsEntry: vi.fn() }))
vi.mock('../modules/i18n/I18nContext', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
beforeEach(() => { vi.mocked(copyFsEntry).mockReset() })
const source = { path: '/root/source', kind: 'tree-dir' as const }
const target = { path: '/other/note.md', kind: 'tree-file' as const }

it('pastes into a file’s parent, refreshes, and allows repeated paste', async () => {
  const onPasted = vi.fn(async () => {})
  const { result } = renderHook(() => useSidebarClipboard({ copyEntry: copyFsEntry, notify: vi.fn(), onPasted }))
  vi.mocked(copyFsEntry).mockResolvedValue('/other/source')
  act(() => result.current.copy(source))
  await act(() => result.current.paste(target))
  expect(copyFsEntry).toHaveBeenCalledWith('/root/source', '/other')
  expect(onPasted).toHaveBeenCalledWith([{ entry: source, value: '/other/source' }], '/other')
  expect(result.current.canPaste).toBe(true)
  await act(() => result.current.paste(target))
  expect(copyFsEntry).toHaveBeenCalledTimes(2)
})

it('prevents concurrent paste and recovers after failure', async () => {
  const notify = vi.fn()
  const onPasted = vi.fn(async () => {})
  const { result } = renderHook(() => useSidebarClipboard({ copyEntry: copyFsEntry, notify, onPasted }))
  let finish!: (path: string) => void
  vi.mocked(copyFsEntry).mockReturnValue(new Promise(resolve => { finish = resolve }))
  act(() => result.current.copy(source))
  let pending!: Promise<void>
  act(() => { pending = result.current.paste(target) })
  await act(() => result.current.paste(target))
  expect(copyFsEntry).toHaveBeenCalledTimes(1)
  await act(async () => { finish('/other/source'); await pending })
  onPasted.mockClear()
  vi.mocked(copyFsEntry).mockRejectedValueOnce(new Error('missing source'))
  await act(async () => { await result.current.paste(target) })
  expect(onPasted).not.toHaveBeenCalled()
  expect(notify).toHaveBeenLastCalledWith(expect.stringContaining('missing source'))
  expect(result.current.canPaste).toBe(true)
})

it('keeps a multi-copy snapshot and refreshes once after mixed results', async () => {
  const onPasted = vi.fn(async () => {})
  const notify = vi.fn()
  const { result } = renderHook(() => useSidebarClipboard({ copyEntry: copyFsEntry, notify, onPasted }))
  const selection = [source, { path: '/root/fail.md', kind: 'tree-file' as const }, { path: '/root/ok.md', kind: 'tree-file' as const }]
  act(() => result.current.copy(selection))
  selection.pop()
  vi.mocked(copyFsEntry).mockImplementation(async path => {
    if (path.endsWith('fail.md')) throw new Error('denied')
    return '/other/' + path.split('/').pop()
  })
  await act(async () => { await result.current.paste(target) })
  expect(copyFsEntry).toHaveBeenCalledTimes(3)
  expect(onPasted).toHaveBeenCalledTimes(1)
  expect(onPasted).toHaveBeenCalledWith([
    { entry: source, value: '/other/source' },
    { entry: { path: '/root/ok.md', kind: 'tree-file' }, value: '/other/ok.md' },
  ], '/other')
  expect(notify).toHaveBeenLastCalledWith(expect.stringContaining('/root/fail.md: denied'))
})
