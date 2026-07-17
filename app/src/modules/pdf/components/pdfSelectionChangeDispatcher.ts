type SelectionChangeHandler = () => void

type SelectionChangeEntry = {
  root: HTMLElement | null
  handler: SelectionChangeHandler
}

const handlers = new Set<SelectionChangeEntry>()
let listening = false
const ENABLE_PDF_SELECTION_DEBUG = true
let selectionChangeSuppressedUntil = 0

function isEditableElement(activeElement: Element | null) {
  if (!(activeElement instanceof HTMLElement)) return false
  return activeElement.isContentEditable || activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'SELECT'
}

export function shouldIgnorePdfSelectionChangeForEditableOutsideRoots(
  root: HTMLElement | null,
  activeElement: Element | null,
) {
  if (!(activeElement instanceof HTMLElement)) return false
  if (activeElement.closest('[data-pdf-selection-skip="true"]')) return false
  if (root?.contains(activeElement)) return false
  return isEditableElement(activeElement)
}

export function suppressPdfSelectionChangeDispatch(durationMs = 250) {
  selectionChangeSuppressedUntil = Math.max(selectionChangeSuppressedUntil, Date.now() + durationMs)
}

const handleSelectionChange = () => {
  if (Date.now() < selectionChangeSuppressedUntil) {
    return
  }
  const activeElement = typeof document !== 'undefined' ? document.activeElement : null
  if (!(activeElement instanceof HTMLElement)) return
  if (activeElement.closest('[data-pdf-selection-skip="true"]')) return

  const handlersSnapshot = [...handlers]
  if (!handlersSnapshot.length) return

  const insideRegisteredRoot = handlersSnapshot.some((entry) => entry.root?.contains(activeElement))
  if (!insideRegisteredRoot && isEditableElement(activeElement)) {
    if (ENABLE_PDF_SELECTION_DEBUG) {
      console.debug('[input-debug][pdf-selection] dispatch-skip-editable-outside-root', {
        handlerCount: handlersSnapshot.length,
        activeTag: activeElement.tagName,
      })
    }
    return
  }

  if (ENABLE_PDF_SELECTION_DEBUG) {
    console.debug('[input-debug][pdf-selection] dispatch', {
      handlerCount: handlersSnapshot.length,
      activeTag: activeElement.tagName,
    })
  }

  for (const entry of handlersSnapshot) {
    entry.handler()
  }
}

function ensureListening() {
  if (listening || typeof document === 'undefined') return
  document.addEventListener('selectionchange', handleSelectionChange)
  listening = true
}

function stopListening() {
  if (!listening || typeof document === 'undefined') return
  document.removeEventListener('selectionchange', handleSelectionChange)
  listening = false
}

export function registerPdfSelectionChangeHandler(root: HTMLElement | null, handler: SelectionChangeHandler) {
  handlers.add({ root, handler })
  ensureListening()
  return () => {
    for (const entry of handlers) {
      if (entry.handler === handler) {
        handlers.delete(entry)
        break
      }
    }
    if (handlers.size === 0) {
      stopListening()
    }
  }
}
