import { useCallback, useEffect, useRef, useState } from 'react'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { clearRecentRemote, deleteRecentRemote, listRecentPage, logRecentFile, readFile, writeFile } from '../modules/files/service'
import { createAutoSaver, type AutoSaveHandle } from '../modules/files/autoSave'
import type { RecentFile, Result, ServiceError, WriteResult } from '../modules/files/types'

const DEFAULT_PATH = '未命名.md'
const STORAGE_RECENT_HOT = 'haomd:recent:hot'
const RECENT_PAGE_SIZE = 10

const isTauri = () =>
  typeof window !== 'undefined' &&
  (Boolean((window as any).__TAURI_INTERNALS__) || Boolean((window as any).__TAURI__))

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict'

export function useFilePersistence(markdown: string) {
  const [filePath, setFilePath] = useState<string>(DEFAULT_PATH)
  const pathRef = useRef<string>(DEFAULT_PATH)
  const [dirty, setDirty] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const [currentHash, setCurrentHash] = useState<string | undefined>(undefined)
  const [currentMtime, setCurrentMtime] = useState<number | undefined>(undefined)
  const [conflictError, setConflictError] = useState<ServiceError | null>(null)

  const [recent, setRecent] = useState<RecentFile[]>([])
  const [recentHasMore, setRecentHasMore] = useState(false)
  const [recentLoading, setRecentLoading] = useState(false)
  const [recentLoadedFromDisk, setRecentLoadedFromDisk] = useState(false)

  const saverRef = useRef<AutoSaveHandle | null>(null)

  const formatTitle = useCallback((path: string, isDirty: boolean) => {
    const name = path.split('/').pop() || path || DEFAULT_PATH
    const prefix = isDirty ? '*' : ''
    return `${prefix}${name}`
  }, [])

  const updateTitle = useCallback(
    async (path: string, isDirty: boolean) => {
      if (!isTauri()) return
      try {
        await invoke('set_title', { title: formatTitle(path, isDirty) })
      } catch (err) {
        console.warn('set_title failed', err)
      }
    },
    [formatTitle],
  )

  const saveInFlightRef = useRef(false)

  useEffect(() => {
    pathRef.current = filePath
  }, [filePath])

  const handleSave = useCallback(
    async (targetPath?: string): Promise<Result<WriteResult>> => {
      if (saveInFlightRef.current) {
        return { ok: false, error: { code: 'CANCELLED', message: '保存进行中，请稍后重试', traceId: undefined } }
      }
      saveInFlightRef.current = true
      try {
        const pathToUse = targetPath ?? pathRef.current
        const resp = await writeFile({
          path: pathToUse,
          content: markdown,
          expectedHash: currentHash,
          expectedMtime: currentMtime,
        })
        if (resp.ok) {
          // 先更新 ref，避免紧接着触发的下一次保存仍判断为“未命名”
          pathRef.current = pathToUse
          setFilePath(pathToUse)
          setDirty(false)
          setSaveStatus('saved')
          setStatusMessage('已保存')
          setCurrentHash(resp.data.hash)
          setCurrentMtime(resp.data.mtimeMs)
          setLastSavedAt(Date.now())
          void updateTitle(pathToUse, false)
        }
        return resp
      } finally {
        saveInFlightRef.current = false
      }
    },
    [markdown, currentHash, currentMtime, updateTitle],
  )

  const readRecentHotFromStorage = useCallback((): RecentFile[] => {
    if (typeof window === 'undefined') return []
    try {
      const raw = window.localStorage.getItem(STORAGE_RECENT_HOT)
      if (!raw) return []
      const parsed = JSON.parse(raw) as unknown
      return Array.isArray(parsed) ? (parsed as RecentFile[]) : []
    } catch {
      return []
    }
  }, [])

  const fetchRecent = useCallback(
    async (reset: boolean) => {
      setRecentLoading(true)
      try {
        const offset = reset ? 0 : recent.length
        const resp = await listRecentPage(offset, RECENT_PAGE_SIZE)
        if (!resp.ok) {
          setStatusMessage(resp.error.message)
          return
        }
        const items = resp.data

        setRecent((prev) => {
          const base = reset ? [] : prev
          const nextAll = [...base, ...items]

          // 更新 localStorage 中的前 10 条热缓存
          if (typeof window !== 'undefined') {
            try {
              const hot = nextAll.slice(0, RECENT_PAGE_SIZE)
              window.localStorage.setItem(STORAGE_RECENT_HOT, JSON.stringify(hot))
            } catch {
              // ignore
            }
          }

        return nextAll
        })

        setRecentHasMore(items.length === RECENT_PAGE_SIZE)
        setRecentLoadedFromDisk(true)
      } finally {
        setRecentLoading(false)
      }
    },
    [listRecentPage, recent.length, setStatusMessage],
  )

  const refreshRecent = useCallback(async () => {
    await fetchRecent(true)
  }, [fetchRecent])

  const loadMoreRecent = useCallback(async () => {
    await fetchRecent(false)
  }, [fetchRecent])

  const clearRecentAll = useCallback(async () => {
    const resp = await clearRecentRemote()
    if (!resp.ok) {
      setStatusMessage(resp.error.message)
      return resp
    }
    setRecent([])
    setRecentHasMore(false)
    setRecentLoadedFromDisk(true)
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(STORAGE_RECENT_HOT)
      } catch {
        // ignore
      }
    }
    return resp
  }, [setStatusMessage])

  const deleteRecent = useCallback(
    async (path: string) => {
      const resp = await deleteRecentRemote(path)
      if (!resp.ok) {
        setStatusMessage(resp.error.message)
        return resp
      }
      setRecent((prev) => {
        const next = prev.filter((item) => item.path !== path)
        if (typeof window !== 'undefined') {
          try {
            const hot = next.slice(0, RECENT_PAGE_SIZE)
            window.localStorage.setItem(STORAGE_RECENT_HOT, JSON.stringify(hot))
          } catch {
            // ignore
          }
        }
        return next
      })
      return resp
    },
    [setStatusMessage],
  )

  const upsertRecentLocal = useCallback(
    (path: string, isFolder: boolean) => {
      const displayName = path.split('/').pop() || path
      const now = Date.now()

      setRecent((prev) => {
        const without = prev.filter((item) => item.path !== path)
        const nextAll: RecentFile[] = [
          { path, displayName, lastOpenedAt: now, isFolder },
          ...without,
        ]
        const hot = nextAll.slice(0, RECENT_PAGE_SIZE)

        if (typeof window !== 'undefined') {
          try {
            window.localStorage.setItem(STORAGE_RECENT_HOT, JSON.stringify(hot))
          } catch {
            // ignore
          }
        }

        return hot
      })
    },
    [setRecent],
  )

  const dialogInFlightRef = useRef(false)
  const openDialogInFlightRef = useRef(false)
  const openInFlightRef = useRef(false)
  const suppressDirtyOnceRef = useRef(false)

  const hasRealPathNow = useCallback(() => pathRef.current !== DEFAULT_PATH, [])

  const saveAs = useCallback(async () => {
    // 防止重复触发导致系统对话框弹多次
    if (dialogInFlightRef.current) {
      return { ok: false as const, error: { code: 'CANCELLED', message: '已在打开保存对话框', traceId: undefined } }
    }
    dialogInFlightRef.current = true

    try {
      if (!isTauri()) {
        setSaveStatus('error')
        setStatusMessage('需在 Tauri 应用中才能弹出系统保存对话框')
        return { ok: false as const, error: { code: 'UNKNOWN', message: 'Tauri 未运行', traceId: undefined } }
      }

      setSaveStatus('saving')
      setStatusMessage('选择存储位置...')
      const suggested = pathRef.current && pathRef.current !== DEFAULT_PATH ? pathRef.current : '文稿.md'
      const chosen = await saveDialog({
        defaultPath: suggested,
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdx'] }],
      })
      if (!chosen) {
        setSaveStatus('idle')
        setStatusMessage('已取消保存')
        return { ok: false as const, error: { code: 'CANCELLED', message: '用户取消', traceId: undefined } }
      }
      setSaveStatus('saving')
      setStatusMessage('保存中...')
      const resp = await handleSave(chosen)
      if (resp.ok) {
        // 已保存
      } else if (resp.error.code === 'CONFLICT') {
        setConflictError(resp.error)
        setSaveStatus('conflict')
      } else {
        setSaveStatus('error')
        setStatusMessage(resp.error.message)
      }
      return resp
    } finally {
      dialogInFlightRef.current = false
    }
  }, [filePath, handleSave])

  const saveToPath = useCallback(async () => {
    if (!hasRealPathNow()) {
      return {
        ok: false as const,
        error: { code: 'INVALID_PATH', message: '未命名文件需先选择保存位置', traceId: undefined },
      }
    }

    setSaveStatus('saving')
    setStatusMessage('保存中...')
    const resp = await handleSave()
    if (resp.ok) {
      // 已保存
    } else if (resp.error.code === 'CONFLICT') {
      setConflictError(resp.error)
      setSaveStatus('conflict')
    } else {
      setSaveStatus('error')
      setStatusMessage(resp.error.message)
    }
    return resp
  }, [handleSave, hasRealPathNow])

  const save = useCallback(async () => {
    // 关键：这里不要依赖渲染期的 memo/state，直接读 ref，避免“刚保存完又触发保存”时判断失真
    if (hasRealPathNow()) return await saveToPath()
    return await saveAs()
  }, [hasRealPathNow, saveAs, saveToPath])

  useEffect(() => {
    saverRef.current?.cancel()
    saverRef.current = createAutoSaver({
      save: () => handleSave(),
      isDirty: () => dirty,
      enabled: filePath !== DEFAULT_PATH,
      debounceMs: 120000,
      idleMs: 120000,
      onStart: () => {
        setSaveStatus('saving')
        setStatusMessage('自动保存中...')
      },
      onSuccess: (res) => {
        setDirty(false)
        setSaveStatus('saved')
        setStatusMessage('自动保存完成')
        setCurrentHash(res.hash)
        setCurrentMtime(res.mtimeMs)
        setLastSavedAt(Date.now())
      },
      onConflict: (error) => {
        setSaveStatus('conflict')
        setConflictError(error)
        setStatusMessage(error.message)
      },
      onError: (error) => {
        setSaveStatus('error')
        setStatusMessage(error.message)
      },
    })
    return () => {
      saverRef.current?.cancel()
    }
  }, [dirty, handleSave, filePath])

  useEffect(() => {
    if (suppressDirtyOnceRef.current) {
      suppressDirtyOnceRef.current = false
      setDirty(false)
      return
    }
    setDirty(true)
    saverRef.current?.schedule()
  }, [markdown])

  useEffect(() => {
    void updateTitle(filePath, dirty)
  }, [filePath, dirty, updateTitle])

  useEffect(() => {
    const hot = readRecentHotFromStorage()
    if (hot.length > 0) {
      setRecent(hot)
    }
  }, [readRecentHotFromStorage])

  const markDirty = useCallback(() => {
    setDirty(true)
    saverRef.current?.schedule()
  }, [])

  const openFromPath = useCallback(
    async (path: string) => {
      if (openInFlightRef.current) {
        return { ok: false as const, error: { code: 'CANCELLED', message: '打开进行中，请稍后重试', traceId: undefined } }
      }
      openInFlightRef.current = true
      try {
        if (!isTauri()) {
          setSaveStatus('error')
          setStatusMessage('需在 Tauri 应用中才能打开文件')
          return { ok: false as const, error: { code: 'UNKNOWN', message: 'Tauri 未运行', traceId: undefined } }
        }

        setSaveStatus('idle')
        setStatusMessage('打开中...')
        const resp = await readFile(path)
        if (!resp.ok) {
          setSaveStatus('error')
          setStatusMessage(resp.error.message)
          return resp
        }

        const nextPath = resp.data.path
        pathRef.current = nextPath
        setFilePath(nextPath)
        setCurrentHash(resp.data.hash)
        setCurrentMtime(resp.data.mtimeMs)
        setDirty(false)
        suppressDirtyOnceRef.current = true
        setSaveStatus('idle')
        setStatusMessage('已打开')
        void updateTitle(nextPath, false)

        // 记录最近文件：后端维护完整持久化，本地维护最近 10 条热缓存
        void logRecentFile(nextPath, false)
        upsertRecentLocal(nextPath, false)

        return resp
      } finally {
        openInFlightRef.current = false
      }
    },
    [updateTitle, upsertRecentLocal],
  )

  const openFile = useCallback(
    async () => {
      console.log('[openFile] called, inFlight =', openDialogInFlightRef.current)
      if (openDialogInFlightRef.current) {
        console.warn('[openFile] dialog already in flight, skip')
        return { ok: false as const, error: { code: 'CANCELLED', message: '已在打开系统对话框', traceId: undefined } }
      }
      openDialogInFlightRef.current = true
      try {
        setSaveStatus('idle')
        setStatusMessage('选择要打开的文件...')
        console.log('[openFile] before openDialog')
        const chosen = await openDialog({
          multiple: false,
          directory: false,
          filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdx'] }],
        })
        console.log('[openFile] after openDialog, chosen =', chosen)

        if (!chosen) {
          setSaveStatus('idle')
          setStatusMessage('已取消打开')
          return { ok: false as const, error: { code: 'CANCELLED', message: '用户取消', traceId: undefined } }
        }

        const path = Array.isArray(chosen) ? chosen[0] : chosen
        console.log('[openFile] openFromPath', path)
        return await openFromPath(path)
      } catch (err) {
        console.error('[openFile] openDialog failed', err)
        setSaveStatus('error')
        setStatusMessage(`无法打开文件: ${String((err as any)?.message ?? err)}`)
        return { ok: false as const, error: { code: 'UNKNOWN', message: '打开失败', traceId: undefined } }
      } finally {
        openDialogInFlightRef.current = false
        console.log('[openFile] dialog done, reset inFlight')
      }
    },
    [openFromPath],
  )

  const confirmLoseChanges = useCallback(() => {
    if (!dirty) return true
    return window.confirm('存在未保存变更，确认继续？')
  }, [dirty])

  const newDocument = useCallback(() => {
    // 先重置文件元信息，避免后续保存/自动保存误判成“已有路径/可对比”
    pathRef.current = DEFAULT_PATH
    setFilePath(DEFAULT_PATH)
    setCurrentHash(undefined)
    setCurrentMtime(undefined)
    setLastSavedAt(null)
    setDirty(false)
    suppressDirtyOnceRef.current = true
    setSaveStatus('idle')
    setConflictError(null)
    setStatusMessage('新建文档')
    void updateTitle(DEFAULT_PATH, false)
  }, [updateTitle])

  return {
    DEFAULT_PATH,
    filePath,
    setFilePath,
    dirty,
    setDirty,
    saveStatus,
    statusMessage,
    setStatusMessage,
    lastSavedAt,
    currentHash,
    currentMtime,
    conflictError,
    setConflictError,
    recent,
    recentHasMore,
    recentLoading,
    recentLoadedFromDisk,
    refreshRecent,
    loadMoreRecent,
    clearRecentAll,
    deleteRecent,
    setRecent,
    handleSave,
    save,
    saveToPath,
    saveAs,
    openFile,
    openFromPath,
    markDirty,
    confirmLoseChanges,
    newDocument,
  }
}
