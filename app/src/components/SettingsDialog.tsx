import type { FC } from 'react'

export type SettingsDialogProps = {
  open: boolean
  onClose: () => void
}

export const SettingsDialog: FC<SettingsDialogProps> = ({ open, onClose }) => {
  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-about" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Settings</div>
        <div className="modal-content" style={{ paddingTop: 8 }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center' }}>
            更多设置即将推出
          </div>
        </div>
        <div className="modal-actions">
          <button className="ghost primary" type="button" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  )
}
