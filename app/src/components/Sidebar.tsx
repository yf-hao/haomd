import { useEffect, useRef, useState } from 'react'
import type { FileTreeNode } from '../domain/sidebarTree'
import './Sidebar.css'

export type StandaloneFileItem = {
  path: string
  name: string
}

export type SidebarContextTargetKind = 'standalone-file' | 'folder-root' | 'tree-file' | 'tree-dir'

export type SidebarContextAction = 'open' | 'remove' | 'delete' | 'open-terminal'

export type SidebarContextActionPayload = {
  path: string
  kind: SidebarContextTargetKind
  action: SidebarContextAction
}

export type SidebarProps = {
  standaloneFiles: StandaloneFileItem[]
  folderRoots: string[]
  treesByRoot: Record<string, FileTreeNode[]>
  expanded: Record<string, boolean>
  onToggle: (path: string) => void
  onFileClick: (path: string) => void
  onContextAction?: (payload: SidebarContextActionPayload) => void
  activePath?: string | null
  panelWidth?: number
}

type TreeNodeProps = {
  node: FileTreeNode
  level: number
  expanded: Record<string, boolean>
  onToggle: (path: string) => void
  onFileClick: (path: string) => void
  activePath?: string | null
  onContextMenu?: (event: any, target: { path: string; kind: SidebarContextTargetKind }) => void
}

function TreeNode({ node, level, expanded, onToggle, onFileClick, activePath, onContextMenu }: TreeNodeProps) {
  const isExpanded = !!expanded[node.path]
  const isActive = activePath === node.path

  const paddingLeft = 8 + level * 12

  if (node.kind === 'dir') {
    return (
      <div>
        <div
          className={`tree-row dir ${isActive ? 'active' : ''}`}
          style={{ paddingLeft }}
          onClick={() => onToggle(node.path)}
        >
          <span
            className={`tree-icon tree-icon-chevron ${isExpanded ? 'expanded' : 'collapsed'}`}
            aria-hidden="true"
          />
          <span className="tree-name">{node.name}</span>
        </div>
        {isExpanded &&
          node.children?.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              level={level + 1}
              expanded={expanded}
              onToggle={onToggle}
              onFileClick={onFileClick}
              activePath={activePath}
              onContextMenu={onContextMenu}
            />
          ))}
      </div>
    )
  }

  return (
    <div
      className={`tree-row file ${isActive ? 'active' : ''}`}
      style={{ paddingLeft }}
      onClick={() => onFileClick(node.path)}
      onContextMenu={(e) => {
        if (!onContextMenu) return
        e.preventDefault()
        e.stopPropagation()
        onContextMenu(e, { path: node.path, kind: 'tree-file' })
      }}
    >
      <span className="tree-icon">📝</span>
      <span className="tree-name">{node.name}</span>
    </div>
  )
}

type SidebarContextMenuProps = {
  x: number
  y: number
  target: { path: string; kind: SidebarContextTargetKind }
  onAction: (action: SidebarContextAction) => void
  onRequestClose: () => void
}

function SidebarContextMenu({ x, y, target, onAction, onRequestClose }: SidebarContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  useEffect(() => {
    const menuWidth = 200
    const isStandaloneFile = target.kind === 'standalone-file'
    const isFileTarget = target.kind === 'standalone-file' || target.kind === 'tree-file'
    const isFolderRoot = target.kind === 'folder-root'

    // 基础项：Open + Open in Terminal
    let itemCount = 2
    // 文件类型：增加 Delete…
    if (isFileTarget) itemCount += 1
    // 独立文件：增加 Remove from File List
    if (isStandaloneFile) itemCount += 1
    // 根文件夹：增加 Remove Folder
    if (isFolderRoot) itemCount += 1

    const menuHeight = itemCount * 28 + 8

    let left = x
    let top = y
    const vw = window.innerWidth
    const vh = window.innerHeight

    if (left + menuWidth > vw) {
      left = Math.max(4, vw - menuWidth - 4)
    }
    if (top + menuHeight > vh) {
      top = Math.max(4, vh - menuHeight - 4)
    }

    setPosition({ left, top })
  }, [x, y, target.kind])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (!menuRef.current) return
      if (!menuRef.current.contains(e.target as Node)) {
        onRequestClose()
      }
    }

    const handleContextMenu = (e: MouseEvent) => {
      if (!menuRef.current) return
      if (!menuRef.current.contains(e.target as Node)) {
        onRequestClose()
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onRequestClose()
      }
    }

    window.addEventListener('click', handleClick)
    window.addEventListener('contextmenu', handleContextMenu)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('click', handleClick)
      window.removeEventListener('contextmenu', handleContextMenu)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onRequestClose])

  const handleClickItem = (action: SidebarContextAction) => {
    onAction(action)
  }

  return (
      <div
        ref={menuRef}
        className="sidebar-context-menu"
        style={{ left: position.left, top: position.top }}
        role="menu"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" role="menuitem" onClick={() => handleClickItem('open')}>
          Open
        </button>
        <button type="button" role="menuitem" onClick={() => handleClickItem('open-terminal')}>
          Open in Terminal
        </button>
        {(target.kind === 'standalone-file' || target.kind === 'tree-file') && (
          <button type="button" role="menuitem" onClick={() => handleClickItem('delete')}>
            Delete…
          </button>
        )}
        {target.kind === 'standalone-file' && (
          <button type="button" role="menuitem" onClick={() => handleClickItem('remove')}>
            Remove from File List
          </button>
        )}
        {target.kind === 'folder-root' && (
          <button type="button" role="menuitem" onClick={() => handleClickItem('remove')}>
            Remove Folder
          </button>
        )}
      </div>

  )
}

