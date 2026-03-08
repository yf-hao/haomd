import type { FC } from 'react'

export type AiSlashCommandHintPanelProps = {
  items: { name: string; description: string }[]
  activeIndex: number
  onItemClick: (index: number) => void
}

export const AiSlashCommandHintPanel: FC<AiSlashCommandHintPanelProps> = ({ items, activeIndex, onItemClick }) => {
  if (!items.length) return null

  return (
    <div className="ai-chat-slash-panel" role="listbox" aria-label="AI Chat Slash Commands">
      {items.map((item, idx) => {
        const isActive = idx === activeIndex
        return (
          <button
            key={item.name}
            type="button"
            className={`ai-chat-slash-item${isActive ? ' ai-chat-slash-item-active' : ''}`}
            onClick={() => onItemClick(idx)}
            role="option"
            aria-selected={isActive}
          >
            <div className="ai-chat-slash-item-name">/{item.name}</div>
            <div className="ai-chat-slash-item-desc">{item.description}</div>
          </button>
        )
      })}
    </div>
  )
}
