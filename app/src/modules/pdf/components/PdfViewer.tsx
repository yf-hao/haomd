import { useRef, useState, useEffect, useCallback } from 'react'
import type { PDFDocumentProxy } from '../hooks/usePdfDocument'
import { usePdfDocument } from '../hooks/usePdfDocument'
import { PdfViewport, type PdfViewportHandle } from './PdfViewport'
import { PdfAnnotationPanel } from './PdfAnnotationPanel'
import { useI18n } from '../../i18n/I18nContext'
import { isTauriEnv } from '../../platform/runtime'
import { appendAnnotation, createTextMarkupAnnotation, getPdfFileName, normalizeDocumentAnnotations, type PdfSelectionDraft } from '../annotationUtils'
import { computePdfHash, loadAnnotations, saveAnnotations } from '../store/annotationStore'
import type { Annotation, DocumentAnnotations } from '../types/annotation'
import type { AnnotationType } from '../types/annotation'

type PdfReadingState = {
  page: number
  scale: number
}

const PDF_CSS_UNITS = 96 / 72
const HIGHLIGHT_COLOR_OPTIONS = [
  { value: '#f5d90a', key: 'yellow' },
  { value: '#7ccf00', key: 'green' },
  { value: '#4da3ff', key: 'blue' },
  { value: '#ff8a4c', key: 'orange' },
  { value: '#f06292', key: 'pink' },
] as const

const TEXT_MARKUP_TOOL_OPTIONS = [
  { type: 'highlight', labelKey: 'pdf.annotationTypes.highlight' },
  { type: 'underline', labelKey: 'pdf.annotationTypes.underline' },
  { type: 'strikeout', labelKey: 'pdf.annotationTypes.strikeout' },
  { type: 'squiggly', labelKey: 'pdf.annotationTypes.squiggly' },
] as const satisfies ReadonlyArray<{
  type: Extract<AnnotationType, 'highlight' | 'underline' | 'strikeout' | 'squiggly'>
  labelKey: string
}>

