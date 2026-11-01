import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { EditorTab } from '../types/tabs'

import './TabBar.css'

export type TabBarProps = {
  tabs: EditorTab[]
  activeId: string | null
  onTabClick: (id: string) => void
  onTabClose: (id: string) => void
  onCloseTabs?: (ids: string[]) => void
  onRequestSaveAndClose?: (id: string) => void
}

const OVERFLOW_BUTTON_WIDTH = 36
const TAB_TITLE_MAX_WIDTH = 160
const TAB_HORIZONTAL_PADDING = 20
const TAB_CONTENT_GAP = 6

function measureTabWidths(
  root: HTMLDivElement,
  tabs: EditorTab[],
  previous: Map<string, { title: string; dirty: boolean; width: number; font: string; closeWidth: number }>,
): { widths: Record<string, number>; cache: Map<string, { title: string; dirty: boolean; width: number; font: string; closeWidth: number }> } {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) {
    const fallbackWidth = root.querySelector<HTMLElement>('.tab-item')?.getBoundingClientRect().width ?? 0
    const widths: Record<string, number> = {}
    const cache = new Map<string, { title: string; dirty: boolean; width: number; font: string; closeWidth: number }>()
    for (const tab of tabs) {
      const width = Math.ceil(fallbackWidth || Math.min(TAB_TITLE_MAX_WIDTH, tab.title.length * 8) + TAB_CONTENT_GAP + TAB_HORIZONTAL_PADDING + 11)
      widths[tab.id] = width
      cache.set(tab.id, { title: tab.title, dirty: tab.dirty, width, font: 'fallback', closeWidth: 11 })
    }
    return { widths, cache }
  }

  const sampleTitle = root.querySelector<HTMLElement>('.tab-title-text')
  const fontStyle = sampleTitle ? getComputedStyle(sampleTitle) : getComputedStyle(root)
  context.font = fontStyle.font || `${fontStyle.fontSize} ${fontStyle.fontFamily}`
  const font = context.font
  const closeButton = root.querySelector<HTMLElement>('.tab-close')
  const closeWidth = closeButton ? Math.ceil(closeButton.getBoundingClientRect().width) : 11

  const widths: Record<string, number> = {}
  const cache = new Map<string, { title: string; dirty: boolean; width: number; font: string; closeWidth: number }>()
  for (const tab of tabs) {
    const cached = previous.get(tab.id)
    const width = cached?.title === tab.title && cached.dirty === tab.dirty && cached.font === font && cached.closeWidth === closeWidth
      ? cached.width
      : Math.ceil(
        Math.min(TAB_TITLE_MAX_WIDTH, context.measureText(tab.title).width + (tab.dirty ? 14 : 0)) +
        TAB_CONTENT_GAP + TAB_HORIZONTAL_PADDING + closeWidth,
      )
    widths[tab.id] = width
    cache.set(tab.id, { title: tab.title, dirty: tab.dirty, width, font, closeWidth })
  }
  return { widths, cache }
}

