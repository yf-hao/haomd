import { useEffect, useRef, useState } from 'react'
import type { FileTreeNode } from '../domain/sidebarTree'
import './Sidebar.css'

export type StandaloneFileItem = {
  path: string
  name: string
}

export type SidebarContextTargetKind = 'standalone-file' | 'folder-root' | 'tree-file' | 'tree-dir'

export type SidebarContextAction = 'open' | 'remove' | 'delete' | 'open-terminal' | 'open-in-file-manager'

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
  onDirClick?: (path: string) => void  // 文件夹点击回调（用于选中文件夹）
  onContextAction?: (payload: SidebarContextActionPayload) => void
  /** 顶部工具栏：在当前文件夹中新建文件 */
  onToolbarNewFileInCurrentFolder?: () => void
  /** 顶部工具栏：在当前文件夹中新建子文件夹 */
  onToolbarNewFolderInCurrentFolder?: () => void
  /** 顶部工具栏：刷新当前文件夹 */
  onToolbarRefreshCurrentFolder?: () => void
  /** 行内新建文件：当前处于命名状态的目录 */
  inlineNewFileDir?: string | null
  /** 行内新建文件：确认命名 */
  onInlineNewFileConfirm?: (name: string) => void
  /** 行内新建文件：取消命名 */
  onInlineNewFileCancel?: () => void
  /** 行内新建文件夹：当前处于命名状态的目录 */
  inlineNewFolderDir?: string | null
  /** 行内新建文件夹：确认命名 */
  onInlineNewFolderConfirm?: (name: string) => void
  /** 行内新建文件夹：取消命名 */
  onInlineNewFolderCancel?: () => void
  activePath?: string | null
  panelWidth?: number
  highlightedPaths?: string[]
  onFileVisited?: (path: string) => void
}

type TreeNodeProps = {
  node: FileTreeNode
  level: number
  expanded: Record<string, boolean>
  onToggle: (path: string) => void
  onFileClick: (path: string) => void
  onDirClick?: (path: string) => void
  activePath?: string | null
  highlightedPaths?: string[]
  onFileVisited?: (path: string) => void
  onContextMenu?: (event: any, target: { path: string; kind: SidebarContextTargetKind }) => void
  inlineNewFileDir?: string | null
  onInlineNewFileConfirm?: (name: string) => void
  onInlineNewFileCancel?: () => void
  inlineNewFolderDir?: string | null
  onInlineNewFolderConfirm?: (name: string) => void
  onInlineNewFolderCancel?: () => void
}

function TreeNode({ node, level, expanded, onToggle, onFileClick, onDirClick, activePath, highlightedPaths, onFileVisited, onContextMenu, inlineNewFileDir, onInlineNewFileConfirm, onInlineNewFileCancel, inlineNewFolderDir, onInlineNewFolderConfirm, onInlineNewFolderCancel }: TreeNodeProps) {
  const isExpanded = !!expanded[node.path]
  const isActive = activePath === node.path
  const isHighlighted = highlightedPaths?.includes(node.path.replace(/\\/g, '/')) ?? false

  const paddingLeft = 8 + level * 12

  if (node.kind === 'dir') {
    return (
      <div>
        <div
          className={`tree-row dir ${isActive ? 'active' : ''}`}
          style={{ paddingLeft }}
          onClick={() => {
            onToggle(node.path)
            onDirClick?.(node.path)
          }}
          onContextMenu={(e) => {
            if (!onContextMenu) return
            e.preventDefault()
            e.stopPropagation()
            onContextMenu(e, { path: node.path, kind: 'tree-dir' })
          }}
        >
          <span
            className={`tree-icon tree-icon-chevron ${isExpanded ? 'expanded' : 'collapsed'}`}
            aria-hidden="true"
          />
          <span className="tree-name">{node.name}</span>
        </div>
        {isExpanded && (
          <>
            {inlineNewFileDir === node.path && (
              <InlineNewFileRow
                level={level + 1}
                onConfirm={onInlineNewFileConfirm}
                onCancel={onInlineNewFileCancel}
              />
            )}
            {inlineNewFolderDir === node.path && (
              <InlineNewFileRow
                level={level + 1}
                onConfirm={onInlineNewFolderConfirm}
                onCancel={onInlineNewFolderCancel}
                isFolder={true}
              />
            )}
            {node.children?.map((child) => (
              <TreeNode
                key={child.id}
                node={child}
                level={level + 1}
                expanded={expanded}
                onToggle={onToggle}
                onFileClick={onFileClick}
                onDirClick={onDirClick}
                activePath={activePath}
                highlightedPaths={highlightedPaths}
                onFileVisited={onFileVisited}
                onContextMenu={onContextMenu}
                inlineNewFileDir={inlineNewFileDir}
                onInlineNewFileConfirm={onInlineNewFileConfirm}
                onInlineNewFileCancel={onInlineNewFileCancel}
                inlineNewFolderDir={inlineNewFolderDir}
                onInlineNewFolderConfirm={onInlineNewFolderConfirm}
                onInlineNewFolderCancel={onInlineNewFolderCancel}
              />
            ))}
          </>
        )}
      </div>
    )
  }

  const className = `tree-row file ${isActive ? 'active' : ''} ${isHighlighted ? 'highlighted' : ''}`.trim()

  return (
    <div
      className={className}
      style={{ paddingLeft }}
      onClick={() => {
        onFileClick(node.path)
        if (isHighlighted && onFileVisited) {
          onFileVisited(node.path)
        }
      }}
      onContextMenu={(e) => {
        if (!onContextMenu) return
        e.preventDefault()
        e.stopPropagation()
        onContextMenu(e, { path: node.path, kind: 'tree-file' })
      }}
    >
      <span className="tree-icon">📄</span>
      <span className="tree-name">{node.name}</span>
    </div>
  )
}

