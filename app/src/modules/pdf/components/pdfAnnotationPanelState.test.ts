import { afterEach, describe, expect, it } from 'vitest'
import {
  getPdfAnnotationPanelStorageKey,
  loadPdfAnnotationPanelOpen,
  savePdfAnnotationPanelOpen,
} from './pdfAnnotationPanelState'

describe('pdfAnnotationPanelState', () => {
  afterEach(() => {
    window.localStorage.clear()
  })

  it('uses a per-file storage key', () => {
    expect(getPdfAnnotationPanelStorageKey('/a.pdf')).toBe('haomd:pdf:annotation-panel-open:/a.pdf')
    expect(getPdfAnnotationPanelStorageKey('/b.pdf')).toBe('haomd:pdf:annotation-panel-open:/b.pdf')
  })

  it('loads and saves the panel state per file', () => {
    expect(loadPdfAnnotationPanelOpen('/a.pdf')).toBe(false)

    savePdfAnnotationPanelOpen('/a.pdf', true)
    savePdfAnnotationPanelOpen('/b.pdf', false)

    expect(loadPdfAnnotationPanelOpen('/a.pdf')).toBe(true)
    expect(loadPdfAnnotationPanelOpen('/b.pdf')).toBe(false)
  })
})
