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
  expect(action).toHaveBeenLastCalledWith({ path: '/root/note.md', kind: 'tree-file', action: 'copy' })
  fireEvent.click(screen.getByText('destination'))
  fireEvent.keyDown(document, { key: 'v', metaKey: true })
  expect(action).toHaveBeenLastCalledWith({ path: '/root/destination', kind: 'tree-dir', action: 'paste' })
})

it('uses the right-clicked target for copy and paste', async () => {
  const action = await fixture()
  fireEvent.contextMenu(screen.getByText('note.md'))
  fireEvent.click(screen.getByText('sidebar.copyEntry'))
  expect(action).toHaveBeenLastCalledWith({ path: '/root/note.md', kind: 'tree-file', action: 'copy' })
  fireEvent.contextMenu(screen.getByText('destination'))
  fireEvent.click(screen.getByText('sidebar.pasteEntry'))
  expect(action).toHaveBeenLastCalledWith({ path: '/root/destination', kind: 'tree-dir', action: 'paste' })
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
