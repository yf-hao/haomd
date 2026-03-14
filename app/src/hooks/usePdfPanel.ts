import { useCallback, useEffect, useState } from 'react'
import { listPdfRecent, deletePdfRecent, loadPdfFolders, savePdfFolders, updatePdfRecentFolder, type PdfFolder } from '../modules/pdf/pdfRecentService'
import { deleteRecentRemote } from '../modules/files/service'
import type { RecentFile } from '../modules/files/types'

export interface UsePdfPanelParams {
  isTauriEnv: () => boolean
  setStatusMessage: (msg: string) => void
  setConfirmDialog: (dialog: any) => void
  activeLeftPanel: string | null
}

export interface UsePdfPanelReturn {
  pdfRecent: RecentFile[]
  pdfFolders: PdfFolder[]
  collapsedPdfFolders: Record<string, boolean>
  pdfRecentLoading: boolean
  pdfRecentError: string | null
  pdfNotes: Record<string, string>
  setPdfNotes: React.Dispatch<React.SetStateAction<Record<string, string>>>
  pdfMenuState: { visible: boolean; x: number; y: number; targetPath: string | null }
  setPdfMenuState: React.Dispatch<React.SetStateAction<{ visible: boolean; x: number; y: number; targetPath: string | null }>>
  pdfFolderMenuState: { visible: boolean; x: number; y: number; targetPath: string | null }
  setPdfFolderMenuState: React.Dispatch<React.SetStateAction<{ visible: boolean; x: number; y: number; targetPath: string | null }>>
  creatingPdfFolder: boolean
  creatingPdfFolderName: string
  renamingPdfFolderId: string | null
  renamingPdfFolderName: string
  closePdfMenu: () => void
  closePdfFolderMenu: () => void
  togglePdfFolderCollapse: (folderId: string) => void
  refreshPdfRecent: () => Promise<void>
  handleCreatePdfFolder: () => void
  handlePdfFolderInlineNameChange: (value: string) => void
  handlePdfFolderInlineCancel: () => void
  handlePdfFolderInlineConfirm: () => void
  startPdfFolderRename: (folder: PdfFolder) => void
  handlePdfFolderRenameChange: (value: string) => void
  handlePdfFolderRenameCancel: () => void
  handlePdfFolderRenameConfirm: () => void
  handleDeletePdfFolder: (folder: PdfFolder) => void
  movePdfToFolder: (path: string, folderId: string | null) => void
  handleRemovePdfFromRecent: (targetPath: string) => void
}

