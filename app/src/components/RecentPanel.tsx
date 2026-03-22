import type { RecentFile } from '../modules/files/types'
import { useI18n } from '../modules/i18n/I18nContext'

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
  const { t } = useI18n()
  if (!open) return null

  return (
    <aside className="side-panel recent-panel">
      <div className="side-header">
        <div className="pane-title">{t('recent.title')}</div>
        <button className="ghost" onClick={onClose}>
          {t('recent.close')}
        </button>
      </div>
      <div className="side-body">
        {items.length === 0 && <div className="muted">{t('recent.noRecords')}</div>}
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
              {t('recent.delete')}
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
              {loading ? t('recent.loadingMore') : t('recent.loadMore')}
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}
