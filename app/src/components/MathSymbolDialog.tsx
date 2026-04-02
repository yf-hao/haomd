import { useCallback, useEffect, useRef } from 'react'
import { findMathCategory, MATH_CATEGORIES } from '../modules/editor/mathSymbols'
import { insertMathSymbol } from '../modules/editor/formatService'
import './MathSymbolDialog.css'

export type MathSymbolDialogProps = {
  open: boolean
  /** Category key to display, e.g. 'greek' */
  categoryKey?: string
  onClose: () => void
}

export function MathSymbolDialog({ open, categoryKey, onClose }: MathSymbolDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const category = findMathCategory(categoryKey ?? 'greek') ?? MATH_CATEGORIES[0]

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  const handleSymbolClick = useCallback(
    async (latex: string) => {
      await insertMathSymbol(latex)
      onClose()
    },
    [onClose],
  )

  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal modal-math-symbols"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="math-symbol-dialog-header">
          <div className="math-symbol-dialog-title">{category.nameZh}</div>
          <button className="math-symbol-dialog-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="math-symbol-grid">
          {category.items.map((item, idx) => (
            <button
              key={idx}
              className="math-symbol-card"
              title={`点击插入 ${item.latex}`}
              onClick={() => void handleSymbolClick(item.latex)}
            >
              <span className="math-symbol-preview">{item.unicode}</span>
              <span className="math-symbol-code">{item.latex}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
