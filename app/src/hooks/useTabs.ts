import { useCallback, useMemo, useRef, useState } from 'react'
import type { EditorTab } from '../types/tabs'

export type UseTabsOptions = {
  onRequestCloseCurrentTab?: () => void
}

const DEFAULT_UNTITLED = '未命名.md'

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
  console.log('[useTabs] hook 已初始化')
  const idRef = useRef(1)
  const [tabs, setTabs] = useState<EditorTab[]>(() => {
    const firstId = String(1)
    return [createEmptyTab(firstId)]
  })
  const [activeId, setActiveId] = useState<string | null>(() => '1')

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
        console.log('[createTab] 添加标签前:', prev.map(t => ({ id: t.id, title: t.title })))
        const newTabs = [...prev, tab]
        console.log('[createTab] 添加标签后:', newTabs.map(t => ({ id: t.id, title: t.title })))
        return newTabs
      })
      setActiveId(nextId)
      console.log('[createTab] 设置 activeId 为:', nextId)
      return tab
    },
    [],
  )

  const setActiveTab = useCallback((id: string) => {
    setActiveId(id)
  }, [])

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        if (prev.length === 1) {
          // 最后一个标签：清空内容而不是删除，保持有一个空标签
          const only = prev[0]
          return [
            {
              ...only,
              content: '',
              dirty: false,
              path: DEFAULT_UNTITLED,
              title: DEFAULT_UNTITLED,
            },
          ]
        }

        const next = prev.filter((t) => t.id !== id)
        // 更新当前激活标签
        if (id === activeId) {
          const closedIndex = prev.findIndex((t) => t.id === id)
          const fallback = next[Math.max(0, closedIndex - 1)] ?? next[0]
          setActiveId(fallback.id)
        }
        return next
      })
    },
    [activeId],
  )

  const updateActiveContent = useCallback(
    (content: string) => {
      if (!activeId) return
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeId
            ? {
                ...t,
                content,
                dirty: true,
              }
            : t,
        ),
      )
    },
    [activeId],
  )

  const updateActiveMeta = useCallback(
    (path: string, dirty: boolean) => {
      if (!activeId) return
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeId
            ? {
                ...t,
                path,
                title: deriveTitleFromPath(path),
                dirty,
              }
            : t,
        ),
      )
    },
    [activeId],
  )

  const closeCurrentTab = useCallback(
    () => {
      console.log('[closeCurrentTab] 被调用')
      if (!activeId) {
        console.warn('[closeCurrentTab] 没有激活标签，跳过')
        return
      }

      const tab = tabs.find(t => t.id === activeId)
      if (!tab) {
        console.warn('[closeCurrentTab] 未找到当前标签，跳过', { activeId, tabs: tabs.map(t => t.id) })
        return
      }

      console.log('[closeCurrentTab] 当前标签状态', { tabId: tab.id, title: tab.title, dirty: tab.dirty })

      // 如果提供了 UI 层的确认回调，优先使用（与 TabBar 保持一致）
      if (options?.onRequestCloseCurrentTab) {
        console.log('[closeCurrentTab] 使用 App 层的确认对话框')
        options.onRequestCloseCurrentTab()
        return
      }

      // 回退实现：如果有未保存变更，使用浏览器确认对话框
      if (tab.dirty) {
        console.log('[closeCurrentTab] 准备弹出确认对话框...')
        const shouldClose = window.confirm(
          `标签 "${tab.title}" 有未保存的更改。关闭将丢弃所有更改，是否继续？`
        )
        console.log('[closeCurrentTab] 用户选择:', { shouldClose })
        if (!shouldClose) {
          console.log('[closeCurrentTab] 用户取消关闭')
          return
        }
      }

      console.log('[closeCurrentTab] 关闭当前标签', { tabId: tab.id, title: tab.title })
      // 复用现有的 closeTab 逻辑
      closeTab(activeId)
    },
    [activeId, tabs, closeTab, options?.onRequestCloseCurrentTab],
  )

  const getUnsavedTabs = useCallback(() => {
    return tabs.filter(t => t.dirty)
  }, [tabs])

  return {
    tabs,
    activeId,
    activeTab,
    createTab,
    setActiveTab,
    closeTab,
    closeCurrentTab,
    getUnsavedTabs,
    updateActiveContent,
    updateActiveMeta,
  }
}