export function usePdfPanel({
  isTauriEnv,
  setStatusMessage,
  setConfirmDialog,
  activeLeftPanel,
}: UsePdfPanelParams): UsePdfPanelReturn {
  const [pdfRecent, setPdfRecent] = useState<RecentFile[]>([])
  const [pdfFolders, setPdfFolders] = useState<PdfFolder[]>([])
  const [collapsedPdfFolders, setCollapsedPdfFolders] = useState<Record<string, boolean>>({})
  const [pdfRecentLoading, setPdfRecentLoading] = useState(false)
  const [pdfRecentError, setPdfRecentError] = useState<string | null>(null)
  const [pdfNotes, setPdfNotes] = useState<Record<string, string>>({})
  const [pdfMenuState, setPdfMenuState] = useState<{ visible: boolean; x: number; y: number; targetPath: string | null }>({ visible: false, x: 0, y: 0, targetPath: null })
  const [pdfFolderMenuState, setPdfFolderMenuState] = useState<{ visible: boolean; x: number; y: number; targetPath: string | null }>({ visible: false, x: 0, y: 0, targetPath: null })
  const [creatingPdfFolder, setCreatingPdfFolder] = useState(false)
  const [creatingPdfFolderName, setCreatingPdfFolderName] = useState('')
  const [renamingPdfFolderId, setRenamingPdfFolderId] = useState<string | null>(null)
  const [renamingPdfFolderName, setRenamingPdfFolderName] = useState('')

  const closePdfMenu = useCallback(() => {
    setPdfMenuState({ visible: false, x: 0, y: 0, targetPath: null })
  }, [])

  const closePdfFolderMenu = useCallback(() => {
    setPdfFolderMenuState({ visible: false, x: 0, y: 0, targetPath: null })
  }, [])

  const togglePdfFolderCollapse = useCallback((folderId: string) => {
    setCollapsedPdfFolders((prev) => ({
      ...prev,
      [folderId]: !prev[folderId],
    }))
  }, [])

  const refreshPdfRecent = useCallback(async () => {
    console.log('[usePdfPanel.refreshPdfRecent] called, isTauriEnv =', isTauriEnv())
    if (!isTauriEnv()) {
      setPdfRecent([])
      setPdfRecentError('PDF 面板仅在桌面应用中可用')
      return
    }

    setPdfRecentLoading(true)
    setPdfRecentError(null)
    try {
      console.log('[usePdfPanel.refreshPdfRecent] before listPdfRecent()')
      const [items, folders] = await Promise.all([
        listPdfRecent(),
        loadPdfFolders(),
      ])
      console.log('[usePdfPanel.refreshPdfRecent] listPdfRecent items =', items)
      setPdfRecent(items)
      setPdfFolders(folders)
    } catch (e) {
      console.error('[usePdfPanel.refreshPdfRecent] listPdfRecent or loadPdfFolders failed', e)
      setPdfRecent([])
      setPdfFolders([])
      setPdfRecentError((e as any)?.message ?? '加载 PDF 最近文件失败')
    } finally {
      console.log('[usePdfPanel.refreshPdfRecent] finally, set loading = false')
      setPdfRecentLoading(false)
    }
  }, [isTauriEnv])

  // PDF 最近文件列表：仅在左侧 PDF 面板激活时从后端加载
  useEffect(() => {
    if (activeLeftPanel !== 'pdf') return

    let cancelled = false

    const load = async () => {
      if (cancelled) return
      console.log('[usePdfPanel.pdfPanelEffect] activeLeftPanel === "pdf", calling refreshPdfRecent')
      await refreshPdfRecent()
    }

    console.log('[usePdfPanel.pdfPanelEffect] effect mounted, activeLeftPanel =', activeLeftPanel)
    void load()

    return () => {
      cancelled = true
      console.log('[usePdfPanel.pdfPanelEffect] cleanup, cancelled = true')
    }
  }, [activeLeftPanel, refreshPdfRecent])

  const handleCreatePdfFolder = useCallback(() => {
    if (!isTauriEnv()) {
      setStatusMessage('虚拟文件夹仅在桌面应用中可用')
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert('虚拟文件夹仅在桌面应用中可用')
      }
      return
    }

    setCreatingPdfFolder(true)
    setCreatingPdfFolderName('')
  }, [isTauriEnv, setStatusMessage])

  const handlePdfFolderInlineNameChange = useCallback((value: string) => {
    setCreatingPdfFolderName(value)
  }, [])

  const handlePdfFolderInlineCancel = useCallback(() => {
    setCreatingPdfFolder(false)
    setCreatingPdfFolderName('')
  }, [])

  const handlePdfFolderInlineConfirm = useCallback(() => {
    const name = creatingPdfFolderName.trim()
    if (!name) {
      setCreatingPdfFolder(false)
      setCreatingPdfFolderName('')
      return
    }

    void (async () => {
      try {
        if (pdfFolders.some((f) => f.name === name)) {
          setStatusMessage('已存在同名虚拟文件夹')
          return
        }
        const id = `${name}-${Math.random().toString(16).slice(2, 8)}`
        const next = [...pdfFolders, { id, name }]
        next.sort((a, b) => a.name.localeCompare(b.name))
        await savePdfFolders(next)
        setPdfFolders(next)
        setCollapsedPdfFolders((prev) => ({ ...prev, [id]: true }))
      } catch (e) {
        console.error('[usePdfPanel] handlePdfFolderInlineConfirm failed', e)
        setStatusMessage((e as any)?.message ?? '创建虚拟文件夹失败')
      } finally {
        setCreatingPdfFolder(false)
        setCreatingPdfFolderName('')
      }
    })()
  }, [creatingPdfFolderName, pdfFolders, setStatusMessage])

  const startPdfFolderRename = useCallback((folder: PdfFolder) => {
    setRenamingPdfFolderId(folder.id)
    setRenamingPdfFolderName(folder.name)
  }, [])

  const handlePdfFolderRenameChange = useCallback((value: string) => {
    setRenamingPdfFolderName(value)
  }, [])

  const handlePdfFolderRenameCancel = useCallback(() => {
    setRenamingPdfFolderId(null)
    setRenamingPdfFolderName('')
  }, [])

  const handlePdfFolderRenameConfirm = useCallback(() => {
    if (!renamingPdfFolderId) return
    const nextName = renamingPdfFolderName.trim()
    if (!nextName) {
      setStatusMessage('虚拟文件夹名称不能为空')
      return
    }

    const current = pdfFolders.find((f) => f.id === renamingPdfFolderId)
    if (!current) {
      setRenamingPdfFolderId(null)
      setRenamingPdfFolderName('')
      return
    }

    if (current.name === nextName) {
      setRenamingPdfFolderId(null)
      setRenamingPdfFolderName('')
      return
    }

    if (pdfFolders.some((f) => f.name === nextName && f.id !== renamingPdfFolderId)) {
      setStatusMessage('已存在同名虚拟文件夹')
      return
    }

    void (async () => {
      try {
        const next = pdfFolders.map((f) => (f.id === renamingPdfFolderId ? { ...f, name: nextName } : f))
        next.sort((a, b) => a.name.localeCompare(b.name))
        await savePdfFolders(next)
        setPdfFolders(next)
      } catch (e) {
        console.error('[usePdfPanel] handlePdfFolderRenameConfirm failed', e)
        setStatusMessage((e as any)?.message ?? '重命名虚拟文件夹失败')
      } finally {
        setRenamingPdfFolderId(null)
        setRenamingPdfFolderName('')
      }
    })()
  }, [pdfFolders, renamingPdfFolderId, renamingPdfFolderName, setStatusMessage])

  const handleDeletePdfFolder = useCallback((folder: PdfFolder) => {
    if (!isTauriEnv()) {
      setStatusMessage('虚拟文件夹仅在桌面应用中可用')
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert('虚拟文件夹仅在桌面应用中可用')
      }
      return
    }

    const folderId = folder.id

    setConfirmDialog({
      title: '删除虚拟文件夹',
      message: `确认删除虚拟文件夹 "${folder.name}"？其中的 PDF 会移到根列表。`,
      confirmText: '删除',
      cancelText: '取消',
      onConfirm: () => {
        setConfirmDialog(null)

        // 前端乐观更新：移除该虚拟文件夹，并把其中的 PDF 移到根列表
        setPdfFolders((prevFolders) => {
          const nextFolders = prevFolders.filter((f) => f.id !== folderId)

          void (async () => {
            try {
              await savePdfFolders(nextFolders)
            } catch (e) {
              console.error('[usePdfPanel] handleDeletePdfFolder.savePdfFolders failed', e)
              setStatusMessage((e as any)?.message ?? '删除虚拟文件夹失败')
            }
          })()

          return nextFolders
        })

        setCollapsedPdfFolders((prev) => {
          const next = { ...prev }
          delete next[folderId]
          return next
        })

        setPdfRecent((prevItems) => {
          const itemsToUpdate = prevItems.filter((item) => item.folderId === folderId)
          const nextItems = prevItems.map((item) => (
            item.folderId === folderId ? { ...item, folderId: undefined } : item
          ))

          void (async () => {
            try {
              for (const item of itemsToUpdate) {
                await updatePdfRecentFolder(item.path, null)
              }
            } catch (e) {
              console.error('[usePdfPanel] handleDeletePdfFolder.updatePdfRecentFolder failed', e)
              setStatusMessage((e as any)?.message ?? '删除虚拟文件夹失败')
            }
          })()

          return nextItems
        })
      },
    })
  }, [isTauriEnv, setConfirmDialog, setStatusMessage])

  const movePdfToFolder = useCallback((path: string, folderId: string | null) => {
    if (!isTauriEnv()) {
      setStatusMessage('虚拟文件夹仅在桌面应用中可用')
      return
    }

    // 前端乐观更新：先立即更新本地状态，让 UI 立刻反映移动结果
    setPdfRecent((prev) => prev.map((item) => (
      item.path === path
        ? { ...item, folderId: folderId ?? undefined }
        : item
    )))

    void (async () => {
      try {
        await updatePdfRecentFolder(path, folderId)
      } catch (e) {
        console.error('[usePdfPanel] movePdfToFolder failed', e)
        setStatusMessage((e as any)?.message ?? '更新 PDF 虚拟文件夹失败')
      }
    })()
  }, [isTauriEnv, setStatusMessage])

  const handleRemovePdfFromRecent = useCallback((targetPath: string) => {
    void (async () => {
      const resp = await deleteRecentRemote(targetPath)
      if (!resp.ok) {
        setStatusMessage(resp.error.message)
      } else {
        try {
          await deletePdfRecent(targetPath)
        } catch (err) {
          console.warn('[usePdfPanel] deletePdfRecent failed', err)
        }
        await refreshPdfRecent()
      }
    })()
  }, [setStatusMessage, refreshPdfRecent])

  return {
    pdfRecent,
    pdfFolders,
    collapsedPdfFolders,
    pdfRecentLoading,
    pdfRecentError,
    pdfNotes,
    setPdfNotes,
    pdfMenuState,
    setPdfMenuState,
    pdfFolderMenuState,
    setPdfFolderMenuState,
    creatingPdfFolder,
    creatingPdfFolderName,
    renamingPdfFolderId,
    renamingPdfFolderName,
    closePdfMenu,
    closePdfFolderMenu,
    togglePdfFolderCollapse,
    refreshPdfRecent,
    handleCreatePdfFolder,
    handlePdfFolderInlineNameChange,
    handlePdfFolderInlineCancel,
    handlePdfFolderInlineConfirm,
    startPdfFolderRename,
    handlePdfFolderRenameChange,
    handlePdfFolderRenameCancel,
    handlePdfFolderRenameConfirm,
    handleDeletePdfFolder,
    movePdfToFolder,
    handleRemovePdfFromRecent,
  }
}
