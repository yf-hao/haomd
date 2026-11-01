import { memo, useEffect, useRef, useState } from 'react'
import type { FileTreeNode } from '../domain/sidebarTree'
import { FileContextMenu } from './FileContextMenu'
import { SidebarBackgroundShell } from './SidebarBackgroundShell'
import { useI18n } from '../modules/i18n/I18nContext'
import type { FileVirtualFolder, FileVirtualAssignment } from '../modules/files/types'
import { loadFileVirtualFolders, listFileVirtualAssignments, saveFileVirtualFolders, updateFileVirtualFolderForPath } from '../modules/files/service'
import './Sidebar.css'
import { useFileTreeDragDrop } from '../hooks/useFileTreeDragDrop'
import { useFileBrowserSelection } from '../hooks/useFileBrowserSelection'
import { entryKey, type FileBrowserEntry } from '../domain/fileBrowserSelection'
import { entryFromRow, fileBrowserRowSelector, visibleFileEntries } from './fileBrowserSelectionDom'

export type StandaloneFileItem = {
  path: string
  name: string
}

export type SidebarContextTargetKind = FileBrowserEntry['kind']

export type SidebarContextAction =
  | 'open'
  | 'copy'
  | 'paste'
  | 'remove'
  | 'delete'
  | 'rename'
  | 'open-terminal'
  | 'open-in-file-manager'
  | 'new-file'
  | 'new-folder'

export type SidebarContextActionPayload = {
  path: string
  kind: SidebarContextTargetKind
  action: SidebarContextAction
  targets?: FileBrowserEntry[]
}

export type SidebarProps = {
  standaloneFiles: StandaloneFileItem[]
  folderRoots: string[]
  treesByRoot: Record<string, FileTreeNode[]>
  expanded: Record<string, boolean>
  onToggle: (path: string) => void
  onFileClick: (path: string) => void
  onDirClick?: (path: string) => void  // 文件夹点击回调（用于选中文件夹）
  canPaste?: boolean
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
  /** 行内重命名：当前处于重命名状态的文件或文件夹完整路径 */
  inlineRenamePath?: string | null
  /** 行内重命名：确认新名称 */
  onInlineRenameConfirm?: (name: string) => void
  /** 行内重命名：取消 */
  onInlineRenameCancel?: () => void
  activePath?: string | null
  panelWidth?: number
  highlightedPaths?: string[]
  onFileVisited?: (path: string) => void
  /** 通过 WorkspaceShell 统一的 ConfirmDialog 删除 Files 虚拟文件夹 */
  onRequestConfirmDeleteFileVirtualFolder?: (options: {
    folder: FileVirtualFolder
    onConfirm: () => void
  }) => void
  onMoveFile?: (source: string, directory: string) => Promise<void>
  onNotify?: (msg: string) => void
}

type TreeNodeProps = {
  selectedPaths: ReadonlySet<string>
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
  inlineRenamePath?: string | null
  onInlineRenameConfirm?: (name: string) => void
  onInlineRenameCancel?: () => void
}

function SidebarFileIcon() {
  return (
    <svg className="tree-icon file-icon" viewBox="0 0 16 18" aria-hidden="true">
      <path d="M3 1.5h6l4 4v11H3z" />
      <path d="M9 1.5v4h4M5.5 9h5M5.5 12h5" />
    </svg>
  )
}

function SidebarFolderPlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.75 6.5V18a1.5 1.5 0 0 0 1.5 1.5h15.5V8a1.5 1.5 0 0 0-1.5-1.5h-7l-2-2H4.25a1.5 1.5 0 0 0-1.5 1.5Z" />
      <circle cx="18" cy="18" r="4" />
      <path d="M18 16v4M16 18h4" />
    </svg>
  )
}

