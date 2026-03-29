import type { FC } from 'react'
import { useEffect, useRef, useState } from 'react'

export interface BadgeSelectOption {
  value: string
  label: string
}

export interface BadgeSelectGroup {
  id: string
  label: string
  options: BadgeSelectOption[]
}

export interface BadgeSelectProps {
  options: BadgeSelectOption[]
  value: string
  onChange: (value: string) => void
  groups?: BadgeSelectGroup[]
  disabled?: boolean
  title?: string
}

export const BadgeSelect: FC<BadgeSelectProps> = ({ options, value, onChange, groups, disabled = false, title }) => {
  const [open, setOpen] = useState(false)
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const hasGroups = !!groups?.length

  useEffect(() => {
    if (disabled) {
      setOpen(false)
      return
    }
  }, [disabled])

  useEffect(() => {
    if (!open) {
      setActiveGroupId(null)
      return
    }
    if (!hasGroups) return
    const selectedGroup = groups?.find((group) => group.options.some((option) => option.value === value))
    setActiveGroupId(selectedGroup?.id ?? groups?.[0]?.id ?? null)
  }, [groups, hasGroups, open, value])

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

  const flatOptions = hasGroups ? (groups ?? []).flatMap((group) => group.options) : options
  const selectedLabel = flatOptions.find((o) => o.value === value)?.label ?? ''
  // Fallback: use the group containing the currently selected model (not the first group)
  const selectedGroup = groups?.find((group) => group.options.some((opt) => opt.value === value))
  const activeGroup = groups?.find((group) => group.id === activeGroupId) ?? selectedGroup ?? groups?.[0]

  return (
    <div
      className={`ai-chat-input-badge ai-chat-role-badge${disabled ? ' is-disabled' : ''}`}
      ref={ref}
      title={title}
      aria-disabled={disabled}
      onClick={() => {
        if (disabled) return
        setOpen((prev) => !prev)
      }}
    >
      <span className="ai-chat-icon-chevron-up" aria-hidden="true" />
      <span className="badge-select-label">{selectedLabel}</span>
      {open && (
        <div className="badge-select-dropdown">
          {hasGroups ? (
            <div className="badge-select-group-menu">
              <div className="badge-select-group-list">
                {(groups ?? []).map((group) => {
                  const groupHasSelected = group.options.some((opt) => opt.value === value)
                  const isActive = activeGroup?.id === group.id
                  return (
                    <div
                      key={group.id}
                      className={`badge-select-group${isActive ? ' active' : ''}${groupHasSelected ? ' selected' : ''}`}
                      onClick={(e) => { e.stopPropagation(); setActiveGroupId(group.id) }}
                    >
                      <span className="badge-select-group-label">{group.label}</span>
                      <span className="badge-select-group-chevron" aria-hidden="true">›</span>
                    </div>
                  )
                })}
              </div>
              {activeGroup && (
                <div className="badge-select-submenu">
                  {activeGroup.options.map((opt) => (
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
          ) : (
            options.map((opt) => (
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
            ))
          )}
        </div>
      )}
    </div>
  )
}
