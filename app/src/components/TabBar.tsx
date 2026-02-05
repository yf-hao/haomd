import type { EditorTab } from '../types/tabs'

export type TabBarProps = {
  tabs: EditorTab[]
  activeId: string | null
  onTabClick: (id: string) => void
  onTabClose: (id: string) => void
  onRequestSaveAndClose?: (id: string) => void
}

export function TabBar({ tabs, activeId, onTabClick, onTabClose, onRequestSaveAndClose }: TabBarProps) {
  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab-item ${tab.id === activeId ? 'active' : ''}`}
          onClick={() => {
            console.log('[TabBar] activate tab', {
              tabId: tab.id,
              title: tab.title,
              dirty: tab.dirty,
              activeId,
            })
            onTabClick(tab.id)
          }}
        >
          <span className="tab-title">
            {tab.dirty ? '● ' : ''}
            {tab.title}
          </span>
          <button
            type="button"
            className="tab-close"
            onMouseDown={(e) => {
              e.stopPropagation()
              console.log('[TabBar] close button mousedown', {
                tabId: tab.id,
                title: tab.title,
                dirty: tab.dirty,
                hasSaveAndCloseHandler: Boolean(onRequestSaveAndClose),
              })
            }}
            onClick={(e) => {
              e.stopPropagation()
              console.log('[TabBar] close button click', {
                tabId: tab.id,
                title: tab.title,
                dirty: tab.dirty,
                hasSaveAndCloseHandler: Boolean(onRequestSaveAndClose),
              })

              if (tab.dirty && onRequestSaveAndClose) {
                console.log('[TabBar] delegate save+close to App', { tabId: tab.id })
                onRequestSaveAndClose(tab.id)
                return
              }

              if (tab.dirty && !onRequestSaveAndClose) {
                console.log('[TabBar] local confirm for dirty tab without save handler', { tabId: tab.id })
                const shouldClose = window.confirm('This tab has unsaved changes. Closing may discard your edits. Continue?')
                if (!shouldClose) return
              }

              console.log('[TabBar] closing tab via onTabClose', { tabId: tab.id })
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
