import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDirectoryInWorkspace } from './createDirectoryInWorkspaceService'
import { createFolder, listFolder } from '../../files/service'
import { resolveWorkspaceChildPath } from '../../workspace/workspaceEntryResolver'

vi.mock('../../files/service', () => ({
  createFolder: vi.fn(),
  listFolder: vi.fn(),
}))

vi.mock('../../workspace/workspaceEntryResolver', () => ({
  resolveWorkspaceChildPath: vi.fn(),
}))

describe('createDirectoryInWorkspaceService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects directoryName with path separators', async () => {
    const result = await createDirectoryInWorkspace(
      { parentPath: 'temp', directoryName: 'a/b' },
      { getWorkspaceRoot: () => '/root' },
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('不能包含路径')
    }
  })

  it('creates directory after resolving parent', async () => {
    vi.mocked(resolveWorkspaceChildPath).mockResolvedValue({
      ok: true,
      workspaceRoot: '/root',
      parentResolvedPath: '/root/temp',
      createdPath: '/root/temp/demo',
    })
    vi.mocked(listFolder).mockResolvedValue({ ok: true, data: [] } as any)
    vi.mocked(createFolder).mockResolvedValue({ ok: true, data: null } as any)

    const result = await createDirectoryInWorkspace(
      { parentPath: 'temp', directoryName: 'demo' },
      { getWorkspaceRoot: () => '/root' },
    )

    expect(result.ok).toBe(true)
    expect(createFolder).toHaveBeenCalledWith('/root/temp/demo')
  })
})
