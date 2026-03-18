import type { FC } from 'react'
import { useEffect, useRef, useState } from 'react'

export interface BadgeSelectOption {
  value: string
  label: string
}

export interface BadgeSelectProps {
  options: BadgeSelectOption[]
  value: string
  onChange: (value: string) => void
}

export const BadgeSelect: FC<BadgeSelectProps> = ({ options, value, onChange }) => {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const selectedLabel = options.find((o) => o.value === value)?.label ?? ''

  return (
    <div
      className="ai-chat-input-badge ai-chat-role-badge"
      ref={ref}
      onClick={() => setOpen((prev) => !prev)}
    >
      <span className="ai-chat-icon-chevron-up" aria-hidden="true" />
      <span className="badge-select-label">{selectedLabel}</span>
      {open && (
        <div className="badge-select-dropdown">
          {options.map((opt) => (
            <div
              key={opt.value}
              className={`badge-select-option${opt.value === value ? ' active' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                onChange(opt.value)
                setOpen(false)
              }}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
