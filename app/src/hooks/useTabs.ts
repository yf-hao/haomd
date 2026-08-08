import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { UNTITLED_FILE_PATH } from '../modules/files/filePathState'
import type { EditorTab } from '../types/tabs'

export type UseTabsOptions = {
  onRequestCloseCurrentTab?: () => void
  onBeforeActiveTabChange?: (nextTabId: string) => void
}

const DEFAULT_UNTITLED = UNTITLED_FILE_PATH

function deriveTitleFromPath(path: string): string {
  if (!path) return DEFAULT_UNTITLED
  const parts = path.split(/[/\\]/)
  const last = parts[parts.length - 1]
  return last || path || DEFAULT_UNTITLED
}

function createEmptyTab(id: string): EditorTab {
  return {
    id,
    title: DEFAULT_UNTITLED,
    path: DEFAULT_UNTITLED,
    content: '',
    dirty: false,
  }
}

export function useTabs(options?: UseTabsOptions) {
  // if (import.meta.env.DEV) {
  //   console.log('[useTabs] hook 已初始化')
  // }
  const idRef = useRef(1)
  const [tabs, setTabs] = useState<EditorTab[]>(() => {
    // 初始不创建标签，返回空数组
    return []
  })
  const [activeId, setActiveId] = useState<string | null>(() => null)
  const onBeforeActiveTabChange = options?.onBeforeActiveTabChange
  const onBeforeActiveTabChangeRef = useRef(onBeforeActiveTabChange)
  useEffect(() => {
    onBeforeActiveTabChangeRef.current = onBeforeActiveTabChange
  }, [onBeforeActiveTabChange])

  const activateTab = useCallback((id: string) => {
    onBeforeActiveTabChangeRef.current?.(id)
    setActiveId(id)
  }, [])

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeId) ?? null,
    [tabs, activeId],
  )

  const createTab = useCallback(
    (opts?: { title?: string; path?: string; content?: string }) => {
      const nextId = String(++idRef.current)
      const base = createEmptyTab(nextId)
      const path = opts?.path ?? base.path
      const tab: EditorTab = {
        ...base,
        ...opts,
        path,
        title: opts?.title ?? (path ? deriveTitleFromPath(path) : base.title),
        content: opts?.content ?? base.content,
      }
      setTabs((prev) => {
        if (import.meta.env.DEV) {
          console.log('[createTab] 添加标签前:', prev.map(t => ({ id: t.id, title: t.title })))
        }
        const newTabs = [...prev, tab]
        if (import.meta.env.DEV) {
          console.log('[createTab] 添加标签后:', newTabs.map(t => ({ id: t.id, title: t.title })))
        }
        return newTabs
      })
      activateTab(nextId)
      if (import.meta.env.DEV) {
        console.log('[createTab] 设置 activeId 为:', nextId)
      }
      return tab
    },
    [activateTab],
  )

  const setActiveTab = useCallback((id: string) => {
    activateTab(id)
  }, [activateTab])

  const closeTab = useCallback(
    (id: string) => {
      const closedIndex = tabs.findIndex((tab) => tab.id === id)
      if (closedIndex < 0) return

      const next = tabs.filter((tab) => tab.id !== id)
      setTabs(next)

      if (id !== activeId) return

      // Prefer the previous tab. When closing the first tab, wrap to the
      // last remaining tab to keep tab navigation cyclic.
      const fallback = next[closedIndex - 1] ?? next[next.length - 1]
      if (fallback) {
        activateTab(fallback.id)
      } else {
        setActiveId(null)
      }
    },
    [activeId, activateTab, tabs],
  )

  const updateTabContent = useCallback(
    (id: string, content: string, options?: { markDirty?: boolean }) => {
      const shouldMarkDirty = options?.markDirty ?? true
      setTabs((prev) => {
        let changed = false
        const next = prev.map((t) => {
          if (t.id !== id) return t

          const nextDirty = shouldMarkDirty ? true : t.dirty
          if (t.content === content && t.dirty === nextDirty) {
            return t
          }

          changed = true
          return {
            ...t,
            content,
            dirty: nextDirty,
          }
        })
        return changed ? next : prev
      })
    },
    [],
  )

  const updateActiveContent = useCallback(
    (content: string, options?: { markDirty?: boolean }) => {
      if (!activeId) return
      updateTabContent(activeId, content, options)
    },
    [activeId, updateTabContent],
  )

  const updateActiveMeta = useCallback(
    (path: string, dirty: boolean) => {
      if (!activeId) return
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== activeId) return t
          const nextTitle = deriveTitleFromPath(path)
          if (import.meta.env.DEV) {
            console.log('[useTabs.updateActiveMeta]', {
              activeId,
              old: { path: t.path, title: t.title, dirty: t.dirty },
              next: { path, title: nextTitle, dirty },
            })
          }
          return {
            ...t,
            path,
            title: nextTitle,
            dirty,
          }
        }),
      )
    },
    [activeId],
  )

  const updateTabsPathByPath = useCallback(
    (oldPath: string, newPath: string) => {
      if (!oldPath || !newPath) return
      setTabs((prev) =>
        prev.map((t) => {
          if (t.path !== oldPath) return t
          const nextTitle = deriveTitleFromPath(newPath)
          if (import.meta.env.DEV) {
            console.log('[useTabs.updateTabsPathByPath]', {
              id: t.id,
              old: { path: t.path, title: t.title },
              next: { path: newPath, title: nextTitle },
            })
          }
          return {
            ...t,
            path: newPath,
            title: nextTitle,
          }
        }),
      )
    },
    [],
  )

  const closeCurrentTab = useCallback(
    () => {
      if (import.meta.env.DEV) {
        console.log('[closeCurrentTab] 被调用')
      }
      if (!activeId) {
        if (import.meta.env.DEV) {
          console.warn('[closeCurrentTab] 没有激活标签，跳过')
        }
        return
      }

      const tab = tabs.find(t => t.id === activeId)
      if (!tab) {
        if (import.meta.env.DEV) {
          console.warn('[closeCurrentTab] 未找到当前标签，跳过', { activeId, tabs: tabs.map(t => t.id) })
        }
        return
      }

      if (import.meta.env.DEV) {
        console.log('[closeCurrentTab] 当前标签状态', { tabId: tab.id, title: tab.title, dirty: tab.dirty })
      }

      // 如果提供了 UI 层的确认回调，优先使用（与 TabBar 保持一致）
      if (options?.onRequestCloseCurrentTab) {
        if (import.meta.env.DEV) {
          console.log('[closeCurrentTab] 使用 App 层的确认对话框')
        }
        options.onRequestCloseCurrentTab()
        return
      }

      // 回退实现：如果有未保存变更，使用浏览器确认对话框
      if (tab.dirty) {
        if (import.meta.env.DEV) {
          console.log('[closeCurrentTab] 准备弹出确认对话框...')
        }
        const shouldClose = window.confirm(
          `标签 "${tab.title}" 有未保存的更改。关闭将丢弃所有更改，是否继续？`
        )
        if (import.meta.env.DEV) {
          console.log('[closeCurrentTab] 用户选择:', { shouldClose })
        }
        if (!shouldClose) {
          if (import.meta.env.DEV) {
            console.log('[closeCurrentTab] 用户取消关闭')
          }
          return
        }
      }

      if (import.meta.env.DEV) {
        console.log('[closeCurrentTab] 关闭当前标签', { tabId: tab.id, title: tab.title })
      }
      // 复用现有的 closeTab 逻辑
      closeTab(activeId)
    },
    [activeId, tabs, closeTab, options?.onRequestCloseCurrentTab],
  )

  const getUnsavedTabs = useCallback(() => {
    return tabs.filter(t => t.dirty)
  }, [tabs])

  const markActiveTabDirty = useCallback(() => {
    if (!activeId) return
    setTabs(prev => {
      let changed = false
      const next = prev.map(t => {
        if (t.id !== activeId || t.dirty) return t
        changed = true
        return { ...t, dirty: true }
      })
      return changed ? next : prev
    })
  }, [activeId])

  return {
    tabs,
    activeId,
    activeTab,
    createTab,
    setActiveTab,
    closeTab,
    closeCurrentTab,
    getUnsavedTabs,
    updateTabContent,
    updateActiveContent,
    updateActiveMeta,
    updateTabsPathByPath,
    markActiveTabDirty,
  }
}
