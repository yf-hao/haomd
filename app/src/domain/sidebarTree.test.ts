import { expect, it } from 'vitest'
import { buildFileTree, isVisibleTreePath, relocateTreeFile } from './sidebarTree'

it.each(['/demo', 'C:\\demo'])('hides entire hidden subtrees under %s', root => {
  const separator = root.includes('\\') ? '\\' : '/'
  const entry = (relative: string, kind: 'dir' | 'file') => ({
    path: root + separator + relative.replaceAll('/', separator),
    name: relative.split('/').pop()!, kind,
  })
  const tree = buildFileTree(root, [
    entry('vgms', 'dir'), entry('vgms/.git', 'dir'), entry('vgms/.git/hooks', 'dir'),
    entry('vgms/.git/hooks/deep', 'dir'), entry('vgms/.git/hooks/deep/note.md', 'file'),
    entry('.hidden.md', 'file'), entry('.haomd/notes', 'dir'), entry('.haomd/notes/a.md', 'file'),
    entry('vgms/visible.md', 'file'), entry('vgms/version.1.md', 'file'),
  ])
  expect(tree.map(node => node.name)).toEqual(['vgms'])
  expect(tree[0].children?.map(node => node.name)).toEqual(['version.1.md', 'visible.md'])
})

it('does not promote descendants of a missing parent to the root', () => {
  expect(buildFileTree('/root', [
    { path: '/root/missing/sub', name: 'sub', kind: 'dir' },
    { path: '/root/missing/sub/note.md', name: 'note.md', kind: 'file' },
  ])).toEqual([])
})

it('applies visibility relative to the explicitly opened root', () => {
  expect(isVisibleTreePath('/root/.config', '/root/.config/notes/a.md')).toBe(true)
  expect(isVisibleTreePath('/root/.config', '/root/.config/notes/.hidden/a.md')).toBe(false)
  expect(isVisibleTreePath('/root', '/root2/a.md')).toBe(false)
  expect(isVisibleTreePath('/', '/a.md')).toBe(true)
})

it('removes a moved file without inserting a hidden destination', () => {
  const tree = buildFileTree('/root', [{ path: '/root/a.md', name: 'a.md', kind: 'file' }])
  expect(relocateTreeFile('/root', tree, '/root/a.md', '/root/.a.md')).toEqual([])
  expect(relocateTreeFile('/root', tree, '/root/a.md', '/root/.git/a.md')).toEqual([])
})

it('moves a file between sorted branches and retains unrelated branch identities', () => {
  const tree = buildFileTree('/root', [
    { path: '/root/old', name: 'old', kind: 'dir' },
    { path: '/root/new', name: 'new', kind: 'dir' },
    { path: '/root/untouched', name: 'untouched', kind: 'dir' },
    { path: '/root/old/note.md', name: 'note.md', kind: 'file' },
    { path: '/root/new/note.md', name: 'note.md', kind: 'file' },
  ])
  const updated = relocateTreeFile('/root', tree, '/root/old/note.md', '/root/new/note01.md')
  expect(updated.find(node => node.name === 'old')?.children).toEqual([])
  expect(updated.find(node => node.name === 'new')?.children?.map(node => node.name)).toEqual(['note.md', 'note01.md'])
  expect(updated.find(node => node.name === 'untouched')).toBe(tree.find(node => node.name === 'untouched'))
  expect(relocateTreeFile('/root', tree, '/outside/a.md', '/outside/b.md')).toBe(tree)
})
