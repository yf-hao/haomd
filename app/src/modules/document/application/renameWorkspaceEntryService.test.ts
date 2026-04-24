import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renameWorkspaceEntry } from './renameWorkspaceEntryService'
import { listFolder, renameFsEntry } from '../../files/service'
import { resolveWorkspaceEntryByName } from '../../workspace/workspaceEntryResolver'

vi.mock('../../files/service', () => ({
  listFolder: vi.fn(),
  renameFsEntry: vi.fn(),
}))

vi.mock('../../workspace/workspaceEntryResolver', () => ({
  resolveWorkspaceEntryByName: vi.fn(),
}))

describe('renameWorkspaceEntryService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects newName with path separators', async () => {
    const result = await renameWorkspaceEntry(
      { targetPath: 'temp/hello.md', newName: 'a/b' },
      { getWorkspaceRoot: () => '/root' },
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('不能包含路径')
    }
  })

  it('renames resolved workspace file', async () => {
    vi.mocked(resolveWorkspaceEntryByName).mockResolvedValue({
      ok: true,
      workspaceRoot: '/root',
      resolvedPath: '/root/temp/hello.md',
      kind: 'file',
      name: 'hello.md',
      relativePath: 'temp/hello.md',
    })
    vi.mocked(listFolder).mockResolvedValue({ ok: true, data: [] } as any)
    vi.mocked(renameFsEntry).mockResolvedValue({ ok: true, data: null } as any)

    const result = await renameWorkspaceEntry(
      { targetPath: 'temp/hello.md', newName: 'hi.md', targetKind: 'file' },
      { getWorkspaceRoot: () => '/root' },
    )

    expect(result.ok).toBe(true)
    expect(renameFsEntry).toHaveBeenCalledWith('/root/temp/hello.md', '/root/temp/hi.md')
  })
})
