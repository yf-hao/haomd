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
  const listRef = useRef<HTMLUListElement | null>(null)

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

  // 选中项变化时，自动滚动到可视区域
  useEffect(() => {
    if (!open) return
    if (!pageItems.length) return
    if (selectedIndex < 0 || selectedIndex >= pageItems.length) return
    const listEl = listRef.current
    if (!listEl) return
    const itemEl = listEl.children[selectedIndex] as HTMLElement | undefined
    if (!itemEl) return
    itemEl.scrollIntoView({ block: 'nearest' })
  }, [open, pageItems.length, selectedIndex])

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

    // 左右键：翻页
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      if (e.key === 'ArrowLeft') {
        if (currentPage > 1) {
          setCurrentPage((prev) => (prev > 1 ? prev - 1 : prev))
          setSelectedIndex(0)
        }
      } else {
        if (currentPage < totalPages) {
          setCurrentPage((prev) => (prev < totalPages ? prev + 1 : prev))
          setSelectedIndex(0)
        }
      }
      return
    }

    // 上下键：在当前页内移动高亮项
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

  const handleSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (
      e.key === 'Escape' ||
      e.key === 'Enter' ||
      e.key === 'ArrowUp' ||
      e.key === 'ArrowDown' ||
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowRight'
    ) {
      // 复用同一套键盘逻辑，但阻止事件继续冒泡，避免重复处理
      handleKeyDown(e as unknown as KeyboardEvent<HTMLDivElement>)
      e.stopPropagation()
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
        <div className="modal-title">Recent files</div>
        <div className="modal-content recent-dialog-content">
          <div className="recent-dialog-toolbar">
            <input
              ref={searchInputRef}
              type="text"
              className="recent-dialog-search-input"
              placeholder="Search by name or path…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setCurrentPage(1)
                setSelectedIndex(0)
              }}
              onKeyDown={handleSearchKeyDown}
            />
          </div>

          <div className="recent-dialog-list">
            {loading && (
              <div className="recent-dialog-status">Loading recent files…</div>
            )}
            {!loading && error && (
              <div className="recent-dialog-status recent-dialog-error">{error}</div>
            )}
            {!loading && !error && pageItems.length === 0 && (
              <div className="recent-dialog-status">No matching recent files</div>
            )}
            {!loading && !error && pageItems.length > 0 && (
              <ul ref={listRef}>
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
              Prev
            </Button>
            <span className="recent-dialog-page-label">{pageLabel}</span>
            <Button
              variant="tertiary"
              onClick={() => {
                setCurrentPage((prev) => (prev < totalPages ? prev + 1 : prev))
                setSelectedIndex(0)
              }}
              disabled={currentPage >= totalPages}
            >
              Next
            </Button>
          </div>
          <div className="recent-dialog-actions-right">
            <Button variant="tertiary" onClick={handleClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
