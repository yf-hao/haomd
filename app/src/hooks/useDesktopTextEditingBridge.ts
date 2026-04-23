import { useCallback, useEffect } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { onNativePaste, onNativePasteError } from '../modules/platform/clipboardEvents'

type DesktopTextEditingBridgeOptions = {
  enabled: boolean
  onPasteFallback?: (text: string) => void
  onPasteError?: (message: string) => void
}

function insertIntoActiveEditable(text: string): boolean {
  if (!text || typeof document === 'undefined') return false

  const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
  const isEditableInput =
    !!active &&
    (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') &&
    !active.readOnly &&
    !active.disabled

  if (!isEditableInput || typeof active.setRangeText !== 'function') {
    return false
  }

  const start = active.selectionStart ?? active.value.length
  const end = active.selectionEnd ?? start
  active.focus()
  active.setRangeText(text, start, end, 'end')
  active.dispatchEvent(new Event('input', { bubbles: true }))
  return true
}

export function useDesktopTextEditingBridge({
  enabled,
  onPasteFallback,
  onPasteError,
}: DesktopTextEditingBridgeOptions) {
  useEffect(() => {
    if (!enabled) return

    const unPaste = onNativePaste((text) => {
      if (!text) return
      if (insertIntoActiveEditable(text)) return
      onPasteFallback?.(text)
    })

    const unError = onNativePasteError((message) => {
      onPasteError?.(message)
    })

    return () => {
      unPaste()
      unError()
    }
  }, [enabled, onPasteError, onPasteFallback])

  const handleKeyDownCapture = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    const isMeta = event.metaKey || event.ctrlKey
    if (!isMeta) return
    const key = event.key.toLowerCase()
    if (key === 'c' || key === 'v' || key === 'x' || key === 'z' || key === 'y') {
      event.stopPropagation()
    }
  }, [])

  return {
    handleKeyDownCapture,
  }
}
