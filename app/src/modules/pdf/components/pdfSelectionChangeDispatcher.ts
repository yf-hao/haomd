type SelectionChangeHandler = () => void

type SelectionChangeEntry = {
  root: HTMLElement | null
  handler: SelectionChangeHandler
}

const handlers = new Set<SelectionChangeEntry>()
let listening = false

function isEditableOutsideRegisteredRoots(activeElement: Element | null) {
  if (!(activeElement instanceof HTMLElement)) return false
  const insideRegisteredRoot = [...handlers].some((entry) => entry.root?.contains(activeElement))
  if (insideRegisteredRoot) return false
  return activeElement.isContentEditable || activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'SELECT'
}

const handleSelectionChange = () => {
  const activeElement = typeof document !== 'undefined' ? document.activeElement : null
  if (isEditableOutsideRegisteredRoots(activeElement)) {
    return
  }

  for (const entry of handlers) {
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
