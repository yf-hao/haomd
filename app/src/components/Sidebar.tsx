import { useEffect, useRef, useState } from 'react'
import type { FileTreeNode } from '../domain/sidebarTree'
import { FileContextMenu } from './FileContextMenu'
import type { FileVirtualFolder, FileVirtualAssignment } from '../modules/files/types'
import { loadFileVirtualFolders, listFileVirtualAssignments, saveFileVirtualFolders, updateFileVirtualFolderForPath } from '../modules/files/service'
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
  /** 通过 WorkspaceShell 统一的 ConfirmDialog 删除 Files 虚拟文件夹 */
  onRequestConfirmDeleteFileVirtualFolder?: (options: {
    folder: FileVirtualFolder
    onConfirm: () => void
  }) => void
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
    console.log('[Sidebar.InlineNewFileRow.finish]', { isFolder, commit, raw: value, name })
    if (!commit || !name) {
      console.log('[Sidebar.InlineNewFileRow.finish] cancel', { reason: !commit ? 'no-commit' : 'empty-name' })
      onCancel?.()
      return
    }
    console.log('[Sidebar.InlineNewFileRow.finish] confirm', { name })
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


export function Sidebar({ standaloneFiles, folderRoots, treesByRoot, expanded, onToggle, onFileClick, onDirClick, onContextAction, onToolbarNewFileInCurrentFolder, onToolbarNewFolderInCurrentFolder, onToolbarRefreshCurrentFolder, inlineNewFileDir, onInlineNewFileConfirm, onInlineNewFileCancel, inlineNewFolderDir, onInlineNewFolderConfirm, onInlineNewFolderCancel, activePath, panelWidth, highlightedPaths, onFileVisited, onRequestConfirmDeleteFileVirtualFolder }: SidebarProps) {
  const hasStandalone = standaloneFiles.length > 0
  const hasTree = folderRoots.some((rootPath) => (treesByRoot[rootPath]?.length ?? 0) > 0)

  const [menuState, setMenuState] = useState<{
    visible: boolean
    x: number
    y: number
    target: { path: string; kind: SidebarContextTargetKind } | null
  }>({ visible: false, x: 0, y: 0, target: null })

  const [fileVirtualFolders, setFileVirtualFolders] = useState<FileVirtualFolder[]>([])
  const [fileVirtualAssignments, setFileVirtualAssignments] = useState<FileVirtualAssignment[]>([])
  const [collapsedFileVirtualFolders, setCollapsedFileVirtualFolders] = useState<Record<string, boolean>>(() => {
    if (typeof localStorage === 'undefined') return {}
    try {
      const raw = localStorage.getItem('haomd:files:virtual:collapsed-folders')
      if (!raw) return {}
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, boolean>
      }
      return {}
    } catch {
      return {}
    }
  })
  const [creatingFileFolder, setCreatingFileFolder] = useState(false)
  const [creatingFileFolderName, setCreatingFileFolderName] = useState('')
  const [renamingFileFolderId, setRenamingFileFolderId] = useState<string | null>(null)
  const [renamingFileFolderName, setRenamingFileFolderName] = useState('')
  const [fileFolderMenuState, setFileFolderMenuState] = useState<{
    visible: boolean
    x: number
    y: number
    targetPath: string | null
  }>({ visible: false, x: 0, y: 0, targetPath: null })

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

  const toggleFileVirtualFolderCollapse = (folderId: string) => {
    setCollapsedFileVirtualFolders((prev) => ({
      ...prev,
      [folderId]: !prev[folderId],
    }))
  }

  const handleDeleteFileVirtualFolder = (folder: FileVirtualFolder) => {
    // 前端乐观更新：移除虚拟文件夹本身
    setFileVirtualFolders((prev) => prev.filter((f) => f.id !== folder.id))

    // 移除折叠状态缓存
    setCollapsedFileVirtualFolders((prev) => {
      const next = { ...prev }
      delete next[folder.id]
      return next
    })

    // 将该文件夹中的文件移回根列表（folderId 设为 null）
    setFileVirtualAssignments((prev) => {
      const now = Date.now()
      return prev.map((item) =>
        item.folderId === folder.id ? { ...item, folderId: null, updatedAt: now } : item,
      )
    })

    // 持久化到后端：更新虚拟文件夹列表 & 每个文件的归属
    void (async () => {
      try {
        const nextFolders = fileVirtualFolders.filter((f) => f.id !== folder.id)
        const saveResp = await saveFileVirtualFolders(nextFolders)
        if (!saveResp.ok) {
          console.error('[Sidebar] saveFileVirtualFolders(delete) failed', saveResp.error)
          if (typeof window !== 'undefined' && typeof window.alert === 'function') {
            window.alert(saveResp.error.message ?? '删除虚拟文件夹失败')
          }
          return
        }

        const affectedAssignments = fileVirtualAssignments.filter((item) => item.folderId === folder.id)
        for (const item of affectedAssignments) {
          const resp = await updateFileVirtualFolderForPath(item.path, null)
          if (!resp.ok) {
            console.error('[Sidebar] updateFileVirtualFolderForPath(delete) failed', resp.error)
          }
        }
      } catch (e) {
        console.error('[Sidebar] handleDeleteFileVirtualFolder failed', e)
        if (typeof window !== 'undefined' && typeof window.alert === 'function') {
          window.alert('删除虚拟文件夹失败')
        }
      }
    })()
  }

  const handleCreateFileVirtualFolder = () => {
    setCreatingFileFolder(true)
    setCreatingFileFolderName('')
  }

  const requestDeleteFileVirtualFolder = (folder: FileVirtualFolder) => {
    if (onRequestConfirmDeleteFileVirtualFolder) {
      onRequestConfirmDeleteFileVirtualFolder({
        folder,
        onConfirm: () => handleDeleteFileVirtualFolder(folder),
      })
    } else {
      handleDeleteFileVirtualFolder(folder)
    }
  }

  const handleFileFolderInlineNameChange = (value: string) => {
    setCreatingFileFolderName(value)
  }

  const handleFileFolderInlineCancel = () => {
    setCreatingFileFolder(false)
    setCreatingFileFolderName('')
  }

  const handleFileFolderInlineConfirm = () => {
    const name = creatingFileFolderName.trim()
    if (!name) {
      setCreatingFileFolder(false)
      setCreatingFileFolderName('')
      return
    }

    if (fileVirtualFolders.some((f) => f.name === name)) {
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert('已存在同名虚拟文件夹')
      }
      return
    }

    const maxOrder = fileVirtualFolders.reduce((max, f) => (f.order > max ? f.order : max), 0)
    const nextOrder = fileVirtualFolders.length === 0 ? 0 : maxOrder + 1
    const id = `${name}-${Math.random().toString(16).slice(2, 8)}`
    const next = [...fileVirtualFolders, { id, name, order: nextOrder }]
    setFileVirtualFolders(next)
    setCollapsedFileVirtualFolders((prev) => ({ ...prev, [id]: true }))

    void (async () => {
      const resp = await saveFileVirtualFolders(next)
      if (!resp.ok) {
        console.error('[Sidebar] saveFileVirtualFolders failed', resp.error)
        if (typeof window !== 'undefined' && typeof window.alert === 'function') {
          window.alert(resp.error.message ?? '保存虚拟文件夹失败')
        }
      }
    })()

    setCreatingFileFolder(false)
    setCreatingFileFolderName('')
  }

  const startFileVirtualFolderRename = (folder: FileVirtualFolder) => {
    setRenamingFileFolderId(folder.id)
    setRenamingFileFolderName(folder.name)
  }

  const handleFileVirtualFolderRenameChange = (value: string) => {
    setRenamingFileFolderName(value)
  }

  const handleFileVirtualFolderRenameCancel = () => {
    setRenamingFileFolderId(null)
    setRenamingFileFolderName('')
  }

  const handleFileVirtualFolderRenameConfirm = () => {
    if (!renamingFileFolderId) return
    const nextName = renamingFileFolderName.trim()
    if (!nextName) {
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert('虚拟文件夹名称不能为空')
      }
      return
    }

    const current = fileVirtualFolders.find((f) => f.id === renamingFileFolderId)
    if (!current) {
      setRenamingFileFolderId(null)
      setRenamingFileFolderName('')
      return
    }

    if (current.name === nextName) {
      setRenamingFileFolderId(null)
      setRenamingFileFolderName('')
      return
    }

    if (fileVirtualFolders.some((f) => f.name === nextName && f.id !== renamingFileFolderId)) {
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert('已存在同名虚拟文件夹')
      }
      return
    }

    const next = fileVirtualFolders.map((f) =>
      f.id === renamingFileFolderId ? { ...f, name: nextName } : f,
    )
    setFileVirtualFolders(next)

    void (async () => {
      const resp = await saveFileVirtualFolders(next)
      if (!resp.ok) {
        console.error('[Sidebar] saveFileVirtualFolders(rename) failed', resp.error)
        if (typeof window !== 'undefined' && typeof window.alert === 'function') {
          window.alert(resp.error.message ?? '重命名虚拟文件夹失败')
        }
      }
    })()

    setRenamingFileFolderId(null)
    setRenamingFileFolderName('')
  }

  useEffect(() => {
    if (typeof localStorage === 'undefined') return
    try {
      localStorage.setItem('haomd:files:virtual:collapsed-folders', JSON.stringify(collapsedFileVirtualFolders))
    } catch (e) {
      console.warn('[Sidebar] persist collapsedFileVirtualFolders failed', e)
    }
  }, [collapsedFileVirtualFolders])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        console.log('[Sidebar][FilesVirtual] bootstrap start', {
          standaloneFilesCount: standaloneFiles.length,
        })

        const [foldersResult, assignmentsResult] = await Promise.all([
          loadFileVirtualFolders(),
          listFileVirtualAssignments(),
        ])
        if (cancelled) return

        console.log('[Sidebar][FilesVirtual] load results', {
          foldersOk: foldersResult.ok,
          foldersCount: foldersResult.ok ? foldersResult.data.length : undefined,
          assignmentsOk: assignmentsResult.ok,
          assignmentsCount: assignmentsResult.ok ? assignmentsResult.data.length : undefined,
        })

        if (foldersResult.ok) {
          setFileVirtualFolders(foldersResult.data)
        } else {
          console.warn('[Sidebar] loadFileVirtualFolders error', foldersResult.error)
          setFileVirtualFolders([])
        }

        if (assignmentsResult.ok) {
          setFileVirtualAssignments(assignmentsResult.data)
        } else {
          console.warn('[Sidebar] listFileVirtualAssignments error', assignmentsResult.error)
          setFileVirtualAssignments([])
        }
      } catch (e) {
        if (cancelled) return
        console.warn('[Sidebar] load file virtual state failed', e)
        setFileVirtualFolders([])
        setFileVirtualAssignments([])
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    console.log('[Sidebar][FilesVirtual] state snapshot', {
      standaloneFiles: standaloneFiles.map((f) => f.path),
      fileVirtualFolders: fileVirtualFolders.map((f) => ({ id: f.id, name: f.name, order: f.order })),
      fileVirtualAssignments,
    })
  }, [standaloneFiles, fileVirtualFolders, fileVirtualAssignments])

  const assignmentsByPath = new Map<string, string | null>()
  for (const item of fileVirtualAssignments) {
    assignmentsByPath.set(item.path, item.folderId)
  }

  const rootFiles: StandaloneFileItem[] = []
  const filesByFolderId = new Map<string, StandaloneFileItem[]>()
  for (const file of standaloneFiles) {
    const folderId = assignmentsByPath.get(file.path) ?? null
    if (!folderId) {
      rootFiles.push(file)
    } else {
      const list = filesByFolderId.get(folderId) ?? []
      list.push(file)
      filesByFolderId.set(folderId, list)
    }
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
            <div className="sidebar-section-header">
              <div className="sidebar-section-title">Files</div>
              <div className="files-section-actions">
                <button
                  type="button"
                  className="files-virtual-folder-add-btn"
                  title="新建虚拟文件夹"
                  onClick={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    handleCreateFileVirtualFolder()
                  }}
                >
                  +
                </button>
              </div>
            </div>

            {creatingFileFolder && (
              <div className="sidebar-virtual-folder-inline-create">
                <input
                  type="text"
                  className="sidebar-virtual-folder-inline-input"
                  placeholder="输入虚拟文件夹名称后按回车确认，Esc 取消"
                  autoFocus
                  value={creatingFileFolderName}
                  onChange={(e) => handleFileFolderInlineNameChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleFileFolderInlineConfirm()
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      handleFileFolderInlineCancel()
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            )}

            <ul className="sidebar-file-list">
              {rootFiles.map((file) => (
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

            {fileVirtualFolders.length > 0 && (
              <div className="sidebar-virtual-folders">
                {fileVirtualFolders.map((folder) => {
                  const files = filesByFolderId.get(folder.id) ?? []
                  const isCollapsed = collapsedFileVirtualFolders[folder.id] ?? false
                  const isRenaming = renamingFileFolderId === folder.id
                  return (
                    <div key={folder.id} className="sidebar-virtual-folder-section">
                      <div
                        className="sidebar-virtual-folder-header"
                        onClick={() => {
                          if (!isRenaming) {
                            toggleFileVirtualFolderCollapse(folder.id)
                          }
                        }}
                      >
                        <span className="sidebar-virtual-folder-toggle-icon">{isCollapsed ? '▸' : '▾'}</span>
                        {isRenaming ? (
                          <input
                            type="text"
                            className="sidebar-virtual-folder-inline-input"
                            autoFocus
                            value={renamingFileFolderName}
                            onChange={(e) => handleFileVirtualFolderRenameChange(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                handleFileVirtualFolderRenameConfirm()
                              } else if (e.key === 'Escape') {
                                e.preventDefault()
                                handleFileVirtualFolderRenameCancel()
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                            onBlur={() => handleFileVirtualFolderRenameCancel()}
                          />
                        ) : (
                          <span
                            className="sidebar-virtual-folder-name"
                            onDoubleClick={(e) => {
                              e.stopPropagation()
                              startFileVirtualFolderRename(folder)
                            }}
                          >
                            {folder.name}
                          </span>
                        )}
                        <button
                          type="button"
                          className="sidebar-virtual-folder-delete-btn"
                          title="删除虚拟文件夹"
                          onClick={(e) => {
                            e.stopPropagation()
                            e.preventDefault()
                            requestDeleteFileVirtualFolder(folder)
                          }}
                        >
                          ×
                        </button>
                      </div>
                      {isCollapsed ? null : (
                        files.length === 0 ? (
                          <div className="sidebar-virtual-folder-empty">
                            No files yet. Move files into this virtual folder to show them here.
                          </div>
                        ) : (
                          <ul className="sidebar-file-list">
                            {files.map((file) => (
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
                        )
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        )}

        {hasTree && (
          <section className="sidebar-section">
            <div className="sidebar-section-header">
              <div className="sidebar-section-title">Folders</div>
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
        <FileContextMenu
          x={menuState.x}
          y={menuState.y}
          onRequestClose={closeMenu}
          items={(() => {
            const target = menuState.target!
            const items = [
              { id: 'open', label: 'Open', onClick: () => triggerContextAction('open') },
              { id: 'open-in-file-manager', label: 'Open in File Manager', onClick: () => triggerContextAction('open-in-file-manager') },
              { id: 'open-terminal', label: 'Open in Terminal', onClick: () => triggerContextAction('open-terminal') },
            ] as { id: string; label: string; onClick: () => void }[]

            const isStandaloneFile = target.kind === 'standalone-file'
            const isFileTarget = target.kind === 'standalone-file' || target.kind === 'tree-file'
            const isTreeDir = target.kind === 'tree-dir'
            const isFolderRoot = target.kind === 'folder-root'

            if (isStandaloneFile && fileVirtualFolders.length > 0) {
              items.push({
                id: 'move-to-virtual-folder',
                label: 'Move to Virtual Folder…',
                onClick: () => {
                  const offsetX = 180
                  setFileFolderMenuState({
                    visible: true,
                    x: menuState.x + offsetX,
                    y: menuState.y,
                    targetPath: target.path,
                  })
                  closeMenu()
                },
              })
            }

            if (isFileTarget || isTreeDir) {
              items.push({ id: 'delete', label: 'Delete…', onClick: () => triggerContextAction('delete') })
            }
            if (isStandaloneFile) {
              items.push({ id: 'remove', label: 'Remove from File List', onClick: () => triggerContextAction('remove') })
            }
            if (isFolderRoot) {
              items.push({ id: 'remove-folder', label: 'Remove Folder', onClick: () => triggerContextAction('remove') })
            }

            return items
          })()}
        />
      )}

      {fileFolderMenuState.visible && fileFolderMenuState.targetPath && fileVirtualFolders.length > 0 && (
        <FileContextMenu
          x={fileFolderMenuState.x}
          y={fileFolderMenuState.y}
          onRequestClose={() => setFileFolderMenuState({ visible: false, x: 0, y: 0, targetPath: null })}
          items={[
            {
              id: 'move-to-root',
              label: 'Move to Root (No Folder)',
              onClick: () => {
                const targetPath = fileFolderMenuState.targetPath!
                // Move to Root 语义：删除该 path 的虚拟分配记录
                setFileVirtualAssignments((prev) => prev.filter((item) => item.path !== targetPath))
                void (async () => {
                  const resp = await updateFileVirtualFolderForPath(targetPath, null)
                  if (!resp.ok) {
                    console.error('[Sidebar] updateFileVirtualFolderForPath(null) failed', resp.error)
                    if (typeof window !== 'undefined') {
                      window.alert(resp.error.message ?? '更新虚拟文件夹失败')
                    }
                  }
                })()
                setFileFolderMenuState({ visible: false, x: 0, y: 0, targetPath: null })
              },
            },
            ...fileVirtualFolders.map((folder) => ({
              id: `move-to-folder-${folder.id}`,
              label: folder.name,
              onClick: () => {
                const targetPath = fileFolderMenuState.targetPath!
                console.log('[Sidebar][FilesVirtual] moveToVirtualFolder clicked', {
                  targetPath,
                  folderId: folder.id,
                  folderName: folder.name,
                })
                setFileVirtualAssignments((prev) => {
                  const now = Date.now()
                  const idx = prev.findIndex((item) => item.path === targetPath)
                  if (idx >= 0) {
                    const next = [...prev]
                    next[idx] = { ...next[idx], folderId: folder.id, updatedAt: now }
                    return next
                  }
                  return [...prev, { path: targetPath, folderId: folder.id, updatedAt: now }]
                })
                void (async () => {
                  console.log('[Sidebar][FilesVirtual] call updateFileVirtualFolderForPath', {
                    targetPath,
                    folderId: folder.id,
                  })
                  const resp = await updateFileVirtualFolderForPath(targetPath, folder.id)
                  console.log('[Sidebar][FilesVirtual] updateFileVirtualFolderForPath resp', resp)
                  if (!resp.ok) {
                    console.error('[Sidebar] updateFileVirtualFolderForPath failed', resp.error)
                    if (typeof window !== 'undefined') {
                      window.alert(resp.error.message ?? '更新虚拟文件夹失败')
                    }
                  }
                })()
                setFileFolderMenuState({ visible: false, x: 0, y: 0, targetPath: null })
              },
            })),
          ]}
        />
      )}
    </aside>
  )
}
