import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useSidebar } from './useSidebar'
import { listFolder } from '../modules/files/service'
import type { FileEntry, Result } from '../modules/files/types'

vi.mock('../modules/files/service', () => ({ listFolder: vi.fn(), logRecentFile: vi.fn() }))
vi.mock('../modules/sidebar/sidebarStateRepo', () => ({
  loadSidebarState: vi.fn(async () => ({
    root: '/root', folderRoots: ['/root'], expandedPaths: [], standaloneFiles: [], highlightedFiles: [],
  })),
  saveSidebarState: vi.fn(async () => {}),
}))

const entries: FileEntry[] = [
  { path: '/root/sub', name: 'sub', kind: 'dir' },
  { path: '/root/sub/deep', name: 'deep', kind: 'dir' },
  { path: '/root/sub/deep/z.md', name: 'z.md', kind: 'file' },
]

beforeEach(() => {
  vi.mocked(listFolder).mockReset().mockResolvedValue({ ok: true, data: entries })
})

it('does not insert hidden files after creating or pasting them', async () => {
  const { result } = renderHook(() => useSidebar())
  await waitFor(() => expect(result.current.treesByRoot['/root']).toBeDefined())
  const previous = result.current.treesByRoot['/root']
  act(() => {
    result.current.addFileToTree('/root/.hidden.md')
    result.current.addFileToTree('/root/sub/.hidden.md')
    result.current.addFileToTree('/root/sub/.git/hooks/a.md')
  })
  expect(result.current.treesByRoot['/root']).toBe(previous)
})

it.each(['/root/a.md', '/root/sub/a.md', '/root/sub/deep/a.md'])(
  'immediately inserts %s in its parent without duplicates', async path => {
    const { result } = renderHook(() => useSidebar())
    await waitFor(() => expect(result.current.treesByRoot['/root']).toBeDefined())
    act(() => {
      result.current.addFileToTree(path)
      result.current.addFileToTree(path)
    })
    let siblings = result.current.treesByRoot['/root']
    for (const name of path.slice('/root/'.length).split('/').slice(0, -1)) {
      siblings = siblings.find(node => node.name === name)!.children!
    }
    expect(siblings.filter(node => node.path === path)).toHaveLength(1)
    expect(siblings.filter(node => node.kind === 'file').map(node => node.name)).toEqual(
      path.includes('/deep/') ? ['a.md', 'z.md'] : ['a.md'],
    )
    expect(listFolder).toHaveBeenCalledTimes(1)
  },
)

it('keeps the new file when a scan started before creation finishes late', async () => {
  const { result } = renderHook(() => useSidebar())
  await waitFor(() => expect(result.current.treesByRoot['/root']).toBeDefined())
  let finish!: (value: Result<FileEntry[]>) => void
  vi.mocked(listFolder).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  let refresh!: Promise<void>
  act(() => { refresh = result.current.refreshFolderTree('/root') })
  act(() => { result.current.addFileToTree('/root/sub/a.md') })
  await act(async () => {
    finish({ ok: true, data: entries })
    await refresh
  })
  expect(result.current.treesByRoot['/root'][0].children?.map(node => node.name)).toEqual(['deep', 'a.md'])
})

it('reconciles a deleted folder across the tree, standalone files and expanded paths', async () => {
  const { result } = renderHook(() => useSidebar())
  await waitFor(() => expect(result.current.treesByRoot['/root']).toBeDefined())
  act(() => {
    result.current.addStandaloneFile('/root/sub/deep/z.md')
    result.current.addStandaloneFile('/other/keep.md')
    result.current.expandPath('/root/sub/deep')
  })
  act(() => result.current.applyEntriesDeleted([{ path: '/root/sub', kind: 'tree-dir' }]))
  expect(result.current.treesByRoot['/root']).toEqual([])
  expect(result.current.standaloneFiles.map(file => file.path)).toEqual(['/other/keep.md'])
  expect(result.current.expanded['/root/sub/deep']).toBeUndefined()
  act(() => result.current.applyEntriesDeleted([{ path: '/root', kind: 'folder-root' }]))
  expect(result.current.folderRoots).toEqual([])
  expect(result.current.root).toBeNull()
})
