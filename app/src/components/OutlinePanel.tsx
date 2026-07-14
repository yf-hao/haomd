import type { OutlineItem } from '../modules/outline/parser'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../modules/i18n/I18nContext'
import { SidebarBackgroundShell } from './SidebarBackgroundShell'

export type OutlinePanelProps = {
  items: OutlineItem[]
  activeId: string | null
  onSelect: (item: OutlineItem) => void
  panelWidth?: number
  emptyTitle?: string
  emptyHint?: string
}

type OutlineDepth = 1 | 2 | 3 | 4 | 5 | 6 | 'all'

const OUTLINE_DEPTH_STORAGE_KEY = 'haomd:outline:max-visible-level'
const OUTLINE_DEPTH_OPTIONS: OutlineDepth[] = ['all', 1, 2, 3, 4, 5, 6]

function getInitialDepth(): OutlineDepth {
  if (typeof window === 'undefined') return 2
  try {
    const raw = window.localStorage.getItem(OUTLINE_DEPTH_STORAGE_KEY)
    if (raw === 'all') return 'all'
    const parsed = Number(raw)
    if (parsed >= 1 && parsed <= 6) return parsed as 1 | 2 | 3 | 4 | 5 | 6
  } catch {
    // Ignore storage access errors and fall back to the default.
  }
  return 2
}

function OutlineDepthIcon() {
  return (
    <svg className="outline-depth-toggle-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 5.5h12M4 10h8M4 14.5h12" />
    </svg>
  )
}

function OutlineChevronIcon() {
  return (
    <svg className="outline-depth-chevron-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5 8l5 5 5-5" />
    </svg>
  )
}

export const OutlinePanel = memo(function OutlinePanel({ items, activeId, onSelect, panelWidth, emptyTitle, emptyHint }: OutlinePanelProps) {
  const { t } = useI18n()
  const hasItems = items.length > 0
  const style = panelWidth ? { width: panelWidth } : undefined

  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(() => new Set())
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => new Set())
  const [maxVisibleLevel, setMaxVisibleLevel] = useState<OutlineDepth>(() => getInitialDepth())
  const [depthMenuOpen, setDepthMenuOpen] = useState(false)
  const depthMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!depthMenuOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (depthMenuRef.current?.contains(target)) return
      setDepthMenuOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDepthMenuOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [depthMenuOpen])

  useEffect(() => {
    try {
      window.localStorage.setItem(OUTLINE_DEPTH_STORAGE_KEY, String(maxVisibleLevel))
    } catch {
      // Ignore storage write failures.
    }
  }, [maxVisibleLevel])

  const setNodeCollapsed = (nodeId: string, nextCollapsed: boolean) => {
    setCollapsedNodes((prev) => {
      const next = new Set(prev)
      if (nextCollapsed) next.add(nodeId)
      else next.delete(nodeId)
      return next
    })
    setExpandedNodes((prev) => {
      const next = new Set(prev)
      if (nextCollapsed) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }

  const toggleCollapse = (e: React.MouseEvent, nodeId: string, nextCollapsed: boolean) => {
    e.stopPropagation()
    setNodeCollapsed(nodeId, nextCollapsed)
  }

  const handleSelectDepth = (depth: OutlineDepth) => {
    setMaxVisibleLevel(depth)
    setDepthMenuOpen(false)
    setCollapsedNodes(new Set())
    setExpandedNodes(new Set())
  }

  const selectedDepthLabel = useMemo(() => {
    if (maxVisibleLevel === 'all') return t('outline.allLevels')
    return t('outline.showToLevel', { level: maxVisibleLevel })
  }, [maxVisibleLevel, t])

  const renderNode = (item: OutlineItem) => {
    const isActive = item.id === activeId
    const hasChildren = item.children && item.children.length > 0
    const autoCollapsed = maxVisibleLevel !== 'all' && item.level >= maxVisibleLevel
    const explicitExpanded = expandedNodes.has(item.id)
    const collapsed = collapsedNodes.has(item.id) || (autoCollapsed && !explicitExpanded)

    return (
      <li key={item.id} className="outline-node">
        <div
          className={`outline-item level-${item.level} ${isActive ? 'active' : ''}`}
          onClick={() => onSelect(item)}
          title={item.text}
        >
          {hasChildren ? (
            <button
              className={`outline-toggle ${collapsed ? 'collapsed' : 'expanded'} ${autoCollapsed ? 'limited' : ''}`}
              onClick={(e) => toggleCollapse(e, item.id, !collapsed)}
              aria-label={collapsed ? t('outline.expand') : t('outline.collapse')}
              aria-expanded={!collapsed}
            >
              <span className="outline-toggle-icon" aria-hidden="true" />
            </button>
          ) : (
            <span className="outline-toggle-spacer" aria-hidden="true" />
          )}
          <span className="outline-text">{item.text}</span>
        </div>
        {/* 递归渲染子节点 */}
        {!collapsed && hasChildren && (
          <ul className="outline-children">
            {item.children!.map((child) => renderNode(child))}
          </ul>
        )}
      </li>
    )
  }

  return (
    <SidebarBackgroundShell as="aside" className="outline-panel" style={style}>
      <div className="outline-header">
        <span className="outline-header-title">{t('outline.title')}</span>
        <div className="outline-depth-select" ref={depthMenuRef}>
          <button
            type="button"
            className={`outline-depth-toggle ${depthMenuOpen ? 'is-open' : ''}`}
            onClick={() => setDepthMenuOpen((prev) => !prev)}
            aria-haspopup="menu"
            aria-expanded={depthMenuOpen}
            aria-label={t('outline.viewDepth')}
            title={selectedDepthLabel}
          >
            <OutlineDepthIcon />
            <OutlineChevronIcon />
          </button>
          {depthMenuOpen && (
            <div className="outline-depth-menu" role="menu" aria-label={t('outline.viewDepth')}>
              {OUTLINE_DEPTH_OPTIONS.map((depth) => {
                const label = depth === 'all' ? t('outline.allLevels') : t('outline.showToLevel', { level: depth })
                const active = depth === maxVisibleLevel
                return (
                  <button
                    key={String(depth)}
                    type="button"
                    className={`outline-depth-option ${active ? 'is-active' : ''}`}
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => handleSelectDepth(depth)}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {hasItems ? (
        <ul className="outline-list">
          {items.map((item) => renderNode(item))}
        </ul>
      ) : (
        <div className="outline-empty">
          <div className="outline-empty-title">{emptyTitle ?? t('outline.noHeadings')}</div>
          <div className="outline-empty-sub">{emptyHint ?? t('outline.noHeadingsHint')}</div>
        </div>
      )}
    </SidebarBackgroundShell>
  )
})