export function Sidebar({ standaloneFiles, folderRoots, treesByRoot, expanded, onToggle, onFileClick, onContextAction, activePath, panelWidth }: SidebarProps) {
  const hasStandalone = standaloneFiles.length > 0
  const hasTree = folderRoots.some((rootPath) => (treesByRoot[rootPath]?.length ?? 0) > 0)

  const [menuState, setMenuState] = useState<{
    visible: boolean
    x: number
    y: number
    target: { path: string; kind: SidebarContextTargetKind } | null
  }>({ visible: false, x: 0, y: 0, target: null })

  const closeMenu = () => setMenuState({ visible: false, x: 0, y: 0, target: null })

  const triggerContextAction = (action: SidebarContextAction) => {
    if (!menuState.visible || !menuState.target || !onContextAction) return
    onContextAction({
      path: menuState.target.path,
      kind: menuState.target.kind,
      action,
    })
    closeMenu()
  }

  const handleTreeNodeContextMenu = (event: any, target: { path: string; kind: SidebarContextTargetKind }) => {
    event.preventDefault()
    event.stopPropagation()
    setMenuState({
      visible: true,
      x: event.clientX,
      y: event.clientY,
      target,
    })
  }

  const asideStyle = panelWidth ? { width: panelWidth } : undefined

  if (!hasTree && !hasStandalone) {
    return (
      <aside
        className="sidebar"
        style={asideStyle}
        onClick={closeMenu}
        onContextMenu={(e) => {
          e.preventDefault()
          closeMenu()
        }}
      >
        <div className="sidebar-header">
          <div className="pane-title">File Browser</div>
        </div>
        <div className="sidebar-body muted small">暂无文件</div>
      </aside>
    )
  }

  return (
    <aside
      className="sidebar"
      style={asideStyle}
      onClick={closeMenu}
      onContextMenu={(e) => {
        e.preventDefault()
        closeMenu()
      }}
    >
      <div className="sidebar-header">
        <div className="pane-title">File Browser</div>
      </div>
      <div className="sidebar-body">
        {hasStandalone && (
          <section className="sidebar-section">
            <div className="sidebar-section-title">文件</div>
            <ul className="sidebar-file-list">
              {standaloneFiles.map((file) => (
                <li
                  key={file.path}
                  className={`sidebar-file-row ${activePath === file.path ? 'active' : ''}`}
                  onClick={() => onFileClick(file.path)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setMenuState({
                      visible: true,
                      x: e.clientX,
                      y: e.clientY,
                      target: { path: file.path, kind: 'standalone-file' },
                    })
                  }}
                  title={file.path}
                >
                  <span className="tree-icon">📄</span>
                  <span className="tree-name">{file.name}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {hasTree && (
          <section className="sidebar-section">
            <div className="sidebar-section-title">文件夹</div>
            {folderRoots.length > 0 && (
              <ul className="sidebar-folder-list">
                {folderRoots.map((rootPath) => {
                  const name = rootPath.split(/[/\\]/).pop() ?? rootPath
                  const isExpandedRoot = !!expanded[rootPath]
                  const children = treesByRoot[rootPath] ?? []
                  return (
                    <li key={rootPath}>
                      <div
                        className={`sidebar-folder-row ${isExpandedRoot ? 'active' : ''}`}
                        onClick={() => onToggle(rootPath)}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setMenuState({
                            visible: true,
                            x: e.clientX,
                            y: e.clientY,
                            target: { path: rootPath, kind: 'folder-root' },
                          })
                        }}
                        title={rootPath}
                      >
                        <span
                          className={`tree-icon tree-icon-chevron ${isExpandedRoot ? 'expanded' : 'collapsed'}`}
                          aria-hidden="true"
                        />
                        <span className="tree-name">{name}</span>
                      </div>
                      {isExpandedRoot && children.length > 0 && (
                        <div className="sidebar-folder-children">
                          {children.map((node) => (
                            <TreeNode
                              key={node.id}
                              node={node}
                              level={1}
                              expanded={expanded}
                              onToggle={onToggle}
                              onFileClick={onFileClick}
                              activePath={activePath}
                              onContextMenu={handleTreeNodeContextMenu}
                            />
                          ))}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )}
      </div>

      {menuState.visible && menuState.target && (
        <SidebarContextMenu
          x={menuState.x}
          y={menuState.y}
          target={menuState.target}
          onAction={triggerContextAction}
          onRequestClose={closeMenu}
        />
      )}
    </aside>
  )
}
