import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Button } from './Button'

export type InsertTableDialogProps = {
  open: boolean
  defaultRows?: number
  defaultCols?: number
  onConfirm: (rows: number, cols: number) => void
  onCancel: () => void
}

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function InsertTableDialog({
  open,
  defaultRows = 2,
  defaultCols = 2,
  onConfirm,
  onCancel,
}: InsertTableDialogProps) {
  const [rows, setRows] = useState<string>(String(defaultRows))
  const [cols, setCols] = useState<string>(String(defaultCols))
  const [error, setError] = useState<string | null>(null)
  const rowsInputRef = useRef<HTMLInputElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    setRows(String(defaultRows))
    setCols(String(defaultCols))
    setError(null)
    // 打开时自动聚焦到行数输入框
    const timer = setTimeout(() => {
      rowsInputRef.current?.focus()
      rowsInputRef.current?.select()
    }, 0)
    return () => clearTimeout(timer)
  }, [open, defaultRows, defaultCols])

  if (!open) return null

  const parsePositiveInt = (value: string): number | null => {
    const n = Number(value.trim())
    if (!Number.isFinite(n)) return null
    if (!Number.isInteger(n)) return null
    if (n <= 0) return null
    return n
  }

  const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value))

  const adjustRows = (delta: number) => {
    setRows((prev) => {
      const current = parsePositiveInt(prev) ?? defaultRows
      const next = clamp(current + delta, 1, 50)
      return String(next)
    })
  }

  const adjustCols = (delta: number) => {
    setCols((prev) => {
      const current = parsePositiveInt(prev) ?? defaultCols
      const next = clamp(current + delta, 1, 20)
      return String(next)
    })
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const r = parsePositiveInt(rows)
    const c = parsePositiveInt(cols)
    if (r == null || c == null) {
      setError('行数和列数必须是大于 0 的整数')
      return
    }
    if (r > 50 || c > 20) {
      setError('行数或列数过大，请控制在 50 行、20 列以内')
      return
    }
    setError(null)
    onConfirm(r, c)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
      return
    }

    if (e.key !== 'Tab') return

    const container = dialogRef.current
    if (!container) return

    const focusable = Array.from(
      container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((el) => !el.hasAttribute('disabled') && !el.getAttribute('aria-hidden') && el.tabIndex !== -1)

    if (focusable.length === 0) return

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const current = document.activeElement as HTMLElement | null

    const isShift = e.shiftKey

    if (!isShift && current === last) {
      e.preventDefault()
      first.focus()
      return
    }

    if (isShift && current === first) {
      e.preventDefault()
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
        aria-labelledby="insert-table-title"
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div id="insert-table-title" className="modal-title">
          Insert Table
        </div>
        <form
          className="modal-content insert-table-dialog"
          onSubmit={handleSubmit}
        >
          <div className="insert-table-row">
            <label className="insert-table-label">
              Rows
              <div className="insert-table-input-group">
                <input
                  ref={rowsInputRef}
                  type="number"
                  min={1}
                  max={50}
                  value={rows}
                  onChange={(e) => setRows(e.target.value)}
                  className="insert-table-input"
                />
                <div className="insert-table-stepper">
                  <Button
                    type="button"
                    variant="secondary"
                    className="insert-table-stepper-button"
                    tabIndex={-1}
                    onClick={() => adjustRows(1)}
                  >
                    +
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="insert-table-stepper-button"
                    tabIndex={-1}
                    onClick={() => adjustRows(-1)}
                  >
                    -
                  </Button>
                </div>
              </div>
            </label>
          </div>
          <div className="insert-table-row">
            <label className="insert-table-label">
              Columns
              <div className="insert-table-input-group">
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={cols}
                  onChange={(e) => setCols(e.target.value)}
                  className="insert-table-input"
                />
                <div className="insert-table-stepper">
                  <Button
                    type="button"
                    variant="secondary"
                    className="insert-table-stepper-button"
                    tabIndex={-1}
                    onClick={() => adjustCols(1)}
                  >
                    +
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="insert-table-stepper-button"
                    tabIndex={-1}
                    onClick={() => adjustCols(-1)}
                  >
                    -
                  </Button>
                </div>
              </div>
            </label>
          </div>
          {error && <div className="insert-table-error">{error}</div>}

          <div className="modal-actions">
            <Button variant="primary" type="submit">
              OK
            </Button>
            <Button variant="tertiary" type="button" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
