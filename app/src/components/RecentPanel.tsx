import type { RecentFile } from '../modules/files/types'

export type RecentPanelProps = {
  open: boolean
  items: RecentFile[]
  hasMore: boolean
  loading: boolean
  formatTs: (ts?: number | null) => string
  confirmLoseChanges: () => boolean
  onClose: () => void
  onLoadMore: () => Promise<void> | void
  onOpenItem: (path: string) => void
  onDeleteItem: (path: string) => Promise<void> | void
}

export function RecentPanel({
  open,
  items,
  hasMore,
  loading,
  formatTs,
  confirmLoseChanges,
  onClose,
  onLoadMore,
  onOpenItem,
  onDeleteItem,
}: RecentPanelProps) {
  if (!open) return null

  return (
    <aside className="side-panel recent-panel">
      <div className="side-header">
        <div className="pane-title">最近文件</div>
        <button className="ghost" onClick={onClose}>
          关闭
        </button>
      </div>
      <div className="side-body">
        {items.length === 0 && <div className="muted">暂无记录</div>}
        {items.map((item) => (
          <div key={item.path} className="history-item-row">
            <div
              className="history-item"
              role="button"
              tabIndex={0}
              onClick={() => {
                if (!confirmLoseChanges()) return
                onOpenItem(item.path)
                onClose()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  if (!confirmLoseChanges()) return
                  onOpenItem(item.path)
                  onClose()
                }
              }}
            >
              <div className="history-title">{item.displayName}</div>
              <div className="muted small">{item.path}</div>
              <div className="muted small">{formatTs(item.lastOpenedAt)}</div>
            </div>
            <button
              className="ghost small danger"
              onClick={async (e) => {
                e.stopPropagation()
                await onDeleteItem(item.path)
              }}
            >
              删除
            </button>
          </div>
        ))}
        {hasMore && (
          <div className="recent-more">
            <button
              className="ghost"
              disabled={loading}
              onClick={async () => {
                await onLoadMore()
              }}
            >
              {loading ? '加载中…' : '加载更多'}
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}
