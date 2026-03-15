import { memo } from 'react'
import type { EditorTab } from '../types/tabs'

import './TabBar.css'

export type TabBarProps = {
  tabs: EditorTab[]
  activeId: string | null
  onTabClick: (id: string) => void
  onTabClose: (id: string) => void
  onRequestSaveAndClose?: (id: string) => void
}

export const TabBar = memo(function TabBar({ tabs, activeId, onTabClick, onTabClose, onRequestSaveAndClose }: TabBarProps) {
  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab-item ${tab.id === activeId ? 'active' : ''}`}
          onClick={() => onTabClick(tab.id)}
        >
          <span className="tab-title">
            {tab.dirty && <span className="tab-dirty-dot" />}
            {tab.title}
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
      ))}
    </div>
  )
})
