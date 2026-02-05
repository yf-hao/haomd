import { useCallback, useMemo, useRef, useState } from 'react'
import type { EditorTab } from '../types/tabs'

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

export function useTabs() {
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

  return {
    tabs,
    activeId,
    activeTab,
    createTab,
    setActiveTab,
    closeTab,
    updateActiveContent,
    updateActiveMeta,
  }
}
