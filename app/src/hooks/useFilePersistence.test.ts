import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useFilePersistence } from './useFilePersistence'
import { writeFile } from '../modules/files/service'
import type { Result, WriteResult } from '../modules/files/types'
import { workspaceDocumentOperations } from '../modules/document/documentOperationCoordinator'

vi.mock('../modules/files/service', () => ({
  writeFile: vi.fn(), clearRecentRemote: vi.fn(), deleteRecentRemote: vi.fn(),
  logRecentFile: vi.fn(), readFile: vi.fn(),
}))
vi.mock('../modules/platform/runtime', () => ({ isTauriEnv: () => false }))

describe('saving editor snapshots', () => {
  it('restores each document baseline after switching to a relocated background tab', async () => {
    const { result } = renderHook(() => useFilePersistence('background edits'))
    act(() => result.current.setFilePath('/index.md'))
    act(() => {
      result.current.relocatePersistedDocument('/old/a.md', { path: '/new/a.md', content: 'saved a', hash: 'a-new', mtimeMs: 10 }, 'background edits')
      result.current.relocatePersistedDocument('/index.md', { path: '/index.md', content: 'saved index', hash: 'i-new', mtimeMs: 20 }, 'index edits')
    })
    act(() => result.current.setFilePath('/new/a.md'))
    vi.mocked(writeFile).mockResolvedValueOnce({ ok: true, data: { code: 'OK', path: '/new/a.md', hash: 'saved-a', mtimeMs: 11 } })
    await act(async () => { await result.current.handleSave() })
    expect(writeFile).toHaveBeenLastCalledWith({ path: '/new/a.md', content: 'background edits', expectedHash: 'a-new', expectedMtime: 10 })
    act(() => result.current.setFilePath('/index.md'))
    expect(result.current.currentHash).toBe('i-new')
    expect(result.current.currentMtime).toBe(20)
  })

  it('a save queued behind a move uses the relocated path, baseline and latest input', async () => {
    let latest = '[image](a.png)'
    const { result } = renderHook(() => useFilePersistence(latest, {
      getDocumentKey: () => 'A', getLatestMarkdown: () => latest,
    }))
    act(() => result.current.setFilePath('/old/a.md'))
    let finish!: () => void
    const moving = workspaceDocumentOperations.run(() => new Promise<void>(resolve => { finish = resolve }))
    vi.mocked(writeFile).mockResolvedValueOnce({ ok: true, data: { code: 'OK', path: '/new/a.md', hash: 'saved', mtimeMs: 3 } })
    let saving!: ReturnType<typeof result.current.handleSave>
    act(() => { saving = result.current.handleSave() })
    latest = '[image](../old/a.png) new input'
    act(() => result.current.relocatePersistedDocument('/old/a.md', {
      path: '/new/a.md', content: '[image](../old/a.png)', hash: 'moved', mtimeMs: 2,
    }, latest))
    const dirtyAfterMove = result.current.dirty
    await act(async () => { finish(); await moving; await saving })
    expect(dirtyAfterMove).toBe(true)
    expect(writeFile).toHaveBeenLastCalledWith({ path: '/new/a.md', content: latest, expectedHash: 'moved', expectedMtime: 2 })
    expect(result.current.dirty).toBe(false)
    expect(result.current.filePath).toBe('/new/a.md')
  })

  it('does not reuse an old document hash when saving as a new file', async () => {
    const { result } = renderHook(() => useFilePersistence('content'))
    act(() => result.current.setFilePath('/old/a.md'))
    act(() => result.current.relocatePersistedDocument('/old/a.md', {
      path: '/new/a.md', content: 'content', hash: 'moved', mtimeMs: 2,
    }, 'content'))
    vi.mocked(writeFile).mockResolvedValueOnce({ ok: true, data: { code: 'OK', path: '/copy.md', hash: 'copy', mtimeMs: 3 } })
    await act(async () => { await result.current.handleSave('/copy.md') })
    expect(writeFile).toHaveBeenLastCalledWith({ path: '/copy.md', content: 'content', expectedHash: undefined, expectedMtime: undefined })
  })

  it('keeps edits made during an asynchronous save dirty', async () => {
    let latest = 'saved version'
    let complete!: (result: Result<WriteResult>) => void
    vi.mocked(writeFile).mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    const onSaved = vi.fn()
    const { result } = renderHook(() => useFilePersistence('saved version', {
      getDocumentKey: () => 'A', getLatestMarkdown: () => latest, onSaved,
    }))
    let pending!: ReturnType<typeof result.current.handleSave>
    act(() => { pending = result.current.handleSave('/a.md', latest) })
    latest = 'new input during save'
    await act(async () => {
      complete({ ok: true, data: { code: 'OK', path: '/a.md', hash: 'hash', mtimeMs: 1 } })
      await pending
    })
    expect(result.current.dirty).toBe(true)
    expect(onSaved).toHaveBeenCalledWith('/a.md', {
      documentKey: 'A', content: 'saved version', latestContent: latest,
    })
  })

  it('does not change another document when a save completes after a tab switch', async () => {
    let documentKey = 'A'
    let complete!: (result: Result<WriteResult>) => void
    vi.mocked(writeFile).mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    const onSavedA = vi.fn()
    const onSavedB = vi.fn()
    const { result, rerender } = renderHook(({ onSaved }) => useFilePersistence('text', {
      getDocumentKey: () => documentKey, getLatestMarkdown: () => 'text', onSaved,
    }), { initialProps: { onSaved: onSavedA } })
    act(() => { result.current.setFilePath('/a.md') })
    let pending!: ReturnType<typeof result.current.handleSave>
    act(() => { pending = result.current.handleSave() })
    documentKey = 'B'
    rerender({ onSaved: onSavedB })
    act(() => { result.current.setFilePath('/b.md'); result.current.markDirty() })
    await act(async () => {
      complete({ ok: true, data: { code: 'OK', path: '/a.md', hash: 'hash', mtimeMs: 1 } })
      await pending
    })
    expect(result.current.filePath).toBe('/b.md')
    expect(result.current.dirty).toBe(true)
    expect(onSavedA).toHaveBeenCalledWith('/a.md', { documentKey: 'A', content: 'text', latestContent: undefined })
    expect(onSavedB).not.toHaveBeenCalled()
  })
})
