export type ConfirmDialogProps = {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  extraText?: string
  variant?: 'default' | 'stacked'
  onConfirm: () => void
  onCancel: () => void
  onExtra?: () => void
}

export function ConfirmDialog({
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  extraText,
  variant = 'default',
  onConfirm,
  onCancel,
  onExtra,
}: ConfirmDialogProps) {
  const isStacked = variant === 'stacked' || Boolean(extraText)

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className={`modal modal-confirm ${isStacked ? 'modal-stacked' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{title}</div>
        <div className="modal-content">
          <div className="modal-message">{message}</div>
        </div>

        <div className={`modal-actions ${isStacked ? 'modal-actions-stacked' : ''}`}>
          {isStacked ? (
            <>
              <button className="modal-btn primary" onClick={onConfirm}>
                {confirmText}
              </button>
              {onExtra && (
                <button className="modal-btn secondary" onClick={onExtra}>
                  {extraText}
                </button>
              )}
              <button className="modal-btn tertiary" onClick={onCancel}>
                {cancelText}
              </button>
            </>
          ) : (
            <>
              <button className="ghost" onClick={onCancel}>
                {cancelText}
              </button>
              <button className="ghost primary" onClick={onConfirm}>
                {confirmText}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
