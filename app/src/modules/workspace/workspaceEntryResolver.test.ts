import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveCurrentWorkspaceRoot, resolveWorkspaceEntryByName } from './workspaceEntryResolver'
import { listFolder } from '../files/service'
import { getWorkspaceMountedRoots } from './workspaceMountedRoots'

vi.mock('../files/service', () => ({
  listFolder: vi.fn(),
}))

vi.mock('./workspaceMountedRoots', () => ({
  getWorkspaceMountedRoots: vi.fn(),
}))

describe('workspaceEntryResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getWorkspaceMountedRoots).mockReturnValue([])
  })

  it('resolves current workspace root from selected folder first', () => {
    const root = resolveCurrentWorkspaceRoot({
      selectedFolderPath: '/root/temp',
      currentFilePath: '/other/doc.md',
      folderRoots: ['/root', '/other'],
    })

    expect(root).toBe('/root')
  })

  it('resolves single-segment target by basename', async () => {
    vi.mocked(listFolder).mockResolvedValueOnce({
      ok: true,
      data: [
        { path: '/root/temp', name: 'temp', kind: 'dir' },
        { path: '/root/hello.md', name: 'hello.md', kind: 'file' },
        { path: '/root/temp/demo', name: 'demo', kind: 'dir' },
      ],
    } as any)

    const result = await resolveWorkspaceEntryByName({
      workspaceRoot: '/root',
      targetPath: 'demo',
      expectedKind: 'dir',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.resolvedPath).toBe('/root/temp/demo')
      expect(result.relativePath).toBe('temp/demo')
    }
  })

  it('resolves slash target by relative-path suffix', async () => {
    vi.mocked(listFolder).mockResolvedValueOnce({
      ok: true,
      data: [
        { path: '/root/temp', name: 'temp', kind: 'dir' },
        { path: '/root/temp/hello.md', name: 'hello.md', kind: 'file' },
      ],
    } as any)

    const result = await resolveWorkspaceEntryByName({
      workspaceRoot: '/root',
      targetPath: 'temp/hello.md',
      expectedKind: 'file',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.resolvedPath).toBe('/root/temp/hello.md')
    }
  })

  it('returns ambiguous when basename has multiple matches', async () => {
    vi.mocked(listFolder).mockResolvedValueOnce({
      ok: true,
      data: [
        { path: '/root/a', name: 'a', kind: 'dir' },
        { path: '/root/b', name: 'b', kind: 'dir' },
        { path: '/root/a/demo', name: 'demo', kind: 'dir' },
        { path: '/root/b/demo', name: 'demo', kind: 'dir' },
      ],
    } as any)

    const result = await resolveWorkspaceEntryByName({
      workspaceRoot: '/root',
      targetPath: 'demo',
      expectedKind: 'dir',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('ambiguous')
      expect(result.candidates).toEqual(['a/demo', 'b/demo'])
    }
  })

  it('falls back to mounted roots when current workspace root is not determined', async () => {
    vi.mocked(getWorkspaceMountedRoots).mockReturnValue(['/root-a', '/root-b'])
    vi.mocked(listFolder)
      .mockResolvedValueOnce({
        ok: true,
        data: [{ path: '/root-a/temp', name: 'temp', kind: 'dir' }],
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        data: [{ path: '/root-b/other', name: 'other', kind: 'dir' }],
      } as any)

    const result = await resolveWorkspaceEntryByName({
      workspaceRoot: null,
      targetPath: 'temp',
      expectedKind: 'dir',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.workspaceRoot).toBe('/root-a')
      expect(result.resolvedPath).toBe('/root-a/temp')
    }
  })

  it('treats mounted root itself as a resolvable directory target', async () => {
    vi.mocked(getWorkspaceMountedRoots).mockReturnValue(['/root/temp'])
    vi.mocked(listFolder).mockResolvedValue({ ok: true, data: [] } as any)

    const result = await resolveWorkspaceEntryByName({
      workspaceRoot: null,
      targetPath: 'temp',
      expectedKind: 'dir',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.workspaceRoot).toBe('/root/temp')
      expect(result.resolvedPath).toBe('/root/temp')
    }
  })

  it('disambiguates duplicate relative paths by prefixing mounted root names', async () => {
    vi.mocked(getWorkspaceMountedRoots).mockReturnValue([
      '/workspace-a',
      '/workspace-b',
    ])
    vi.mocked(listFolder)
      .mockResolvedValueOnce({
        ok: true,
        data: [
          { path: '/workspace-a/第1章', name: '第1章', kind: 'dir' },
          { path: '/workspace-a/第1章/demo', name: 'demo', kind: 'dir' },
        ],
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        data: [
          { path: '/workspace-b/第1章', name: '第1章', kind: 'dir' },
          { path: '/workspace-b/第1章/demo', name: 'demo', kind: 'dir' },
        ],
      } as any)

    const result = await resolveWorkspaceEntryByName({
      workspaceRoot: null,
      targetPath: 'demo',
      expectedKind: 'dir',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('ambiguous')
      expect(result.candidates).toEqual(['workspace-a/第1章/demo', 'workspace-b/第1章/demo'])
    }
  })

  it('falls back to full mounted root path when mounted root names are also duplicated', async () => {
    vi.mocked(getWorkspaceMountedRoots).mockReturnValue([
      '/Volumes/A/离散数学',
      '/Volumes/B/离散数学',
    ])
    vi.mocked(listFolder)
      .mockResolvedValueOnce({
        ok: true,
        data: [
          { path: '/Volumes/A/离散数学/第1章', name: '第1章', kind: 'dir' },
          { path: '/Volumes/A/离散数学/第1章/demo', name: 'demo', kind: 'dir' },
        ],
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        data: [
          { path: '/Volumes/B/离散数学/第1章', name: '第1章', kind: 'dir' },
          { path: '/Volumes/B/离散数学/第1章/demo', name: 'demo', kind: 'dir' },
        ],
      } as any)

    const result = await resolveWorkspaceEntryByName({
      workspaceRoot: null,
      targetPath: 'demo',
      expectedKind: 'dir',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('ambiguous')
      expect(result.candidates).toEqual([
        '/Volumes/A/离散数学/第1章/demo',
        '/Volumes/B/离散数学/第1章/demo',
      ])
    }
  })

  it('deduplicates identical mounted roots before resolving names', async () => {
    vi.mocked(getWorkspaceMountedRoots).mockReturnValue([
      '/Volumes/Hao/Users/hao/hao_data/资料/西亚斯/2026/2025-2026-2/离散数学',
      '/Volumes/Hao/Users/hao/hao_data/资料/西亚斯/2026/2025-2026-2/离散数学',
    ])
    vi.mocked(listFolder)
      .mockResolvedValueOnce({
        ok: true,
        data: [
          { path: '/Volumes/Hao/Users/hao/hao_data/资料/西亚斯/2026/2025-2026-2/离散数学/第1章', name: '第1章', kind: 'dir' },
          { path: '/Volumes/Hao/Users/hao/hao_data/资料/西亚斯/2026/2025-2026-2/离散数学/第1章/demo', name: 'demo', kind: 'dir' },
        ],
      } as any)

    const result = await resolveWorkspaceEntryByName({
      workspaceRoot: null,
      targetPath: 'demo',
      expectedKind: 'dir',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.resolvedPath).toBe('/Volumes/Hao/Users/hao/hao_data/资料/西亚斯/2026/2025-2026-2/离散数学/第1章/demo')
    }
  })

  it('deduplicates final matches by resolved path before reporting ambiguity', async () => {
    vi.mocked(getWorkspaceMountedRoots).mockReturnValue(['/root'])
    vi.mocked(listFolder)
      .mockResolvedValueOnce({
        ok: true,
        data: [
          { path: '/root/demo', name: 'demo', kind: 'dir' },
          { path: '/root/root', name: 'root', kind: 'dir' },
          { path: '/root/demo', name: 'demo', kind: 'dir' },
        ],
      } as any)

    const result = await resolveWorkspaceEntryByName({
      workspaceRoot: null,
      targetPath: 'demo',
      expectedKind: 'dir',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.resolvedPath).toBe('/root/demo')
    }
  })
})
