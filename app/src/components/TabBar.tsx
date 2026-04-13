import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { EditorTab } from '../types/tabs'

import './TabBar.css'

export type TabBarProps = {
  tabs: EditorTab[]
  activeId: string | null
  onTabClick: (id: string) => void
  onTabClose: (id: string) => void
  onRequestSaveAndClose?: (id: string) => void
}

const OVERFLOW_BUTTON_WIDTH = 36

export const TabBar = memo(function TabBar({ tabs, activeId, onTabClick, onTabClose, onRequestSaveAndClose }: TabBarProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const measureRefs = useRef(new Map<string, HTMLDivElement | null>())
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [containerWidth, setContainerWidth] = useState(0)
  const [tabWidths, setTabWidths] = useState<Record<string, number>>({})

  useLayoutEffect(() => {
    const nextWidths: Record<string, number> = {}
    for (const tab of tabs) {
      const el = measureRefs.current.get(tab.id)
      if (!el) continue
      nextWidths[tab.id] = Math.ceil(el.getBoundingClientRect().width)
    }
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
    >
      {tab.dirty && <span className="tab-dirty-dot" />}
      <span className="tab-title">
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
      <div className="tab-bar-measure" aria-hidden="true">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            ref={(node) => {
              measureRefs.current.set(tab.id, node)
            }}
            className={`tab-item tab-item-measure ${tab.id === activeId ? 'active' : ''}`}
          >
            {tab.dirty && <span className="tab-dirty-dot" />}
            <span className="tab-title">
              <span className="tab-title-text">{tab.title}</span>
            </span>
            <button type="button" className="tab-close" tabIndex={-1}>
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  )
})