type InlineNewFileRowProps = {
  level: number
  onConfirm?: (name: string) => void
  onCancel?: () => void
  isFolder?: boolean
}

function InlineNewFileRow({ level, onConfirm, onCancel, isFolder }: InlineNewFileRowProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const paddingLeft = 8 + level * 12

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [])

  const finish = (commit: boolean, value: string) => {
    const name = value.trim()
    if (!commit || !name) {
      onCancel?.()
      return
    }
    onConfirm?.(name)
  }

  const placeholder = isFolder ? 'new folder' : 'new file'
  const icon = isFolder ? '📁' : '📄'
  const rowClass = isFolder ? 'tree-row dir new-file-editing' : 'tree-row file new-file-editing'

  return (
    <div
      className={rowClass}
      style={{ paddingLeft }}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="tree-icon">{icon}</span>
      <input
        ref={inputRef}
        className="tree-name-input"
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            finish(true, e.currentTarget.value)
          } else if (e.key === 'Escape') {
            finish(false, e.currentTarget.value)
          }
        }}
        onBlur={(e) => {
          finish(true, e.currentTarget.value)
        }}
      />
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

    // 基础项：Open + Open in File Manager + Open in Terminal
    let itemCount = 3
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
        <button type="button" role="menuitem" onClick={() => handleClickItem('open-in-file-manager')}>
          Open in File Manager
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

export function Sidebar({ standaloneFiles, folderRoots, treesByRoot, expanded, onToggle, onFileClick, onDirClick, onContextAction, onToolbarNewFileInCurrentFolder, onToolbarNewFolderInCurrentFolder, onToolbarRefreshCurrentFolder, inlineNewFileDir, onInlineNewFileConfirm, onInlineNewFileCancel, inlineNewFolderDir, onInlineNewFolderConfirm, onInlineNewFolderCancel, activePath, panelWidth, highlightedPaths, onFileVisited }: SidebarProps) {
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
                  className={`sidebar-file-row tree-row file ${activePath === file.path ? 'active' : ''}`}
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
            <div className="sidebar-section-header">
              <div className="sidebar-section-title">文件夹</div>
              <div className="folder-section-actions">
                <button
                  type="button"
                  className="folder-action-btn icon-new-file"
                  title="在当前文件夹中新建文件"
                  onClick={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    onToolbarNewFileInCurrentFolder?.()
                  }}
                />
                <button
                  type="button"
                  className="folder-action-btn icon-new-folder"
                  title="在当前文件夹中新建子文件夹"
                  onClick={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    onToolbarNewFolderInCurrentFolder?.()
                  }}
                />
                <button
                  type="button"
                  className="folder-action-btn icon-refresh"
                  title="刷新当前文件夹"
                  onClick={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    onToolbarRefreshCurrentFolder?.()
                  }}
                />
              </div>
            </div>
            {folderRoots.length > 0 && (
              <ul className="sidebar-folder-list">
                {folderRoots.map((rootPath) => {
                  const name = rootPath.split(/[/\\]/).pop() ?? rootPath
                  const isExpandedRoot = !!expanded[rootPath]
                  const isActiveRoot = activePath === rootPath
                  const children = treesByRoot[rootPath] ?? []
                  return (
                    <li key={rootPath}>
                      <div
                        className={`sidebar-folder-row ${isActiveRoot ? 'active' : ''}`}
                        onClick={() => {
                          onToggle(rootPath)
                          onDirClick?.(rootPath)
                        }}
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
                      {isExpandedRoot && (
                        <div className="sidebar-folder-children">
                          {inlineNewFileDir === rootPath && (
                            <InlineNewFileRow
                              level={1}
                              onConfirm={onInlineNewFileConfirm}
                              onCancel={onInlineNewFileCancel}
                            />
                          )}
                          {inlineNewFolderDir === rootPath && (
                            <InlineNewFileRow
                              level={1}
                              onConfirm={onInlineNewFolderConfirm}
                              onCancel={onInlineNewFolderCancel}
                              isFolder={true}
                            />
                          )}
                          {children.map((node) => (
                            <TreeNode
                              key={node.id}
                              node={node}
                              level={1}
                              expanded={expanded}
                              onToggle={onToggle}
                              onFileClick={onFileClick}
                              onDirClick={onDirClick}
                              activePath={activePath}
                              highlightedPaths={highlightedPaths}
                              onFileVisited={onFileVisited}
                              onContextMenu={handleTreeNodeContextMenu}
                              inlineNewFileDir={inlineNewFileDir}
                              onInlineNewFileConfirm={onInlineNewFileConfirm}
                              onInlineNewFileCancel={onInlineNewFileCancel}
                              inlineNewFolderDir={inlineNewFolderDir}
                              onInlineNewFolderConfirm={onInlineNewFolderConfirm}
                              onInlineNewFolderCancel={onInlineNewFolderCancel}
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
