import { useCallback, useEffect, useRef, useState } from 'react'

// 仅当光标行变化达到该阈值时才更新记忆，避免小幅抖动频繁写入
const CURSOR_UPDATE_MIN_DELTA = 5

const STORAGE_CURSOR_MAP = 'haomd:editor:lastCursor:v1'

type LastCursorLocation = {
  line: number
  updatedAt: number
}

type CursorMap = Record<string, LastCursorLocation>

const normalizeCursorPath = (p: string | null | undefined): string | null => {
  if (!p) return null
  return p.replace(/\\/g, '/')
}

export interface UseCursorMemoryParams {
  activeId: string | null
  tabs: Array<{ id: string; path?: string | null }>
  isPdfActive: boolean
  getCurrentFilePath: () => string | null
  focusEditorOnGlobalLine: (line: number) => void
}

export interface UseCursorMemoryReturn {
  /** 记录光标位置（节流去抖后持久化到 localStorage） */
  saveCursorPosition: (globalLine: number) => void
  /** 恢复指定文件路径的光标位置 */
  restoreCursorForPath: (path: string | null) => void
  /** 编辑器初始化完成后的回调，自动恢复待恢复的光标 */
  handleEditorReady: () => void
  /** 标记某标签页需要在编辑器就绪后恢复光标 */
  markPendingRestore: (tabId: string) => void
}

export function useCursorMemory({
  activeId,
  tabs,
  isPdfActive,
  getCurrentFilePath,
  focusEditorOnGlobalLine,
}: UseCursorMemoryParams): UseCursorMemoryReturn {
  const [pendingCursorRestoreTabId, setPendingCursorRestoreTabId] = useState<string | null>(null)

  const [lastCursorMap, setLastCursorMap] = useState<CursorMap>(() => {
    try {
      if (typeof localStorage === 'undefined') return {}
      const raw = localStorage.getItem(STORAGE_CURSOR_MAP)
      if (!raw) return {}
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') return {}
      return parsed as CursorMap
    } catch (e) {
      console.error('Failed to load cursor map from localStorage', e)
      return {}
    }
  })
  const lastCursorMapRef = useRef<CursorMap>(lastCursorMap)
  useEffect(() => {
    lastCursorMapRef.current = lastCursorMap
  }, [lastCursorMap])

  const saveCursorMapTimeoutRef = useRef<number | null>(null)
  const scheduleSaveCursorMap = useCallback((next: CursorMap) => {
    try {
      if (typeof localStorage === 'undefined') return
      if (saveCursorMapTimeoutRef.current != null) {
        window.clearTimeout(saveCursorMapTimeoutRef.current)
      }
      saveCursorMapTimeoutRef.current = window.setTimeout(() => {
        try {
          localStorage.setItem(STORAGE_CURSOR_MAP, JSON.stringify(next))
        } catch (err) {
          console.error('Failed to save cursor map to localStorage', err)
        }
      }, 800)
    } catch (err) {
      console.error('scheduleSaveCursorMap failed', err)
    }
  }, [])

  const saveCursorPosition = useCallback((globalLine: number) => {
    // 仅在 Markdown 标签下持久化光标行（PDF 标签不记录）
    if (isPdfActive) return

    const path = getCurrentFilePath()
    const key = normalizeCursorPath(path)
    if (!key || !globalLine || globalLine < 1) return

    const prevSaved = lastCursorMapRef.current[key]
    if (prevSaved && Math.abs(globalLine - prevSaved.line) < CURSOR_UPDATE_MIN_DELTA) {
      return
    }

    setLastCursorMap((prev) => {
      const next: CursorMap = {
        ...prev,
        [key]: { line: globalLine, updatedAt: Date.now() },
      }
      lastCursorMapRef.current = next
      scheduleSaveCursorMap(next)
      return next
    })
  }, [isPdfActive, getCurrentFilePath, scheduleSaveCursorMap])

  const restoreCursorForPath = useCallback((path: string | null) => {
    if (!path || isPdfActive) return
    const key = normalizeCursorPath(path)
    if (!key) return
    const saved = lastCursorMapRef.current[key]
    const line = saved && saved.line > 0 ? saved.line : 1
    focusEditorOnGlobalLine(line)
  }, [isPdfActive, focusEditorOnGlobalLine])

  const handleEditorReady = useCallback(() => {
    // 编辑器初始化完成，如果当前标签页需要恢复光标，则进行恢复
    if (pendingCursorRestoreTabId && pendingCursorRestoreTabId === activeId) {
      const tab = tabs.find(t => t.id === activeId)
      if (tab?.path) {
        restoreCursorForPath(tab.path)
      }
      setPendingCursorRestoreTabId(null)
    }
  }, [pendingCursorRestoreTabId, activeId, tabs, restoreCursorForPath])

  const markPendingRestore = useCallback((tabId: string) => {
    setPendingCursorRestoreTabId(tabId)
  }, [])

  return {
    saveCursorPosition,
    restoreCursorForPath,
    handleEditorReady,
    markPendingRestore,
  }
}