function renderMarkupToolIcon(
  type: Extract<AnnotationType, 'highlight' | 'underline' | 'strikeout' | 'squiggly'>,
) {
  switch (type) {
    case 'highlight':
      return (
        <svg className="pdf-markup-tool-icon" viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M10 3.2C6.1 3.2 3 6 3 9.8C3 13.4 5.8 16 9.1 16H10.7C11.4 16 11.9 15.4 11.9 14.8C11.9 14.3 11.6 13.9 11.6 13.5C11.6 12.8 12.2 12.4 12.9 12.4H13.8C16.1 12.4 17.8 10.8 17.8 8.6C17.8 5.4 14.7 3.2 10 3.2Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="7" cy="8.1" r="1" fill="currentColor" />
          <circle cx="9.8" cy="6.9" r="1" fill="currentColor" />
          <circle cx="12.7" cy="8" r="1" fill="currentColor" />
          <circle cx="8.6" cy="10.9" r="1" fill="currentColor" />
        </svg>
      )
    case 'underline':
      return (
        <svg className="pdf-markup-tool-icon" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M6.2 5.5V10C6.2 12.1 7.8 13.7 10 13.7C12.2 13.7 13.8 12.1 13.8 10V5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M5 16H15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      )
    case 'strikeout':
      return (
        <svg className="pdf-markup-tool-icon" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M5 7.2C5 5.8 6.2 4.8 8 4.8H12C13.8 4.8 15 5.8 15 7.2C15 8.7 13.7 9.4 12.3 9.8L7.7 11.1C6.3 11.5 5 12.2 5 13.6C5 15 6.2 16 8 16H12C13.8 16 15 15 15 13.6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4.5 10H15.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      )
    case 'squiggly':
      return (
        <svg className="pdf-markup-tool-icon" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M4 12Q5.5 9.2 7 12T10 12T13 12T16 12" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
  }
}

function getPdfStateKey(filePath: string) {
  return `pdf-reading-state:${filePath}`
}

function loadPdfReadingState(filePath: string): PdfReadingState | null {
  if (typeof window === 'undefined') return null
  try {
    const key = getPdfStateKey(filePath)
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PdfReadingState
    if (typeof parsed.page === 'number' && typeof parsed.scale === 'number') {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

function savePdfReadingState(filePath: string, state: PdfReadingState) {
  if (typeof window === 'undefined') return
  try {
    const key = getPdfStateKey(filePath)
    window.localStorage.setItem(key, JSON.stringify(state))
  } catch {
    // ignore
  }
}

export interface PdfViewerProps {
  filePath: string
  onClose?: () => void
  onRegisterSelectionGetter?: (getter: (() => string | null) | null) => void
}

export function PdfViewer({ filePath, onRegisterSelectionGetter }: PdfViewerProps) {
  const { t } = useI18n()
  const viewportRef = useRef<PdfViewportHandle | null>(null)
  const selectionDraftRef = useRef<PdfSelectionDraft | null>(null)
  const [scale, setScale] = useState(1.25)
  const { pdfDocument, pageCount, loading, error } = usePdfDocument(filePath)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const [basePageWidth, setBasePageWidth] = useState<number | null>(null)
  const [basePageHeight, setBasePageHeight] = useState<number | null>(null)
  const [annotationDocument, setAnnotationDocument] = useState<DocumentAnnotations | null>(null)
  const [, setSelectionDraft] = useState<PdfSelectionDraft | null>(null)
  const [annotationMessage, setAnnotationMessage] = useState<string | null>(null)
  const [isAnnotationBusy, setAnnotationBusy] = useState(false)
  const [selectedHighlightColor, setSelectedHighlightColor] = useState<string>(HIGHLIGHT_COLOR_OPTIONS[0].value)
  const [activeMarkupTool, setActiveMarkupTool] = useState<Extract<AnnotationType, 'highlight' | 'underline' | 'strikeout' | 'squiggly'> | null>(null)
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null)
  const [annotationPanelOpen, setAnnotationPanelOpen] = useState(true)
  const [clearSelectionSignal, setClearSelectionSignal] = useState(0)

  const ZOOM_MIN = 0.5
  const ZOOM_MAX = 3
  const ZOOM_STEP = 0.25
  const zoomPercent = Math.round(scale * 100)

  const scrollToPageWithScale = useCallback((page: number, scaleForScroll: number) => {
    const baseHeight = basePageHeight ?? 800
    const estimatedPageHeight = Math.max(1, baseHeight * scaleForScroll)
    viewportRef.current?.scrollToPage(page, estimatedPageHeight)
  }, [basePageHeight])

  const handleZoomIn = () => {
    setScale((prev) => {
      const next = Math.min(ZOOM_MAX, prev + ZOOM_STEP)
      scrollToPageWithScale(currentPage, next)
      return next
    })
  }

  const handleZoomOut = () => {
    setScale((prev) => {
      const next = Math.max(ZOOM_MIN, prev - ZOOM_STEP)
      scrollToPageWithScale(currentPage, next)
      return next
    })
  }

  const handleZoomReset = () => {
    const next = 1.0
    setScale(next)
    scrollToPageWithScale(currentPage, next)
  }

  const handleZoomFitWidth = () => {
    const containerWidth = viewportRef.current?.getContainerWidth()
    if (!containerWidth || !basePageWidth) return

    const horizontalPadding = 32
    const availableWidth = containerWidth - horizontalPadding
    if (availableWidth <= 0) return

    const fitScale = availableWidth / basePageWidth
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, fitScale))

    setScale(clamped)
    scrollToPageWithScale(currentPage, clamped)
  }

  useEffect(() => {
    if (!pageCount || pageCount <= 0) {
      setCurrentPage(1)
      setPageInput('1')
      return
    }
    if (currentPage > pageCount) {
      setCurrentPage(pageCount)
      setPageInput(String(pageCount))
    }
  }, [pageCount, currentPage])

  useEffect(() => {
    if (!pdfDocument || !pageCount || pageCount <= 0) return

    const saved = loadPdfReadingState(filePath)

    if (saved) {
      const clampedPage = Math.min(Math.max(saved.page, 1), pageCount)
      const clampedScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, saved.scale))

      setScale(clampedScale)
      setCurrentPage(clampedPage)
      setPageInput(String(clampedPage))
      scrollToPageWithScale(clampedPage, clampedScale)
      return
    }

    const containerWidth = viewportRef.current?.getContainerWidth()
    if (!containerWidth || !basePageWidth) return

    const horizontalPadding = 32
    const availableWidth = containerWidth - horizontalPadding
    if (availableWidth <= 0) return

    const fitScale = availableWidth / basePageWidth
    const clampedFit = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, fitScale))

    setScale(clampedFit)
    setCurrentPage(1)
    setPageInput('1')
    scrollToPageWithScale(1, clampedFit)
  }, [pdfDocument, pageCount, filePath, basePageHeight, basePageWidth, scrollToPageWithScale])

  useEffect(() => {
    if (!pageCount || pageCount <= 0) return

    const handle = window.setTimeout(() => {
      savePdfReadingState(filePath, {
        page: currentPage,
        scale,
      })
    }, 300)

    return () => {
      window.clearTimeout(handle)
    }
  }, [filePath, currentPage, scale, pageCount])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!pdfDocument) return
      try {
        const page = await (pdfDocument as PDFDocumentProxy).getPage(1)
        if (cancelled) return
        const viewport = page.getViewport({ scale: 1 })
        setBasePageWidth(viewport.width * PDF_CSS_UNITS)
        setBasePageHeight(viewport.height * PDF_CSS_UNITS)
      } catch (e) {
        console.error('[PdfViewer] failed to compute base page size', e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pdfDocument])

  useEffect(() => {
    if (!pdfDocument || pageCount <= 0) {
      setAnnotationDocument(null)
      setSelectionDraft(null)
      selectionDraftRef.current = null
      setActiveMarkupTool(null)
      setAnnotationMessage(null)
      setAnnotationBusy(false)
      setSelectedAnnotationId(null)
      return
    }

    let cancelled = false

    const loadDocumentAnnotations = async () => {
      setAnnotationBusy(true)
      setAnnotationMessage(t('pdf.loadingAnnotations'))

      try {
        const pdfHash = isTauriEnv() ? await computePdfHash(filePath) : `web:${filePath}`
        if (cancelled) return
        const stored = await loadAnnotations(pdfHash)
        if (cancelled) return
        setAnnotationDocument(
          normalizeDocumentAnnotations(stored, pdfHash, getPdfFileName(filePath), pageCount),
        )
        setAnnotationMessage(null)
        setSelectedAnnotationId(null)
      } catch (loadError) {
        if (cancelled) return
        const message = loadError instanceof Error ? loadError.message : String(loadError)
        setAnnotationDocument(null)
        setAnnotationMessage(t('pdf.annotationLoadFailed', { message }))
        setSelectedAnnotationId(null)
      } finally {
        if (!cancelled) {
          setAnnotationBusy(false)
        }
      }
    }

    void loadDocumentAnnotations()

    return () => {
      cancelled = true
    }
  }, [filePath, pageCount, pdfDocument, t])

  const pageHeightForVirtual = Math.max(1, (basePageHeight ?? 800) * scale)

  const goToPage = (page: number, estimatedPageHeight?: number) => {
    if (!pageCount || pageCount <= 0) return
    const clamped = Math.min(Math.max(page, 1), pageCount)
    setCurrentPage(clamped)
    setPageInput(String(clamped))
    viewportRef.current?.scrollToPage(clamped, estimatedPageHeight)
  }

  const handlePrev = () => {
    goToPage(currentPage - 1, pageHeightForVirtual)
  }

  const handleNext = () => {
    goToPage(currentPage + 1, pageHeightForVirtual)
  }

  const handlePageInputChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    setPageInput(e.target.value.replace(/[^0-9]/g, ''))
  }

  const handlePageInputCommit = () => {
    if (!pageInput) {
      setPageInput(String(currentPage))
      return
    }
    const num = Number(pageInput)
    if (!Number.isFinite(num) || num <= 0) {
      setPageInput(String(currentPage))
      return
    }
    goToPage(num, pageHeightForVirtual)
  }

  const handlePageInputBlur = () => {
    handlePageInputCommit()
  }

  const handlePageInputKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handlePageInputCommit()
    }
  }

  const handleAddHighlight = async (
    type: Extract<AnnotationType, 'highlight' | 'underline' | 'strikeout' | 'squiggly'> = activeMarkupTool ?? 'highlight',
    color = selectedHighlightColor,
    draft = selectionDraftRef.current,
  ) => {
    const currentSelectionDraft = draft
    if (!annotationDocument || !currentSelectionDraft) return

    setSelectionDraft(null)
    selectionDraftRef.current = null
    setSelectedAnnotationId(null)
    setClearSelectionSignal((prev) => prev + 1)
    if (typeof window !== 'undefined') {
      window.getSelection()?.removeAllRanges()
    }

    setAnnotationBusy(true)
    setAnnotationMessage(t('pdf.savingAnnotation'))

    const nextDocument = appendAnnotation(
      annotationDocument,
      createTextMarkupAnnotation(currentSelectionDraft, type, color),
    )

    try {
      await saveAnnotations(nextDocument.pdfHash, nextDocument)
      setAnnotationDocument(nextDocument)
      setAnnotationMessage(null)
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError)
      setAnnotationMessage(t('pdf.annotationSaveFailed', { message }))
    } finally {
      setAnnotationBusy(false)
    }
  }

  const handleDeleteHighlight = async () => {
    if (!annotationDocument || !selectedAnnotationId) return

    setAnnotationBusy(true)
    setAnnotationMessage(t('pdf.savingAnnotation'))

    const nextDocument = {
      ...annotationDocument,
      annotations: annotationDocument.annotations.filter((annotation) => annotation.id !== selectedAnnotationId),
      lastModified: Date.now(),
    }

    try {
      await saveAnnotations(nextDocument.pdfHash, nextDocument)
      setAnnotationDocument(nextDocument)
      setSelectedAnnotationId(null)
      setAnnotationMessage(null)
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError)
      setAnnotationMessage(t('pdf.annotationSaveFailed', { message }))
    } finally {
      setAnnotationBusy(false)
    }
  }

  const handleAnnotationItemClick = (annotation: Annotation) => {
    setSelectedAnnotationId(annotation.id)
    setSelectionDraft(null)
    selectionDraftRef.current = null
    if (typeof window !== 'undefined') {
      window.getSelection()?.removeAllRanges()
    }
    goToPage(annotation.page, pageHeightForVirtual)

    const firstRect = annotation.rects[0]
    if (!firstRect || typeof window === 'undefined') return

    const adjustToRenderedPosition = () => {
      const metrics = viewportRef.current?.getRenderedPageMetrics(annotation.page)
      if (!metrics) return
      const topPadding = 24
      const absoluteOffset = Math.max(
        0,
        metrics.top + firstRect.y1 * metrics.height - topPadding,
      )
      viewportRef.current?.scrollToOffset(absoluteOffset)
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        adjustToRenderedPosition()
      })
    })
  }

  useEffect(() => {
    if (!selectedAnnotationId) return

    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false
      if (target.isContentEditable) return true
      const tag = target.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isAnnotationBusy) return
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      if (isEditableTarget(event.target)) return

      event.preventDefault()
      void handleDeleteHighlight()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [selectedAnnotationId, isAnnotationBusy, handleDeleteHighlight])

  if (loading) {
    return <div className="pdf-viewer">正在加载 PDF…</div>
  }

  if (error) {
    return <div className="pdf-viewer">{error}</div>
  }

  if (!pdfDocument || pageCount === 0) {
    return <div className="pdf-viewer">未加载 PDF 文档</div>
  }

  return (
    <div className="pdf-viewer">
      <div className="pdf-viewer-sidebar">
        <div className="pdf-toolbar">
          <div className="pdf-toolbar-group pdf-toolbar-group-annotations">
            <div className="pdf-toolbar-section pdf-toolbar-annotations">
              <div className="pdf-highlight-color-row" aria-label={t('pdf.highlightColor')}>
                <button
                  type="button"
                  className={`pdf-highlight-tool-btn ${activeMarkupTool === null ? 'active' : ''}`}
                  onMouseDown={(event) => {
                    event.preventDefault()
                  }}
                  onClick={() => {
                    setActiveMarkupTool(null)
                  }}
                  aria-label={t('pdf.selectTextOnly')}
                  aria-pressed={activeMarkupTool === null}
                  title={t('pdf.selectTextOnly')}
                >
                  <svg
                    className="pdf-highlight-tool-arrow"
                    viewBox="0 0 16 16"
                    aria-hidden="true"
                  >
                    <path
                      d="M3 2.5L12.5 8L7.2 8.8L10 14L8.2 14.8L5.5 9.6L3 13V2.5Z"
                      fill="currentColor"
                    />
                  </svg>
                </button>
                {TEXT_MARKUP_TOOL_OPTIONS.map((option) => (
                  <button
                    key={option.type}
                    type="button"
                    className={`pdf-highlight-tool-btn ${activeMarkupTool === option.type ? 'active' : ''}`}
                    onMouseDown={(event) => {
                      event.preventDefault()
                    }}
                    onClick={() => {
                      setActiveMarkupTool(option.type)
                      if (selectionDraftRef.current && annotationDocument && !isAnnotationBusy) {
                        void handleAddHighlight(option.type, selectedHighlightColor)
                      }
                    }}
                    aria-label={t(option.labelKey)}
                    aria-pressed={activeMarkupTool === option.type}
                    title={t(option.labelKey)}
                  >
                    {renderMarkupToolIcon(option.type)}
                  </button>
                ))}
                {HIGHLIGHT_COLOR_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`pdf-highlight-color-swatch ${selectedHighlightColor === option.value && activeMarkupTool === 'highlight' ? 'active' : ''}`}
                    style={{ '--pdf-highlight-color': option.value } as React.CSSProperties}
                    onMouseDown={(event) => {
                      event.preventDefault()
                    }}
                    onClick={() => {
                      setSelectedHighlightColor(option.value)
                      if (selectionDraftRef.current && annotationDocument && !isAnnotationBusy) {
                        if (activeMarkupTool === null) {
                          return
                        }
                        void handleAddHighlight(activeMarkupTool, option.value)
                      }
                    }}
                    aria-label={t(`pdf.highlightColors.${option.key}`)}
                    aria-pressed={selectedHighlightColor === option.value && activeMarkupTool === 'highlight'}
                    title={t(`pdf.highlightColors.${option.key}`)}
                  />
                ))}
              </div>
              <button
                type="button"
                className={`pdf-highlight-color-swatch pdf-highlight-color-swatch-delete ${selectedAnnotationId ? 'active' : ''}`}
                onMouseDown={(event) => {
                  event.preventDefault()
                }}
                onClick={() => {
                  void handleDeleteHighlight()
                }}
                disabled={!selectedAnnotationId || isAnnotationBusy}
                aria-label={
                  selectedAnnotationId
                    ? t('pdf.deleteHighlight')
                    : t('pdf.deleteHighlightDisabled')
                }
                title={
                  selectedAnnotationId
                    ? t('pdf.deleteHighlight')
                    : t('pdf.deleteHighlightDisabled')
                }
              />
              {annotationMessage ? <div className="pdf-annotation-status">{annotationMessage}</div> : null}
            </div>
          </div>

          <div className="pdf-toolbar-group pdf-toolbar-group-controls">
            <div className="pdf-toolbar-section pdf-toolbar-controls">
              <div className="pdf-page-current-wrapper">
                <input
                  type="text"
                  className="pdf-page-input-pill"
                  value={pageInput}
                  onChange={handlePageInputChange}
                  onBlur={handlePageInputBlur}
                  onKeyDown={handlePageInputKeyDown}
                  inputMode="numeric"
                />
              </div>
              <div className="pdf-page-total-text">{pageCount}</div>
              <button
                type="button"
                className="pdf-icon-btn"
                onClick={handlePrev}
                disabled={currentPage <= 1}
                aria-label="上一页"
              >
                ▲
              </button>
              <button
                type="button"
                className="pdf-icon-btn"
                onClick={handleNext}
                disabled={currentPage >= pageCount}
                aria-label="下一页"
              >
                ▼
              </button>
              <button
                type="button"
                className="pdf-icon-btn pdf-icon-btn--zoom-reset"
                onClick={handleZoomReset}
                disabled={Math.abs(scale - 1) < 0.001}
                aria-label="恢复实际大小"
              >
                <span className="pdf-icon-glyph" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="pdf-icon-btn"
                onClick={handleZoomFitWidth}
                disabled={!basePageWidth}
                aria-label="适配宽度"
              >
                ⤢
              </button>
              <div className="pdf-zoom-percent">{zoomPercent}%</div>
              <div className="pdf-zoom-icon-row">
                <button
                  type="button"
                  className="pdf-icon-btn"
                  onClick={handleZoomIn}
                  disabled={scale >= ZOOM_MAX}
                  aria-label="放大"
                >
                  +
                </button>
                <button
                  type="button"
                  className="pdf-icon-btn"
                  onClick={handleZoomOut}
                  disabled={scale <= ZOOM_MIN}
                  aria-label="缩小"
                >
                  -
                </button>
                <button
                  type="button"
                  className={`pdf-icon-btn ${annotationPanelOpen ? 'active' : ''}`}
                  onClick={() => {
                    setAnnotationPanelOpen((prev) => !prev)
                  }}
                  aria-label={annotationPanelOpen ? t('pdf.hideAnnotationPanel') : t('pdf.showAnnotationPanel')}
                  title={annotationPanelOpen ? t('pdf.hideAnnotationPanel') : t('pdf.showAnnotationPanel')}
                >
                  ≣
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className={`pdf-viewer-content ${annotationPanelOpen ? '' : 'annotation-panel-collapsed'}`}>
        <div className="pdf-viewer-main">
          <PdfViewport
            ref={viewportRef}
            pdfDocument={pdfDocument as PDFDocumentProxy}
            pageCount={pageCount}
            scale={scale}
            pageHeight={pageHeightForVirtual}
            previewHighlightColor={selectedHighlightColor}
            clearSelectionSignal={clearSelectionSignal}
            currentPage={currentPage}
            onCurrentPageChange={(page) => {
              setCurrentPage(page)
              setPageInput(String(page))
            }}
            onRegisterSelectionGetter={onRegisterSelectionGetter}
            annotations={annotationDocument?.annotations ?? []}
            onSelectionChange={(selection) => {
              selectionDraftRef.current = selection
              setSelectionDraft(selection)
              if (selection) {
                setSelectedAnnotationId(null)
                if (activeMarkupTool && annotationDocument && !isAnnotationBusy) {
                  void handleAddHighlight(activeMarkupTool, selectedHighlightColor, selection)
                }
              }
            }}
            selectedAnnotationId={selectedAnnotationId}
            onAnnotationClick={(annotationId) => {
              setSelectedAnnotationId(annotationId)
              setSelectionDraft(null)
              selectionDraftRef.current = null
              if (typeof window !== 'undefined') {
                window.getSelection()?.removeAllRanges()
              }
            }}
            onClearAnnotationSelection={() => {
              setSelectedAnnotationId(null)
            }}
          />
        </div>
        {annotationPanelOpen && (
          <PdfAnnotationPanel
            annotations={annotationDocument?.annotations ?? []}
            selectedAnnotationId={selectedAnnotationId}
            onAnnotationClick={handleAnnotationItemClick}
          />
        )}
      </div>
    </div>
  )
}
