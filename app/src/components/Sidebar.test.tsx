import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Sidebar } from './Sidebar'

// Mock context menu to avoid its complex logic
vi.mock('./FileContextMenu', () => ({
    FileContextMenu: (props: any) => (
        <div data-testid="context-menu">
            {props.items?.map((item: any) => (
                <button key={item.id} onClick={item.onClick}>{item.label}</button>
            ))}
        </div>
    )
}))

describe('Sidebar', () => {
    const mockProps = {
        standaloneFiles: [],
        folderRoots: [],
        treesByRoot: {},
        expanded: {},
        onToggle: vi.fn(),
        onFileClick: vi.fn(),
    }

    it('should render empty state when no files or folders', () => {
        render(<Sidebar {...mockProps} />)
        expect(screen.getByText('暂无文件')).toBeDefined()
    })

    it('should render standalone files', () => {
        const props = {
            ...mockProps,
            standaloneFiles: [{ path: '/test.md', name: 'test.md' }]
        }
        render(<Sidebar {...props} />)
        expect(screen.getByText('test.md')).toBeDefined()
    })

    it('should call onFileClick when standalone file is clicked', () => {
        const onFileClick = vi.fn()
        const props = {
            ...mockProps,
            standaloneFiles: [{ path: '/test.md', name: 'test.md' }],
            onFileClick
        }
        render(<Sidebar {...props} />)
        fireEvent.click(screen.getByText('test.md'))
        expect(onFileClick).toHaveBeenCalledWith('/test.md')
    })

    it('should render folder roots and toggle expansion', () => {
        const onToggle = vi.fn()
        const props = {
            ...mockProps,
            folderRoots: ['/my-project'],
            treesByRoot: { '/my-project': [{ id: '1', name: 'f1', path: '/my-project/f1', kind: 'file' as const }] },
            onToggle
        }
        render(<Sidebar {...props} />)
        const rootRow = screen.getByText('my-project')
        expect(rootRow).toBeDefined()

        fireEvent.click(rootRow)
        expect(onToggle).toHaveBeenCalledWith('/my-project')
    })

    it('should render tree nodes when expanded', () => {
        const props = {
            ...mockProps,
            folderRoots: ['/root'],
            expanded: { '/root': true },
            treesByRoot: {
                '/root': [
                    { id: 'f1', name: 'file1.md', path: '/root/file1.md', kind: 'file' as const },
                    { id: 'd1', name: 'dir1', path: '/root/dir1', kind: 'dir' as const, children: [] }
                ]
            }
        }
        render(<Sidebar {...props} />)
        expect(screen.getByText('file1.md')).toBeDefined()
        expect(screen.getByText('dir1')).toBeDefined()
    })

    it('should call onToolbarNewFileInCurrentFolder', () => {
        const onToolbarNewFileInCurrentFolder = vi.fn()
        const props = {
            ...mockProps,
            folderRoots: ['/root'],
            treesByRoot: { '/root': [{ id: '1', name: 'f1', path: '/root/f1', kind: 'file' as const }] },
            onToolbarNewFileInCurrentFolder
        }
        render(<Sidebar {...props} />)
        const btn = screen.getByTitle('在当前文件夹中新建文件')
        fireEvent.click(btn)
        expect(onToolbarNewFileInCurrentFolder).toHaveBeenCalled()
    })

    it('should show Delete in context menu for tree dir and emit delete action', () => {
        const onContextAction = vi.fn()
        const props = {
            ...mockProps,
            folderRoots: ['/root'],
            expanded: { '/root': true },
            treesByRoot: {
                '/root': [
                    { id: 'd1', name: 'dir1', path: '/root/dir1', kind: 'dir' as const, children: [] },
                ],
            },
            onContextAction,
        }

        render(<Sidebar {...props} />)

        const dirNode = screen.getByText('dir1')
        fireEvent.contextMenu(dirNode)

        const deleteButton = screen.getByText('Delete…')
        fireEvent.click(deleteButton)

        expect(onContextAction).toHaveBeenCalledWith({
            path: '/root/dir1',
            kind: 'tree-dir',
            action: 'delete',
        })
    })
})
