import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from 'react'
import { Button } from './Button'
import { useI18n } from '../modules/i18n/I18nContext'
import { normalizeTextColor } from '../modules/markdown/extensions/colorMark'
import { TEXT_COLOR_PRESETS } from '../modules/editor/textColorPalette'

export type TextColorDialogProps = {
  open: boolean
  recentColors?: string[]
  onConfirm: (color: string) => void
  onClear: () => void
  onCancel: () => void
}

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function TextColorDialog({
  open,
  recentColors = [],
  onConfirm,
  onClear,
  onCancel,
}: TextColorDialogProps) {
  const { t } = useI18n()
  const [rawColor, setRawColor] = useState(TEXT_COLOR_PRESETS[3]?.color ?? '#3b82f6')
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const hexInputRef = useRef<HTMLInputElement | null>(null)

  const normalizedColor = useMemo(() => normalizeTextColor(rawColor), [rawColor])

  useEffect(() => {
    if (!open) return
    setRawColor(recentColors[0] ?? TEXT_COLOR_PRESETS[3]?.color ?? '#3b82f6')
    const timer = setTimeout(() => {
      hexInputRef.current?.focus()
      hexInputRef.current?.select()
    }, 0)
    return () => clearTimeout(timer)
  }, [open, recentColors])

  if (!open) return null

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!normalizedColor) return
    onConfirm(normalizedColor)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
      return
    }

    if (event.key !== 'Tab') return

    const container = dialogRef.current
    if (!container) return

    const focusable = Array.from(
      container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((el) => !el.hasAttribute('disabled') && !el.getAttribute('aria-hidden') && el.tabIndex !== -1)

    if (focusable.length === 0) return

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const current = document.activeElement as HTMLElement | null

    if (!event.shiftKey && current === last) {
      event.preventDefault()
      first.focus()
      return
    }

    if (event.shiftKey && current === first) {
      event.preventDefault()
      last.focus()
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        ref={dialogRef}
        className="modal modal-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="text-color-dialog-title"
        onClick={(event) => event.stopPropagation()}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div id="text-color-dialog-title" className="modal-title">
          {t('workspace.textColorDialogTitle')}
        </div>
        <form className="modal-content text-color-dialog" onSubmit={handleSubmit}>
          <div className="text-color-row">
            <label className="text-color-label">
              {t('workspace.textColorDialogPreset')}
              <div className="text-color-swatch-grid">
                {TEXT_COLOR_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`text-color-swatch ${normalizedColor === preset.color ? 'active' : ''}`}
                    style={{ '--text-color-swatch': preset.color } as CSSProperties}
                    onClick={() => setRawColor(preset.color)}
                    aria-label={preset.color}
                    title={preset.color}
                  />
                ))}
              </div>
            </label>
          </div>

          {recentColors.length > 0 && (
            <div className="text-color-row">
              <label className="text-color-label">
                {t('workspace.textColorDialogRecent')}
                <div className="text-color-swatch-grid">
                  {recentColors.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`text-color-swatch ${normalizedColor === color ? 'active' : ''}`}
                      style={{ '--text-color-swatch': color } as CSSProperties}
                      onClick={() => setRawColor(color)}
                      title={color}
                    />
                  ))}
                </div>
              </label>
            </div>
          )}

          <div className="text-color-row text-color-row-split">
            <label className="text-color-label">
              {t('workspace.textColorDialogPicker')}
              <input
                className="text-color-picker"
                type="color"
                value={normalizedColor ?? '#3b82f6'}
                onChange={(event) => setRawColor(event.target.value)}
              />
            </label>
            <label className="text-color-label text-color-hex-label">
              {t('workspace.textColorDialogHex')}
              <input
                ref={hexInputRef}
                type="text"
                value={rawColor}
                onChange={(event) => setRawColor(event.target.value)}
                className="insert-table-input text-color-hex-input"
                placeholder="#3b82f6"
                spellCheck={false}
              />
            </label>
          </div>

          {!normalizedColor && (
            <div className="insert-table-error">
              {t('workspace.textColorDialogInvalidHex')}
            </div>
          )}

          <div className="modal-actions">
            <Button variant="primary" type="submit" disabled={!normalizedColor}>
              {t('common.apply')}
            </Button>
            <Button variant="secondary" type="button" onClick={onClear}>
              {t('workspace.textColorDialogClear')}
            </Button>
            <Button variant="tertiary" type="button" onClick={onCancel}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
