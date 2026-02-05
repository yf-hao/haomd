import type { EditorTab } from '../types/tabs'

export type TabBarProps = {
  tabs: EditorTab[]
  activeId: string | null
  onTabClick: (id: string) => void
  onTabClose: (id: string) => void
}

export function TabBar({ tabs, activeId, onTabClick, onTabClose }: TabBarProps) {
  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab-item ${tab.id === activeId ? 'active' : ''}`}
          onClick={() => onTabClick(tab.id)}
        >
          <span className="tab-title">
            {tab.dirty ? '● ' : ''}
            {tab.title}
          </span>
          <button
            type="button"
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation()
              onTabClose(tab.id)
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
