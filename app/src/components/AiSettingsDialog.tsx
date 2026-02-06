import type { FC, MouseEventHandler } from 'react'

export type AiSettingsDialogProps = {
  open: boolean
  onClose: () => void
}

export const AiSettingsDialog: FC<AiSettingsDialogProps> = ({ open, onClose }) => {
  if (!open) return null

  const handleBackdropClick = () => {
    onClose()
  }

  const handleInnerClick: MouseEventHandler<HTMLDivElement> = (e) => {
    e.stopPropagation()
  }

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <div className="modal modal-ai-settings" onClick={handleInnerClick}>
        <div className="modal-title">AI Settings</div>
        <div className="modal-content">
          <div className="modal-message">AI Settings 对话框占位，后续填充具体表单。</div>
        </div>
        <div className="modal-actions">
          <button className="ghost" type="button" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
