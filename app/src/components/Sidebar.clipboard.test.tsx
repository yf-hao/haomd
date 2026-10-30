import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { Sidebar } from './Sidebar'

vi.mock('../modules/i18n/I18nContext', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('./SidebarBackgroundShell', () => ({ SidebarBackgroundShell: ({ as: Tag = 'div', children, ...props }: any) => <Tag {...props}>{children}</Tag> }))
vi.mock('../modules/files/service', () => ({
  loadFileVirtualFolders: async () => ({ ok: true, data: [] }),
  listFileVirtualAssignments: async () => ({ ok: true, data: [] }),
  saveFileVirtualFolders: vi.fn(), updateFileVirtualFolderForPath: vi.fn(),
}))

async function fixture(canPaste = true) {
  const action = vi.fn()
  render(<Sidebar standaloneFiles={[]} folderRoots={['/root']} treesByRoot={{ '/root': [
    { id: '/root/note.md', path: '/root/note.md', name: 'note.md', kind: 'file' },
    { id: '/root/destination', path: '/root/destination', name: 'destination', kind: 'dir', children: [] },
  ] }} expanded={{ '/root': true }} onToggle={vi.fn()} onFileClick={vi.fn()} onContextAction={action} canPaste={canPaste} />)
  await waitFor(() => expect(screen.getByText('note.md')).toBeTruthy())
  return action
}

it('copies the clicked file and pastes into the clicked folder with keyboard shortcuts', async () => {
  const action = await fixture()
  fireEvent.click(screen.getByText('note.md'))
  expect(document.activeElement?.classList.contains('sidebar')).toBe(true)
  fireEvent.keyDown(document, { key: 'c', ctrlKey: true })
  expect(action).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/root/note.md', kind: 'tree-file', action: 'copy' }))
  fireEvent.click(screen.getByText('destination'))
  fireEvent.keyDown(document, { key: 'v', metaKey: true })
  expect(action).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/root/destination', kind: 'tree-dir', action: 'paste' }))
})

it('uses the right-clicked target for copy and paste', async () => {
  const action = await fixture()
  fireEvent.contextMenu(screen.getByText('note.md'))
  fireEvent.click(screen.getByText('sidebar.copyEntry'))
  expect(action).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/root/note.md', kind: 'tree-file', action: 'copy' }))
  fireEvent.contextMenu(screen.getByText('destination'))
  fireEvent.click(screen.getByText('sidebar.pasteEntry'))
  expect(action).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/root/destination', kind: 'tree-dir', action: 'paste' }))
})

it('disables empty paste and leaves input and editor shortcuts alone', async () => {
  const action = await fixture(false)
  fireEvent.contextMenu(screen.getByText('note.md'))
  expect((screen.getByText('sidebar.pasteEntry') as HTMLButtonElement).disabled).toBe(true)
  fireEvent.keyDown(document, { key: 'v', ctrlKey: true })
  expect(action).not.toHaveBeenCalled()
  const input = document.createElement('input')
  document.querySelector('.sidebar')!.append(input)
  input.focus()
  fireEvent.keyDown(input, { key: 'c', ctrlKey: true })
  expect(action).not.toHaveBeenCalled()
  input.remove()
  const editor = document.createElement('textarea')
  document.body.append(editor)
  editor.focus()
  fireEvent.keyDown(editor, { key: 'v', metaKey: true })
  expect(action).not.toHaveBeenCalled()
  editor.remove()
})

it('copies a shift range, preserves it on right-click and deletes the entire selection', async () => {
  const action = await fixture()
  fireEvent.click(screen.getByText('note.md'))
  fireEvent.click(screen.getByText('destination'), { shiftKey: true })
  expect(document.querySelectorAll('[data-selected="true"]')).toHaveLength(2)
  fireEvent.contextMenu(screen.getByText('note.md'))
  fireEvent.click(screen.getByText('sidebar.copyEntry'))
  expect(action.mock.calls.at(-1)?.[0].targets.map((entry: any) => entry.path)).toEqual(['/root/note.md', '/root/destination'])
  fireEvent.contextMenu(screen.getByText('destination'))
  fireEvent.keyDown(document, { key: 'Delete' })
  expect(action.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ action: 'delete', targets: expect.any(Array) }))
  expect(action.mock.calls.at(-1)?.[0].targets).toHaveLength(2)
})

it('toggles individual entries and right-clicking an unselected item resets selection', async () => {
  await fixture()
  fireEvent.click(screen.getByText('note.md'))
  fireEvent.click(screen.getByText('destination'), { ctrlKey: true })
  expect(document.querySelectorAll('[data-selected="true"]')).toHaveLength(2)
  fireEvent.click(screen.getByText('note.md'), { metaKey: true })
  expect(document.querySelectorAll('[data-selected="true"]')).toHaveLength(1)
  fireEvent.contextMenu(screen.getByText('note.md'))
  expect(document.querySelector('[data-selected="true"]')?.getAttribute('data-file-source')).toBe('/root/note.md')
})

it('shift selection excludes collapsed descendants and does not open files or toggle folders', async () => {
  const open = vi.fn()
  const toggle = vi.fn()
  const action = vi.fn()
  const props = {
    standaloneFiles: [], folderRoots: ['/root'], expanded: { '/root': true },
    onToggle: toggle, onFileClick: open, onContextAction: action, canPaste: true,
    treesByRoot: { '/root': [
      { id: '/root/a', path: '/root/a', name: 'a', kind: 'dir' as const, children: [
        { id: '/root/a/hidden.md', path: '/root/a/hidden.md', name: 'hidden.md', kind: 'file' as const },
      ] },
      { id: '/root/z.md', path: '/root/z.md', name: 'z.md', kind: 'file' as const },
    ] },
  }
  const view = render(<Sidebar {...props} />)
  await waitFor(() => expect(screen.getByText('z.md')).toBeTruthy())
  fireEvent.click(screen.getByText('z.md'))
  open.mockClear()
  fireEvent.click(screen.getByText('a'), { shiftKey: true })
  expect(open).not.toHaveBeenCalled()
  expect(toggle).not.toHaveBeenCalled()
  expect(document.querySelectorAll('[data-selected="true"]')).toHaveLength(2)
  expect(screen.queryByText('hidden.md')).toBeNull()
  // An external refresh removes z.md; it must not remain a hidden selection.
  view.rerender(<Sidebar {...props} treesByRoot={{ '/root': [props.treesByRoot['/root'][0]] }} />)
  fireEvent.keyDown(document, { key: 'c', ctrlKey: true })
  expect(action.mock.calls.at(-1)?.[0].targets).toEqual([{ path: '/root/a', kind: 'tree-dir' }])
})

it('consumes Delete with an empty selection so legacy shortcuts cannot delete the active editor file', async () => {
  const action = await fixture()
  const legacyDelete = vi.fn()
  window.addEventListener('keydown', legacyDelete)
  try {
    fireEvent.click(screen.getByText('note.md'))
    fireEvent.click(screen.getByText('note.md'), { ctrlKey: true })
    expect(document.querySelectorAll('[data-selected="true"]')).toHaveLength(0)
    fireEvent.keyDown(document, { key: 'Delete' })
    expect(action).not.toHaveBeenCalled()
    expect(legacyDelete).not.toHaveBeenCalled()
  } finally {
    window.removeEventListener('keydown', legacyDelete)
  }
})
