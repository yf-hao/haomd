import type { ServiceError } from '../modules/files/types'

export type ConflictModalProps = {
  error: ServiceError
  onRetrySave: () => void | Promise<void>
  onCancel: () => void
}

export function ConflictModal({ error, onRetrySave, onCancel }: ConflictModalProps) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">检测到冲突</div>
        <div className="modal-content">
          <div className="muted">{error.message}</div>
          <div className="muted small">trace: {error.traceId ?? '无'}</div>
        </div>
        <div className="modal-actions">
          <button className="ghost" onClick={onCancel}>
            取消
          </button>
          <button className="ghost primary" onClick={onRetrySave}>
            重试保存
          </button>
        </div>
      </div>
    </div>
  )
}
