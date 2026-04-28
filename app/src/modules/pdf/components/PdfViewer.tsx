import { useRef, useState, useEffect } from 'react'
import type { PDFDocumentProxy } from '../hooks/usePdfDocument'
import { usePdfDocument } from '../hooks/usePdfDocument'
import { PdfViewport, type PdfViewportHandle } from './PdfViewport'

type PdfReadingState = {
  page: number
  scale: number
}

const PDF_CSS_UNITS = 96 / 72

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
  const viewportRef = useRef<PdfViewportHandle | null>(null)
  const [scale, setScale] = useState(1.25)
  const { pdfDocument, pageCount, loading, error } = usePdfDocument(filePath)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const [basePageWidth, setBasePageWidth] = useState<number | null>(null)
  const [basePageHeight, setBasePageHeight] = useState<number | null>(null)

  const ZOOM_MIN = 0.5
  const ZOOM_MAX = 3
  const ZOOM_STEP = 0.25
  const zoomPercent = Math.round(scale * 100)

  const scrollToPageWithScale = (page: number, scaleForScroll: number) => {
    const baseHeight = basePageHeight ?? 800
    const estimatedPageHeight = Math.max(1, baseHeight * scaleForScroll)
    viewportRef.current?.scrollToPage(page, estimatedPageHeight)
  }

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
  }, [pdfDocument, pageCount, filePath, basePageHeight, basePageWidth])

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
      <div className="pdf-viewer-main">
        <PdfViewport
          ref={viewportRef}
          pdfDocument={pdfDocument as PDFDocumentProxy}
          pageCount={pageCount}
          scale={scale}
          pageHeight={pageHeightForVirtual}
          currentPage={currentPage}
          onCurrentPageChange={(page) => {
            setCurrentPage(page)
            setPageInput(String(page))
          }}
          onRegisterSelectionGetter={onRegisterSelectionGetter}
        />
      </div>
      <div className="pdf-viewer-sidebar">
        <div className="pdf-toolbar">
          <div className="pdf-toolbar-section pdf-toolbar-pages">
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
          </div>

          <div className="pdf-toolbar-separator" />

          <div className="pdf-toolbar-section pdf-toolbar-zoom">
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
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
