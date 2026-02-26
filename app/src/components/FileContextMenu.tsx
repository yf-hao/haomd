import { useEffect, useRef, useState } from 'react'

export type FileContextMenuItem = {
  id: string
  label: string
  onClick: () => void | Promise<void>
  visible?: boolean
}

export type FileContextMenuProps = {
  x: number
  y: number
  items: FileContextMenuItem[]
  onRequestClose: () => void
}

export function FileContextMenu({ x, y, items, onRequestClose }: FileContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  const visibleItems = items.filter((item) => item && item.visible !== false)

  useEffect(() => {
    const menuWidth = 200
    const itemCount = visibleItems.length || 1
    const menuHeight = itemCount * 28 + 8

    let left = x
    let top = y
    const vw = window.innerWidth
    const vh = window.innerHeight

    if (left + menuWidth > vw) {
      left = Math.max(4, vw - menuWidth - 4)
    }
    if (top + menuHeight > vh) {
      top = Math.max(4, vh - menuHeight - 4)
    }

    setPosition({ left, top })
  }, [x, y, visibleItems.length])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (!menuRef.current) return
      if (!menuRef.current.contains(e.target as Node)) {
        onRequestClose()
      }
    }

    const handleContextMenu = (e: MouseEvent) => {
      if (!menuRef.current) return
      if (!menuRef.current.contains(e.target as Node)) {
        onRequestClose()
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onRequestClose()
      }
    }

    window.addEventListener('click', handleClick)
    window.addEventListener('contextmenu', handleContextMenu)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('click', handleClick)
      window.removeEventListener('contextmenu', handleContextMenu)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onRequestClose])

  if (visibleItems.length === 0) {
    return null
  }

  return (
    <div
      ref={menuRef}
      className="sidebar-context-menu"
      style={{ left: position.left, top: position.top }}
      role="menu"
      onClick={(e) => e.stopPropagation()}
    >
      {visibleItems.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          onClick={() => {
            void item.onClick()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
