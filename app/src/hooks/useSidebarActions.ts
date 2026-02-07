import { useCallback } from 'react'
import type { SidebarContextActionPayload } from '../components/Sidebar'
import type { Result } from '../modules/files/service'

export function useSidebarActions(options: {
  tabs: { id: string; path?: string | null }[]
  setActiveTab: (id: string) => void
  openFileInNewTab: (path: string) => Promise<Result<{ path: string }>>
  sidebar: {
    addStandaloneFile: (path: string) => void
    removeStandaloneFile: (path: string) => void
    removeFolderRoot: (path: string) => void
  }
  deleteFsEntry: (path: string) => Promise<Result<void>>
  setStatusMessage: (msg: string) => void
  closeTab: (id: string) => void
  setConfirmDialog: (state: any) => void
}) {
  const { tabs, setActiveTab, openFileInNewTab, sidebar, deleteFsEntry, setStatusMessage, closeTab, setConfirmDialog } = options

  const openFileFromSidebar = useCallback(
    async (path: string) => {
      const existing = tabs.find((t) => t.path === path)
      if (existing) {
        setActiveTab(existing.id)
        return { ok: true, data: { path: existing.path! } } as Result<{ path: string }>
      }
      return await openFileInNewTab(path)
    },
    [tabs, setActiveTab, openFileInNewTab],
  )

  const openRecentFileInNewTab = useCallback(
    async (path: string) => {
      const resp = await openFileInNewTab(path)
      if (!resp || !resp.ok) return resp
      sidebar.addStandaloneFile(resp.data.path)
      return resp
    },
    [openFileInNewTab, sidebar],
  )

  const closeTabsByPath = useCallback(
    (targetPath: string) => {
      const norm = targetPath
      tabs.forEach((tab) => {
        if (tab.path === norm) {
          closeTab(tab.id)
        }
      })
    },
    [tabs, closeTab],
  )

  const handleSidebarContextAction = useCallback(
    async (payload: SidebarContextActionPayload) => {
      const { path, kind, action } = payload

      if (action === 'open') {
        await openFileFromSidebar(path)
        return
      }

      if (action === 'remove') {
        if (kind === 'standalone-file') {
          sidebar.removeStandaloneFile(path)
        } else if (kind === 'folder-root') {
          sidebar.removeFolderRoot(path)
        }
        return
      }

      if (action === 'delete') {
        setConfirmDialog({
          title: '确认删除',
          message: `确认删除该文件？此操作不可撤销。\n\n${path}`,
          confirmText: '删除',
          onConfirm: async () => {
            setConfirmDialog(null)
            const resp = await deleteFsEntry(path)
            if (!resp.ok) {
              setStatusMessage(resp.error.message)
              return
            }
            sidebar.removeStandaloneFile(path)
            closeTabsByPath(path)
          },
        })
        return
      }
    },
    [openFileFromSidebar, sidebar, setStatusMessage, closeTabsByPath, deleteFsEntry, setConfirmDialog],
  )

  return {
    openFileFromSidebar,
    openRecentFileInNewTab,
    handleSidebarContextAction,
  }
}
