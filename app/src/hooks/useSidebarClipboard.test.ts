import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useSidebarClipboard } from './useSidebarClipboard'
import { copyFsEntry } from '../modules/files/service'

vi.mock('../modules/files/service', () => ({ copyFsEntry: vi.fn() }))
vi.mock('../modules/i18n/I18nContext', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
beforeEach(() => vi.mocked(copyFsEntry).mockReset())
const source = { path: '/root/source', kind: 'tree-dir' as const }
const target = { path: '/other/note.md', kind: 'tree-file' as const }

it('pastes into a file’s parent, refreshes, and allows repeated paste', async () => {
  const onPasted = vi.fn(async () => {})
  const { result } = renderHook(() => useSidebarClipboard({ notify: vi.fn(), onPasted }))
  vi.mocked(copyFsEntry).mockResolvedValue('/other/source')
  act(() => result.current.copy(source))
  await act(() => result.current.paste(target))
  expect(copyFsEntry).toHaveBeenCalledWith('/root/source', '/other')
  expect(onPasted).toHaveBeenCalledWith('/other/source', '/other', true)
  expect(result.current.canPaste).toBe(true)
  await act(() => result.current.paste(target))
  expect(copyFsEntry).toHaveBeenCalledTimes(2)
})

it('prevents concurrent paste and recovers after failure', async () => {
  const notify = vi.fn()
  const onPasted = vi.fn(async () => {})
  const { result } = renderHook(() => useSidebarClipboard({ notify, onPasted }))
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
  expect(notify).toHaveBeenLastCalledWith('missing source')
  expect(result.current.canPaste).toBe(true)
})
