import { expect, it } from 'vitest'
import { buildFileTree, relocateTreeFile } from './sidebarTree'

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
