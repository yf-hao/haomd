import type { OutlineItem } from '../modules/outline/parser'
import { useState, useMemo } from 'react'

export type OutlinePanelProps = {
  items: OutlineItem[]
  activeId: string | null
  onSelect: (item: OutlineItem) => void
  panelWidth?: number
}

export function OutlinePanel({ items, activeId, onSelect, panelWidth }: OutlinePanelProps) {
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
            aria-label={hasChildren ? (collapsed ? '展开' : '折叠') : undefined}
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
    <aside className="outline-panel" style={style}>
      <div className="outline-header">Outline</div>

      {hasItems ? (
        <ul className="outline-list">
          {items.map((item) => renderNode(item))}
        </ul>
      ) : (
        <div className="outline-empty">
          <div className="outline-empty-title">No headings yet</div>
          <div className="outline-empty-sub">Add Markdown headings like #, ## to see the outline.</div>
        </div>
      )}
    </aside>
  )
}
