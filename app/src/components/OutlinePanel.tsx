import type { OutlineItem } from '../modules/outline/parser'

export type OutlinePanelProps = {
  items: OutlineItem[]
  activeId: string | null
  onSelect: (item: OutlineItem) => void
  panelWidth?: number
}

export function OutlinePanel({ items, activeId, onSelect, panelWidth }: OutlinePanelProps) {
  const hasItems = items.length > 0
  const style = panelWidth ? { width: panelWidth } : undefined

  return (
    <aside className="outline-panel" style={style}>
      <div className="outline-header">Outline</div>

      {hasItems ? (
        <ul className="outline-list">
          {items.map((item) => {
            const isActive = item.id === activeId
            return (
              <li
                key={item.id}
                className={`outline-item level-${item.level} ${isActive ? 'active' : ''}`}
                onClick={() => onSelect(item)}
                title={item.text}
              >
                <span className="outline-bullet" aria-hidden="true" />
                <span className="outline-text">{item.text}</span>
              </li>
            )
          })}
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
