import type { OutlineItem } from '../modules/outline/parser'
import { memo, useState } from 'react'
import { useI18n } from '../modules/i18n/I18nContext'
import { SidebarBackgroundShell } from './SidebarBackgroundShell'

export type OutlinePanelProps = {
  items: OutlineItem[]
  activeId: string | null
  onSelect: (item: OutlineItem) => void
  panelWidth?: number
}

export const OutlinePanel = memo(function OutlinePanel({ items, activeId, onSelect, panelWidth }: OutlinePanelProps) {
  const { t } = useI18n()
  const hasItems = items.length > 0
  const style = panelWidth ? { width: panelWidth } : undefined
  
  // ✅ 使用函数式初始化，只在首次渲染时执行一次
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(() => new Set())

  const toggleCollapse = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation()
    setCollapsedNodes((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }

  const isCollapsed = (nodeId: string) => collapsedNodes.has(nodeId)

  const renderNode = (item: OutlineItem) => {
    const isActive = item.id === activeId
    const hasChildren = item.children && item.children.length > 0
    const collapsed = isCollapsed(item.id)

    return (
      <li key={item.id} className="outline-node">
        <div
          className={`outline-item level-${item.level} ${isActive ? 'active' : ''}`}
          onClick={() => onSelect(item)}
          title={item.text}
        >
          {/* 折叠/展开按钮 - 有子节点可点击，无子节点作为指示器 */}
          <button
            className={`outline-toggle ${hasChildren ? '' : 'leaf'} ${hasChildren && collapsed ? 'collapsed' : 'expanded'}`}
            onClick={(e) => {
              if (hasChildren) {
                toggleCollapse(e, item.id)
              }
            }}
            aria-label={hasChildren ? (collapsed ? t('outline.expand') : t('outline.collapse')) : undefined}
            aria-expanded={hasChildren ? !collapsed : undefined}
            disabled={!hasChildren}
          >
            <span className="outline-toggle-icon" aria-hidden="true" />
          </button>
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
      <div className="outline-header">{t('outline.title')}</div>

      {hasItems ? (
        <ul className="outline-list">
          {items.map((item) => renderNode(item))}
        </ul>
      ) : (
        <div className="outline-empty">
          <div className="outline-empty-title">{t('outline.noHeadings')}</div>
          <div className="outline-empty-sub">{t('outline.noHeadingsHint')}</div>
        </div>
      )}
    </SidebarBackgroundShell>
  )
})
