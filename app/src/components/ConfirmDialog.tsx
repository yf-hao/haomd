import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

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

  const modalRef = useRef<HTMLDivElement | null>(null)
  const confirmRef = useRef<HTMLButtonElement | null>(null)
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const extraRef = useRef<HTMLButtonElement | null>(null)


  type ButtonConfig = {
    ref: React.RefObject<HTMLButtonElement | null>
    action: 'confirm' | 'cancel' | 'extra'
  }

  const getButtons = (): ButtonConfig[] => {
    if (isStacked) {
      const buttons: ButtonConfig[] = [{ ref: confirmRef, action: 'confirm' }]
      if (onExtra) {
        buttons.push({ ref: extraRef, action: 'extra' })
      }
      buttons.push({ ref: cancelRef, action: 'cancel' })
      return buttons
    }

    // 默认水平布局：Cancel 在左，Confirm 在右
    return [
      { ref: cancelRef, action: 'cancel' },
      { ref: confirmRef, action: 'confirm' },
    ]
  }

  // 计算默认焦点索引
  const defaultIdx = isStacked ? 0 : 1 // 在 getButtons 中，如果是 stacked，confirm 在索引 0；如果是 default，confirm 在索引 1

  const [activeIndex, setActiveIndex] = useState<number>(defaultIdx)

  // 处理布局变化时的索引重置
  useEffect(() => {
    const currentButtons = getButtons()
    const confirmIdx = currentButtons.findIndex((b) => b.action === 'confirm')
    setActiveIndex(confirmIdx >= 0 ? confirmIdx : 0)
  }, [isStacked, extraText, !!onExtra])

  // 处理焦点同步
  useEffect(() => {
    const currentButtons = getButtons()
    const index = activeIndex >= 0 && activeIndex < currentButtons.length ? activeIndex : 0
    const btn = currentButtons[index]?.ref.current
    if (btn) {
      btn.focus()
    }
  }, [activeIndex, isStacked, extraText, !!onExtra])

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const buttons = getButtons()
      if (!buttons.length) return
      const delta = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1
      setActiveIndex((prev) => {
        if (prev < 0 || prev >= buttons.length) {
          const confirmIdx = buttons.findIndex((b) => b.action === 'confirm')
          return confirmIdx >= 0 ? confirmIdx : 0
        }
        const next = (prev + delta + buttons.length) % buttons.length
        return next
      })
      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      const buttons = getButtons()
      if (!buttons.length) return
      let index = activeIndex
      if (index < 0 || index >= buttons.length) {
        const confirmIdx = buttons.findIndex((b) => b.action === 'confirm')
        index = confirmIdx >= 0 ? confirmIdx : 0
      }
      const action = buttons[index]?.action
      if (action === 'confirm') {
        onConfirm()
      } else if (action === 'cancel') {
        onCancel()
      } else if (action === 'extra' && onExtra) {
        onExtra()
      }
      return
    }

    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        ref={modalRef}
        className={`modal modal-confirm ${isStacked ? 'modal-stacked' : ''}`}
        onClick={(e) => e.stopPropagation()}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <div className="modal-title">{title}</div>
        <div className="modal-content">
          <div className="modal-message">{message}</div>
        </div>

        <div className={`modal-actions ${isStacked ? 'modal-actions-stacked' : ''}`}>
          {isStacked ? (
            <>
              <button
                ref={confirmRef}
                className="modal-btn primary"
                onClick={onConfirm}
              >
                {confirmText}
              </button>
              {onExtra && (
                <button
                  ref={extraRef}
                  className="modal-btn secondary"
                  onClick={onExtra}
                >
                  {extraText}
                </button>
              )}
              <button
                ref={cancelRef}
                className="modal-btn tertiary"
                onClick={onCancel}
              >
                {cancelText}
              </button>
            </>
          ) : (
            <>
              <button
                ref={cancelRef}
                className="modal-btn tertiary"
                onClick={onCancel}
              >
                {cancelText}
              </button>
              <button
                ref={confirmRef}
                className="modal-btn primary"
                onClick={onConfirm}
              >
                {confirmText}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
