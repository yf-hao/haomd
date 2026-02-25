import { useRef, useState, useEffect } from 'react'
import type { PDFDocumentProxy } from '../hooks/usePdfDocument'
import { usePdfDocument } from '../hooks/usePdfDocument'
import { useVirtualPages } from '../hooks/useVirtualPages'
import { PdfPage } from './PdfPage'

export interface PdfViewerProps {
  filePath: string
  onClose?: () => void
}

export function PdfViewer({ filePath }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
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

  const handleZoomIn = () => {
    setScale((prev) => {
      const next = Math.min(ZOOM_MAX, prev + ZOOM_STEP)
      const el = containerRef.current
      if (el) el.scrollTop = 0
      return next
    })
  }

  const handleZoomOut = () => {
    setScale((prev) => {
      const next = Math.max(ZOOM_MIN, prev - ZOOM_STEP)
      const el = containerRef.current
      if (el) el.scrollTop = 0
      return next
    })
  }

  const handleZoomReset = () => {
    setScale(1.0)
    const el = containerRef.current
    if (el) el.scrollTop = 0
  }

  const handleZoomFitWidth = () => {
    const el = containerRef.current
    if (!el || !basePageWidth) return

    // 可用内容宽度：减去左右 padding（与 .pdf-scroll-container 的 16px 对应）
    const horizontalPadding = 32
    const availableWidth = el.clientWidth - horizontalPadding
    if (availableWidth <= 0) return

    const fitScale = availableWidth / basePageWidth
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, fitScale))
    setScale(clamped)
    el.scrollTop = 0
  }

  // 当文档或总页数变化时，确保当前页在合法范围内
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

  // 计算 PDF 原始尺寸（scale = 1 时的宽高），用于“适配宽度”缩放和多页高度估算
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!pdfDocument) return
      try {
        const page = await (pdfDocument as PDFDocumentProxy).getPage(1)
        if (cancelled) return
        const viewport = page.getViewport({ scale: 1 })
        setBasePageWidth(viewport.width)
        setBasePageHeight(viewport.height)
      } catch (e) {
        console.error('[PdfViewer] failed to compute base page size', e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pdfDocument])

  const goToPage = (page: number, estimatedPageHeight?: number) => {
    if (!pageCount || pageCount <= 0) return
    const clamped = Math.min(Math.max(page, 1), pageCount)
    setCurrentPage(clamped)
    setPageInput(String(clamped))

    const el = containerRef.current
    if (el && estimatedPageHeight && estimatedPageHeight > 0) {
      // 多页模式下，根据估算高度滚动到对应页的大致位置
      el.scrollTop = (clamped - 1) * estimatedPageHeight
    } else if (el) {
      // 兜底：单页模式或高度未知时，仍然滚动到顶部
      el.scrollTop = 0
    }
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

  // 估算单页高度（基于首屏 viewport 高度和当前 scale），供多页虚拟滚动使用
  const pageHeightForVirtual = Math.max(1, (basePageHeight ?? 800) * scale)

  const { nearbyRange, totalHeight, onScroll: handleVirtualScroll } = useVirtualPages({
    pageCount,
    pageHeight: pageHeightForVirtual,
    containerRef,
    bufferPages: 2,
  })

  const handleScroll: React.UIEventHandler<HTMLDivElement> = (e) => {
    handleVirtualScroll()

    const container = e.currentTarget
    if (!pageCount || pageHeightForVirtual <= 0) return

    const scrollTop = container.scrollTop
    const approxIndex = Math.round(scrollTop / pageHeightForVirtual)
    const nextPage = Math.min(pageCount, Math.max(1, approxIndex + 1))

    if (nextPage !== currentPage) {
      setCurrentPage(nextPage)
      setPageInput(String(nextPage))
    }
  }

  const pages: JSX.Element[] = []
  const startIndex = nearbyRange.start
  const endIndex = nearbyRange.end

  if (pdfDocument && pageCount > 0) {
    for (let index = startIndex; index < endIndex; index += 1) {
      const pageNumber = index + 1
      if (pageNumber > pageCount) break

      pages.push(
        <div
          key={pageNumber}
          style={{
            position: 'absolute',
            top: index * pageHeightForVirtual,
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <PdfPage pdfDocument={pdfDocument as PDFDocumentProxy} pageNumber={pageNumber} scale={scale} />
        </div>,
      )
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
        <div ref={containerRef} className="pdf-scroll-container" onScroll={handleScroll}>
          <div
            style={{
              position: 'relative',
              height: totalHeight || pageHeightForVirtual,
            }}
          >
            {pages}
          </div>
        </div>
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