export const TabBar = memo(function TabBar({ tabs, activeId, onTabClick, onTabClose, onCloseTabs, onRequestSaveAndClose }: TabBarProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const tabWidthCacheRef = useRef(new Map<string, { title: string; dirty: boolean; width: number; font: string; closeWidth: number }>())
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [containerWidth, setContainerWidth] = useState(0)
  const [tabWidths, setTabWidths] = useState<Record<string, number>>({})
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tabId: string } | null>(null)

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const measured = measureTabWidths(root, tabs, tabWidthCacheRef.current)
    tabWidthCacheRef.current = measured.cache
    const nextWidths = measured.widths
    setTabWidths((prev) => {
      const prevKeys = Object.keys(prev)
      const nextKeys = Object.keys(nextWidths)
      if (prevKeys.length === nextKeys.length && nextKeys.every((key) => prev[key] === nextWidths[key])) {
        return prev
      }
      return nextWidths
    })
  }, [tabs])

  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return

    const updateWidth = () => {
      const nextWidth = Math.floor(el.getBoundingClientRect().width)
      setContainerWidth((prev) => (prev === nextWidth ? prev : nextWidth))
    }

    updateWidth()

    const observer = new ResizeObserver(updateWidth)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!menuOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (menuRef.current?.contains(target)) return
      if (rootRef.current?.contains(target)) return
      setMenuOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])

  useEffect(() => {
    setMenuOpen(false)
  }, [tabs, activeId])

  useEffect(() => {
    if (!contextMenu) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [contextMenu])

  const { visibleTabs, hiddenTabs } = useMemo(() => {
    if (tabs.length === 0) {
      return { visibleTabs: [] as typeof tabs, hiddenTabs: [] as typeof tabs }
    }

    const widths = tabs.map((tab) => tabWidths[tab.id] ?? 0)
    if (widths.some((width) => width <= 0) || containerWidth <= 0) {
      return { visibleTabs: tabs, hiddenTabs: [] as typeof tabs }
    }

    const fullWidth = widths.reduce((sum, width) => sum + width, 0)
    if (fullWidth <= containerWidth) {
      return { visibleTabs: tabs, hiddenTabs: [] as typeof tabs }
    }

    const availableWidth = Math.max(0, containerWidth - OVERFLOW_BUTTON_WIDTH)
    const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.id === activeId))

    let startIndex = 0
    let usedWidth = 0
    for (let index = activeIndex; index >= 0; index -= 1) {
      const nextWidth = widths[index]
      if (usedWidth + nextWidth > availableWidth) {
        break
      }
      usedWidth += nextWidth
      startIndex = index
    }

    let endIndex = activeIndex
    for (let index = activeIndex + 1; index < tabs.length; index += 1) {
      const nextWidth = widths[index]
      if (usedWidth + nextWidth > availableWidth) {
        break
      }
      usedWidth += nextWidth
      endIndex = index
    }

    if (usedWidth === 0) {
      return { visibleTabs: [tabs[activeIndex]], hiddenTabs: tabs.filter((tab) => tab.id !== tabs[activeIndex]?.id) }
    }

    const visible = tabs.slice(startIndex, endIndex + 1)
    const hidden = tabs.filter((_, index) => index < startIndex || index > endIndex)
    return { visibleTabs: visible, hiddenTabs: hidden }
  }, [activeId, containerWidth, tabWidths, tabs])

  const renderTab = (tab: EditorTab) => (
    <div
      key={tab.id}
      className={`tab-item ${tab.id === activeId ? 'active' : ''}`}
      onClick={() => onTabClick(tab.id)}
      onMouseDown={(event) => {
        if (event.button === 2) event.preventDefault()
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        const width = 196
        const height = 84
        setContextMenu({
          x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
          y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
          tabId: tab.id,
        })
      }}
    >
      <span className="tab-title">
        {tab.dirty && <span className="tab-dirty-dot" />}
        <span className="tab-title-text">{tab.title}</span>
      </span>
      <button
        type="button"
        className="tab-close"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()

          if (tab.dirty && onRequestSaveAndClose) {
            onRequestSaveAndClose(tab.id)
            return
          }

          if (tab.dirty && !onRequestSaveAndClose) {
            const shouldClose = window.confirm('This tab has unsaved changes. Closing may discard your edits. Continue?')
            if (!shouldClose) return
          }

          onTabClose(tab.id)
        }}
      >
        ×
      </button>
    </div>
  )

  return (
    <div className="tab-bar" ref={rootRef}>
      {contextMenu && (
        <div className="tab-context-backdrop" onMouseDown={() => setContextMenu(null)} onContextMenu={(event) => event.preventDefault()}>
          <div className="tab-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} role="menu" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" role="menuitem" onClick={() => {
              onCloseTabs?.(tabs.filter((tab) => tab.id !== contextMenu.tabId).map((tab) => tab.id))
              setContextMenu(null)
            }}>关闭其它标签页</button>
            <button type="button" role="menuitem" onClick={() => {
              onCloseTabs?.(tabs.map((tab) => tab.id))
              setContextMenu(null)
            }}>关闭所有标签页</button>
          </div>
        </div>
      )}
      <div className="tab-bar-list">
        {visibleTabs.map(renderTab)}
      </div>
      {hiddenTabs.length > 0 && (
        <div className="tab-overflow" ref={menuRef}>
          <button
            type="button"
            className="tab-overflow-button"
            aria-label="Show hidden tabs"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((prev) => !prev)}
          >
            +{hiddenTabs.length}
          </button>
          {menuOpen && (
            <div className="tab-overflow-menu">
              {hiddenTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`tab-overflow-item ${tab.id === activeId ? 'active' : ''}`}
                  onClick={() => {
                    onTabClick(tab.id)
                    setMenuOpen(false)
                  }}
                >
                  <span className="tab-overflow-title">
                    {tab.dirty && <span className="tab-dirty-dot" />}
                    <span className="tab-title-text">{tab.title}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
})
