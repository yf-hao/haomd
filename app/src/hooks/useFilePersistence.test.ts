import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useFilePersistence } from './useFilePersistence'
import { writeFile } from '../modules/files/service'
import type { Result, WriteResult } from '../modules/files/types'

vi.mock('../modules/files/service', () => ({
  writeFile: vi.fn(), clearRecentRemote: vi.fn(), deleteRecentRemote: vi.fn(),
  logRecentFile: vi.fn(), readFile: vi.fn(),
}))
vi.mock('../modules/platform/runtime', () => ({ isTauriEnv: () => false }))

describe('saving editor snapshots', () => {
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
