import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Button } from './Button'
import { listRecentPage } from '../modules/files/service'
import type { RecentFile } from '../modules/files/types'

export type RecentFilesDialogProps = {
  open: boolean
  onClose: () => void
  onOpenFile: (path: string) => void
}

const PAGE_SIZE = 20
const MAX_RECENT_LIMIT = 200

function normalizeQuery(raw: string): string {
  return raw.trim().toLowerCase()
}

function filterItems(items: RecentFile[], query: string): RecentFile[] {
  if (!query) return items
  const q = normalizeQuery(query)
  if (!q) return items
  return items.filter((item) => {
    const name = (item.displayName || '').toLowerCase()
    const path = (item.path || '').toLowerCase()
    return name.includes(q) || path.includes(q)
  })
}

export function RecentFilesDialog({ open, onClose, onOpenFile }: RecentFilesDialogProps) {
  const [items, setItems] = useState<RecentFile[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [selectedIndex, setSelectedIndex] = useState(0)

  const searchInputRef = useRef<HTMLInputElement | null>(null)

  const loadRecent = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const resp = await listRecentPage(0, MAX_RECENT_LIMIT)
      if (!resp.ok) {
        setError(resp.error.message)
        setItems([])
        return
      }
      // 只显示文件，过滤掉文件夹项
      const onlyFiles = resp.data.filter((item) => !item.isFolder)
      setItems(onlyFiles)
    } catch (e) {
      setError(String(e))
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  // 打开时加载数据并重置状态
  useEffect(() => {
    if (!open) return
    void loadRecent()
    setQuery('')
    setCurrentPage(1)
    setSelectedIndex(0)
  }, [open, loadRecent])

  // 打开时聚焦搜索框
  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus()
    }, 50)
    return () => window.clearTimeout(timer)
  }, [open])

  const filteredItems = useMemo(() => filterItems(items, query), [items, query])

  const totalPages = useMemo(() => {
    if (filteredItems.length === 0) return 1
    return Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE))
  }, [filteredItems.length])

  // 纠正当前页，防止越界
  useEffect(() => {
    setCurrentPage((prev) => {
      if (prev < 1) return 1
      if (prev > totalPages) return totalPages
      return prev
    })
  }, [totalPages])

  const pageItems = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    const end = start + PAGE_SIZE
    return filteredItems.slice(start, end)
  }, [filteredItems, currentPage])

  // 当页数据变化时，校正选中索引
  useEffect(() => {
    setSelectedIndex((prev) => {
      if (pageItems.length === 0) return 0
      if (prev < 0) return 0
      if (prev >= pageItems.length) return pageItems.length - 1
      return prev
    })
  }, [pageItems.length])

  const handleClose = useCallback(() => {
    onClose()
  }, [onClose])

  const handleOpenSelected = useCallback(() => {
    if (!pageItems.length) return
    const safeIndex = selectedIndex >= 0 && selectedIndex < pageItems.length ? selectedIndex : 0
    const target = pageItems[safeIndex]
    if (!target) return
    onOpenFile(target.path)
  }, [pageItems, selectedIndex, onOpenFile])

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      handleClose()
      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      handleOpenSelected()
      return
    }

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      if (!pageItems.length) return
      const delta = e.key === 'ArrowUp' ? -1 : 1
      setSelectedIndex((prev) => {
        if (pageItems.length === 0) return 0
        const next = prev + delta
        if (next < 0) return 0
        if (next >= pageItems.length) return pageItems.length - 1
        return next
      })
    }
  }

  if (!open) return null

  const pageLabel = `${currentPage} / ${totalPages}`

  return (
    <div className="modal-backdrop" onClick={handleClose}>
      <div
        className="modal modal-recent"
        onClick={(e) => e.stopPropagation()}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <div className="modal-title">最近文件</div>
        <div className="modal-content recent-dialog-content">
          <div className="recent-dialog-toolbar">
            <input
              ref={searchInputRef}
              type="text"
              className="recent-dialog-search-input"
              placeholder="按文件名或路径搜索…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setCurrentPage(1)
                setSelectedIndex(0)
              }}
            />
            <div className="recent-dialog-hint">↑/↓ 选择，Enter 打开，Esc 关闭</div>
          </div>

          <div className="recent-dialog-list">
            {loading && (
              <div className="recent-dialog-status">正在加载最近文件…</div>
            )}
            {!loading && error && (
              <div className="recent-dialog-status recent-dialog-error">{error}</div>
            )}
            {!loading && !error && pageItems.length === 0 && (
              <div className="recent-dialog-status">没有匹配的最近文件</div>
            )}
            {!loading && !error && pageItems.length > 0 && (
              <ul>
                {pageItems.map((item, index) => {
                  const name = item.displayName || item.path.split(/[/\\]/).pop() || item.path
                  const isActive = index === selectedIndex
                  return (
                    <li
                      key={item.path}
                      className={isActive ? 'recent-dialog-item active' : 'recent-dialog-item'}
                      onClick={() => setSelectedIndex(index)}
                      onDoubleClick={() => {
                        setSelectedIndex(index)
                        handleOpenSelected()
                      }}
                    >
                      <div className="recent-dialog-item-name">{name}</div>
                      <div className="recent-dialog-item-path">{item.path}</div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="modal-actions recent-dialog-actions">
          <div className="recent-dialog-pagination">
            <Button
              variant="tertiary"
              onClick={() => {
                setCurrentPage((prev) => (prev > 1 ? prev - 1 : prev))
                setSelectedIndex(0)
              }}
              disabled={currentPage <= 1}
            >
              上一页
            </Button>
            <span className="recent-dialog-page-label">Page {pageLabel}</span>
            <Button
              variant="tertiary"
              onClick={() => {
                setCurrentPage((prev) => (prev < totalPages ? prev + 1 : prev))
                setSelectedIndex(0)
              }}
              disabled={currentPage >= totalPages}
            >
              下一页
            </Button>
          </div>
          <div className="recent-dialog-actions-right">
            <Button variant="tertiary" onClick={handleClose}>
              关闭
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