const TreeNode = memo(function TreeNode({ selectedPaths, node, level, expanded, onToggle, onFileClick, onDirClick, activePath, highlightedPaths, onFileVisited, onContextMenu, inlineNewFileDir, onInlineNewFileConfirm, onInlineNewFileCancel, inlineNewFolderDir, onInlineNewFolderConfirm, onInlineNewFolderCancel, inlineRenamePath, onInlineRenameConfirm, onInlineRenameCancel }: TreeNodeProps) {
  const isExpanded = !!expanded[node.path]
  const isActive = selectedPaths.size === 0 && activePath === node.path
  const isHighlighted = highlightedPaths?.includes(node.path.replace(/\\/g, '/')) ?? false

  const paddingLeft = 8 + level * 12

  const isRenamingThisNode = inlineRenamePath === node.path

  if (node.kind === 'dir') {
    return (
      <div>
        {isRenamingThisNode ? (
          <InlineRenameRow
            level={level}
            isFolder={true}
            initialName={node.name}
            onConfirm={onInlineRenameConfirm}
            onCancel={onInlineRenameCancel}
          />
        ) : (
          <div
            data-file-directory={node.path}
            data-file-kind="tree-dir"
            data-selected={selectedPaths.has(entryKey({ path: node.path, kind: 'tree-dir' }))}
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
        )}
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
                selectedPaths={selectedPaths}
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
                inlineRenamePath={inlineRenamePath}
                onInlineRenameConfirm={onInlineRenameConfirm}
                onInlineRenameCancel={onInlineRenameCancel}
              />
            ))}
          </>
        )}
      </div>
    )
  }

  const className = `tree-row file ${isActive ? 'active' : ''} ${isHighlighted ? 'highlighted' : ''}`.trim()

  if (isRenamingThisNode) {
    return (
      <InlineRenameRow
        level={level}
        isFolder={false}
        initialName={node.name}
        onConfirm={onInlineRenameConfirm}
        onCancel={onInlineRenameCancel}
      />
    )
  }

  return (
    <div
      data-file-source={node.path}
      data-file-kind="tree-file"
      data-selected={selectedPaths.has(entryKey({ path: node.path, kind: 'tree-file' }))}
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
      <SidebarFileIcon />
      <span className="tree-name">{node.name}</span>
    </div>
  )
})

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

  const placeholder = isFolder ? 'new folder' : 'untitled'
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


type InlineRenameRowProps = {
  level: number
  isFolder: boolean
  initialName: string
  onConfirm?: (name: string) => void
  onCancel?: () => void
}

