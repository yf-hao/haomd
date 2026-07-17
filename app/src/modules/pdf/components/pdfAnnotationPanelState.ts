const STORAGE_PREFIX = 'haomd:pdf:annotation-panel-open:'

export function getPdfAnnotationPanelStorageKey(filePath: string): string {
  return `${STORAGE_PREFIX}${filePath}`
}

export function loadPdfAnnotationPanelOpen(filePath: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    const raw = window.localStorage.getItem(getPdfAnnotationPanelStorageKey(filePath))
    if (raw == null) return false
    return raw === 'true'
  } catch {
    return false
  }
}

export function savePdfAnnotationPanelOpen(filePath: string, open: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(getPdfAnnotationPanelStorageKey(filePath), String(open))
  } catch {
    // ignore
  }
}