function InlineRenameRow({ level, isFolder, initialName, onConfirm, onCancel }: InlineRenameRowProps) {
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
    } else {
      onConfirm?.(name)
    }

    // 重命名结束后，将焦点主动留在 Sidebar，方便继续按 Enter
    if (inputRef.current) {
      const sidebarEl = inputRef.current.closest('.sidebar') as HTMLElement | null
      if (sidebarEl && typeof sidebarEl.focus === 'function') {
        sidebarEl.focus()
      }
    }
  }

  const icon = isFolder ? '📁' : '📄'
  const rowClass = isFolder ? 'tree-row dir rename-editing' : 'tree-row file rename-editing'

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
        defaultValue={initialName}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            finish(true, e.currentTarget.value)
          } else if (e.key === 'Escape') {
            e.preventDefault()
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


export function Sidebar({ standaloneFiles, folderRoots, treesByRoot, expanded, onToggle, onFileClick, onDirClick, onContextAction, canPaste = false, onToolbarNewFileInCurrentFolder, onToolbarNewFolderInCurrentFolder, onToolbarRefreshCurrentFolder, inlineNewFileDir, onInlineNewFileConfirm, onInlineNewFileCancel, inlineNewFolderDir, onInlineNewFolderConfirm, onInlineNewFolderCancel, inlineRenamePath, onInlineRenameConfirm, onInlineRenameCancel, activePath, panelWidth, highlightedPaths, onFileVisited, onRequestConfirmDeleteFileVirtualFolder, onMoveFile, onNotify }: SidebarProps) {
  const selection = useFileBrowserSelection()
  const selectedPaths = selection.selectedPaths
  const sidebarElement = useRef<HTMLElement | null>(null)
  const keyboardTarget = useRef<FileBrowserEntry | null>(null)
  const selectClipboardTarget = (event: React.MouseEvent<HTMLElement>) => {
    const element = event.target as HTMLElement
    if (element.closest('input, textarea, [contenteditable="true"]')) return
    const row = element.closest<HTMLElement>(fileBrowserRowSelector)
    if (!row) return
    sidebarElement.current = event.currentTarget
    const target = entryFromRow(row)
    keyboardTarget.current = target
    const mode = event.type === 'contextmenu' ? 'context'
      : event.shiftKey ? 'range' : event.ctrlKey || event.metaKey ? 'toggle' : 'single'
    selection.select(target, visibleFileEntries(event.currentTarget), mode)
    event.currentTarget.focus({ preventScroll: true })
    if (event.type !== 'contextmenu' && mode !== 'single') {
      closeMenu()
      event.preventDefault()
      event.stopPropagation()
    }
  }
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey
        || inlineRenamePath || inlineNewFileDir || inlineNewFolderDir) return
      const active = document.activeElement as HTMLElement | null
      if (!active?.closest('.sidebar') || active.closest('input, textarea, [contenteditable="true"]')) return
      const key = event.key.toLowerCase()
      if (key === 'enter' && selection.entries.length > 1) { event.preventDefault(); event.stopPropagation(); return }
      const deleting = (key === 'delete' || key === 'backspace') && !event.ctrlKey && !event.metaKey
      if (!deleting && !((key === 'c' || key === 'v') && (event.ctrlKey || event.metaKey))) return
      const target = keyboardTarget.current
      if (!onContextAction) return
      event.preventDefault()
      event.stopPropagation()
      if (!target || !selection.entries.length) return
      if (key === 'v' && !canPaste) return
      onContextAction({ ...target, action: deleting ? 'delete' : key === 'c' ? 'copy' : 'paste', targets: selection.entries })
    }
    // WebView2 的粘贴快捷键可能只到达 document，按焦点限制在文件浏览器内处理。
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [canPaste, onContextAction, inlineRenamePath, inlineNewFileDir, inlineNewFolderDir, selection.entries])
  const dragHandlers = useFileTreeDragDrop({
    disabled: Boolean(inlineRenamePath || inlineNewFileDir || inlineNewFolderDir || selection.entries.length > 1),
    expanded, expand: onToggle, move: onMoveFile, onError: onNotify,
  })
  const { t } = useI18n()
  const [browserSection, setBrowserSection] = useState<'files' | 'folders'>(() => {
    try {
      return localStorage.getItem('haomd:sidebar:active-section') === 'folders' ? 'folders' : 'files'
    } catch {
      return 'files'
    }
  })
  const [menuState, setMenuState] = useState<{
    visible: boolean
    x: number
    y: number
    target: { path: string; kind: SidebarContextTargetKind } | null
  }>({ visible: false, x: 0, y: 0, target: null })

  const [fileVirtualFolders, setFileVirtualFolders] = useState<FileVirtualFolder[]>([])
  const [fileVirtualAssignments, setFileVirtualAssignments] = useState<FileVirtualAssignment[]>([])
  useEffect(() => {
    const moved = (event: Event) => {
      const { oldPath, newPath } = (event as CustomEvent<{ oldPath: string; newPath: string }>).detail
      setFileVirtualAssignments(items => items.map(item => item.path.replace(/\\/g, '/') === oldPath.replace(/\\/g, '/') ? { ...item, path: newPath.replace(/\\/g, '/') } : item))
    }
    window.addEventListener('haomd:file-relocated', moved)
    return () => window.removeEventListener('haomd:file-relocated', moved)
  }, [])
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

  // Refresh/collapse/delete must not leave invisible entries selected.
  useEffect(() => {
    if (sidebarElement.current?.isConnected) selection.prune(visibleFileEntries(sidebarElement.current))
  }, [treesByRoot, standaloneFiles, expanded, collapsedFileVirtualFolders,
    fileVirtualFolders, fileVirtualAssignments, selection.prune])

  const closeMenu = () => setMenuState({ visible: false, x: 0, y: 0, target: null })

  const triggerContextAction = (action: SidebarContextAction) => {
    if (!menuState.visible || !menuState.target || !onContextAction) return
    onContextAction({
      path: menuState.target.path,
      kind: menuState.target.kind,
      action,
      targets: selection.entries,
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
            onNotify?.(saveResp.error.message ?? '删除虚拟文件夹失败')
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
          onNotify?.('删除虚拟文件夹失败')
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
        onNotify?.('已存在同名虚拟文件夹')
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
          onNotify?.(resp.error.message ?? '保存虚拟文件夹失败')
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
        onNotify?.('虚拟文件夹名称不能为空')
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
        onNotify?.('已存在同名虚拟文件夹')
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
          onNotify?.(resp.error.message ?? '重命名虚拟文件夹失败')
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

  return (
    <SidebarBackgroundShell
      as="aside"
      {...dragHandlers}
      className="sidebar"
      style={asideStyle}
      tabIndex={0}
      onMouseDownCapture={(event) => {
        if (event.shiftKey && (event.target as HTMLElement).closest(fileBrowserRowSelector)) event.preventDefault()
      }}
      onClickCapture={selectClipboardTarget}
      onContextMenuCapture={selectClipboardTarget}
      onClick={closeMenu}
      onContextMenu={(e) => {
        e.preventDefault()
        closeMenu()
      }}
    >
      {selection.entries.length > 1 && <div className="sidebar-selection-count" role="status">
        {t('sidebar.selectedCount', { count: selectedPaths.size })}
      </div>}
      <div className="sidebar-browser-tabs" role="tablist" aria-label={t('sidebar.fileBrowser')}>
        {(['files', 'folders'] as const).map((section) => (
          <button
            key={section}
            type="button"
            role="tab"
            aria-selected={browserSection === section}
            className={`sidebar-browser-tab ${browserSection === section ? 'active' : ''}`}
            onClick={() => {
              setBrowserSection(section)
              try { localStorage.setItem('haomd:sidebar:active-section', section) } catch { /* storage may be unavailable */ }
            }}
          >
            {t(section === 'files' ? 'sidebar.files' : 'sidebar.folders')}
          </button>
        ))}
      </div>
      <div className="sidebar-toolbar-row">
        {browserSection === 'files' ? (
          <div className="files-section-actions">
            <button
              type="button"
              className="files-virtual-folder-add-btn"
              title={t('sidebar.newVirtualFolder')}
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                handleCreateFileVirtualFolder()
              }}
            >
              <SidebarFolderPlusIcon />
            </button>
          </div>
        ) : (
          <div className="folder-section-actions">
            <button
              type="button"
              className="folder-action-btn icon-new-file"
              title={t('sidebar.newFileInCurrentFolder')}
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                onToolbarNewFileInCurrentFolder?.()
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 2.75h8.5L18 7.25v11.5H5zM13.5 2.75v4.5H18" />
                <circle cx="18" cy="18" r="4" />
                <path d="M18 16v4M16 18h4" />
              </svg>
            </button>
            <button
              type="button"
              className="folder-action-btn icon-new-folder"
              title={t('sidebar.newFolderInCurrentFolder')}
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                onToolbarNewFolderInCurrentFolder?.()
              }}
            >
              <SidebarFolderPlusIcon />
            </button>
            <button
              type="button"
              className="folder-action-btn icon-refresh"
              title={t('sidebar.refreshCurrentFolder')}
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                onToolbarRefreshCurrentFolder?.()
              }}
            >
              <svg className="folder-refresh-icon" viewBox="0 0 1024 1024" aria-hidden="true">
                <path d="M935.161672 427.51891c-14.511505-11.744485-37.643342-9.155521-49.1627 5.403057l-12.9438 16.20917c-.926092-5.842055-1.995447-11.625782-3.158946-17.325597C831.326792 245.594511 666.360623 110.434182 477.668077 110.434182c-27.455305 0-55.099922 2.885723-82.198094 8.562003C179.036629 164.405397 39.60195 378.546545 84.655052 596.34499c38.522362 186.222285 203.488531 321.383638 392.229173 321.383638 27.430746 0 55.076386-2.873444 82.174558-8.549723 75.144444-15.746636 144.18589-53.508681 198.288089-108.002806l1.87572-1.662873c1.757017-1.74576 2.778276-3.432169 2.588965-3.443425l1.781576-2.387373c2.137687-3.527336 4.65502-9.191336 4.65502-16.173354 0-17.361413-14.035668-31.479969-31.326473-31.479969-4.275373 0-8.454556.914836-12.325723 2.612501l-1.90028-1.318018-8.644891 8.65717c-46.359864 46.478568-104.261599 78.042447-167.484525 91.283006-22.657023 4.750187-45.766346 7.160073-68.684312 7.160073-157.818375 0-295.733445-113.073288-327.96145-268.87268-37.738509-182.291766 78.849836-361.484961 259.918751-399.448598 22.657023-4.750187 45.766346-7.160073 68.708871-7.160073 157.793816 0 295.709909 113.061009 327.96145 268.860401.427742 2.101871.855484 4.227278 1.258667 6.364965l-13.751189-11.091616c-14.511505-11.768021-37.59627-9.1678-49.1627 5.390777-12.017708 15.056927-9.619078 37.156248 5.343705 49.269124l78.089519 63.1032c.14224.106424.285502.213871.427742.332575l3.491521 2.814092h.712221c6.483668 3.657296 15.770172 4.964058 21.065781 4.322445 9.475815-.890276 17.954931-5.485945 23.940249-12.93152l62.723553-78.659501c11.91026-14.926967 9.464558-37.002752-5.426594-49.043996z" />
              </svg>
            </button>
          </div>
        )}
      </div>
      <div className="sidebar-body">
        {browserSection === 'files' && (
          <section className="sidebar-section">
            <div className="sidebar-section-content">
                {creatingFileFolder && (
                  <div className="sidebar-virtual-folder-inline-create">
                    <input
                      type="text"
                      className="sidebar-virtual-folder-inline-input"
                      placeholder={t('sidebar.virtualFolderPlaceholder')}
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
                  {rootFiles.map((file) => {
                    const isActive = selectedPaths.size === 0 && activePath === file.path
                    const isRenaming = inlineRenamePath === file.path
                    if (isRenaming) {
                      return (
                        <li key={file.path} className="sidebar-file-row">
                          <InlineRenameRow
                            level={0}
                            isFolder={false}
                            initialName={file.name}
                            onConfirm={onInlineRenameConfirm}
                            onCancel={onInlineRenameCancel}
                          />
                        </li>
                      )
                    }
                    return (
                      <li
                        key={file.path}
                        data-file-source={file.path}
                        data-file-kind="standalone-file"
                        data-selected={selectedPaths.has(entryKey({ path: file.path, kind: 'standalone-file' }))}
                        className={`sidebar-file-row tree-row file ${isActive ? 'active' : ''}`}
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
                        <SidebarFileIcon />
                        <span className="tree-name">{file.name}</span>
                      </li>
                    )
                  })}
                </ul>

                {standaloneFiles.length === 0 && <div className="sidebar-empty-state">{t('sidebar.noFiles')}</div>}

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
                              title={t('sidebar.deleteVirtualFolder')}
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
                                {t('sidebar.noFilesInVirtualFolder')}
                              </div>
                            ) : (
                              <ul className="sidebar-file-list">
                                {files.map((file) => (
                                  <li
                                    key={file.path}
                                    data-file-source={file.path}
                                    data-file-kind="standalone-file"
                        data-selected={selectedPaths.has(entryKey({ path: file.path, kind: 'standalone-file' }))}
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
                                    <SidebarFileIcon />
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
            </div>
          </section>
        )}

        {browserSection === 'folders' && (
          <section className="sidebar-section">
            {folderRoots.length > 0 && (
              <ul className="sidebar-folder-list">
                {folderRoots.map((rootPath) => {
                  const name = rootPath.split(/[/\\]/).pop() ?? rootPath
                  const isExpandedRoot = !!expanded[rootPath]
                  const isActiveRoot = selectedPaths.size === 0 && activePath === rootPath
                  const children = treesByRoot[rootPath] ?? []
                  return (
                    <li key={rootPath}>
                      <div
                        className={`sidebar-folder-row ${isActiveRoot ? 'active' : ''}`}
                        data-file-directory={rootPath}
                        data-file-kind="folder-root"
                        data-selected={selectedPaths.has(entryKey({ path: rootPath, kind: 'folder-root' }))}
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
                              selectedPaths={selectedPaths}
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
                              inlineRenamePath={inlineRenamePath}
                              onInlineRenameConfirm={onInlineRenameConfirm}
                              onInlineRenameCancel={onInlineRenameCancel}
                            />
                          ))}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            {folderRoots.length === 0 && <div className="sidebar-empty-state">{t('sidebar.noFiles')}</div>}
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
              { id: 'open', label: t('sidebar.open'), onClick: () => triggerContextAction('open') },
              { id: 'open-in-file-manager', label: t('sidebar.openInFileManager'), onClick: () => triggerContextAction('open-in-file-manager') },
              { id: 'open-terminal', label: t('sidebar.openInTerminal'), onClick: () => triggerContextAction('open-terminal') },
              { id: 'copy', label: t('sidebar.copyEntry'), onClick: () => triggerContextAction('copy') },
              { id: 'paste', label: t('sidebar.pasteEntry'), disabled: !canPaste, onClick: () => triggerContextAction('paste') },
            ] as { id: string; label: string; disabled?: boolean; onClick: () => void }[]

            const isStandaloneFile = target.kind === 'standalone-file'
            const isFileTarget = target.kind === 'standalone-file' || target.kind === 'tree-file'
            const isTreeDir = target.kind === 'tree-dir'
            const isFolderRoot = target.kind === 'folder-root'

            if (isTreeDir || isFolderRoot) {
              items.push({
                id: 'new-file',
                label: t('sidebar.newFile'),
                onClick: () => triggerContextAction('new-file'),
              })
              items.push({
                id: 'new-folder',
                label: t('sidebar.newFolder'),
                onClick: () => triggerContextAction('new-folder'),
              })
            }

            if (isStandaloneFile && fileVirtualFolders.length > 0) {
              items.push({
                id: 'move-to-virtual-folder',
                label: t('sidebar.moveToVirtualFolder'),
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

            if (isFileTarget || isTreeDir || isFolderRoot) {
              if (selection.entries.length <= 1 && !isFolderRoot) items.push({ id: 'rename', label: t('sidebar.rename'), onClick: () => triggerContextAction('rename') })
              items.push({ id: 'delete', label: t('sidebar.deleteEntry'), onClick: () => triggerContextAction('delete') })
            }
            if (isStandaloneFile) {
              items.push({ id: 'remove', label: t('sidebar.removeFromFileList'), onClick: () => triggerContextAction('remove') })
            }
            if (isFolderRoot) {
              items.push({ id: 'remove-folder', label: t('sidebar.removeFolder'), onClick: () => triggerContextAction('remove') })
            }

            return selection.entries.length > 1 ? items.filter(item => ['copy', 'paste', 'delete'].includes(item.id)) : items
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
                      onNotify?.(resp.error.message ?? '更新虚拟文件夹失败')
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
                      onNotify?.(resp.error.message ?? '更新虚拟文件夹失败')
                    }
                  }
                })()
                setFileFolderMenuState({ visible: false, x: 0, y: 0, targetPath: null })
              },
            })),
          ]}
        />
      )}
    </SidebarBackgroundShell>
  )
}
