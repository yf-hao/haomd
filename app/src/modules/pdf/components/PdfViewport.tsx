import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type UIEventHandler,
} from 'react'
import type { PDFDocumentProxy } from '../hooks/usePdfDocument'
import type { PdfSelectionDraft } from '../annotationUtils'
import type { Annotation } from '../types/annotation'
import { useVirtualPages } from '../hooks/useVirtualPages'
import { PdfOfficialPageView } from './PdfOfficialPageView'

export interface PdfViewportHandle {
  scrollToPage: (page: number, estimatedPageHeight?: number) => void
  getContainerWidth: () => number | null
}

export interface PdfViewportProps {
  pdfDocument: PDFDocumentProxy
  pageCount: number
  scale: number
  pageHeight: number
  currentPage: number
  onCurrentPageChange: (page: number) => void
  onRegisterSelectionGetter?: (getter: (() => string | null) | null) => void
  annotations?: Annotation[]
  onSelectionChange?: (selection: PdfSelectionDraft | null) => void
}

export const PdfViewport = forwardRef<PdfViewportHandle, PdfViewportProps>(function PdfViewport(
  {
    pdfDocument,
    pageCount,
    scale,
    pageHeight,
    currentPage,
    onCurrentPageChange,
    onRegisterSelectionGetter,
    annotations = [],
    onSelectionChange,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useImperativeHandle(
    ref,
    () => ({
      scrollToPage(page, estimatedPageHeight) {
        const container = containerRef.current
        if (!container) return
        const nextPageHeight = Math.max(1, estimatedPageHeight ?? pageHeight)
        container.scrollTop = (page - 1) * nextPageHeight
      },
      getContainerWidth() {
        return containerRef.current?.clientWidth ?? null
      },
    }),
    [pageHeight],
  )

  const getCurrentSelectionText = () => {
    if (typeof window === 'undefined') return null
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) return null

    const container = containerRef.current
    if (!container) return null

    const isInContainer = (node: Node | null) => !!node && container.contains(node)
    if (!isInContainer(sel.anchorNode) && !isInContainer(sel.focusNode)) return null

    const text = sel.toString().trim()
    return text || null
  }

  useEffect(() => {
    if (!onRegisterSelectionGetter) return
    onRegisterSelectionGetter(() => getCurrentSelectionText())
    return () => {
      onRegisterSelectionGetter(null)
    }
  }, [onRegisterSelectionGetter, pdfDocument, pageCount, scale, pageHeight])

  const { nearbyRange, totalHeight, onScroll: handleVirtualScroll } = useVirtualPages({
    pageCount,
    pageHeight,
    containerRef,
    bufferPages: 2,
  })

  const handleScroll: UIEventHandler<HTMLDivElement> = (e) => {
    handleVirtualScroll()

    const container = e.currentTarget
    if (!pageCount || pageHeight <= 0) return

    const scrollTop = container.scrollTop
    const approxIndex = Math.round(scrollTop / pageHeight)
    const nextPage = Math.min(pageCount, Math.max(1, approxIndex + 1))

    if (nextPage !== currentPage) {
      onCurrentPageChange(nextPage)
    }
  }

  const pages = []
  for (let index = nearbyRange.start; index < nearbyRange.end; index += 1) {
    const pageNumber = index + 1
    if (pageNumber > pageCount) break

    pages.push(
      <div
        key={pageNumber}
        className="pdf-page-slot"
        style={{
          position: 'absolute',
          top: index * pageHeight,
          left: '50%',
          transform: 'translateX(-50%)',
        }}
      >
        <PdfOfficialPageView
          pdfDocument={pdfDocument}
          pageNumber={pageNumber}
          scale={scale}
          annotations={annotations.filter((annotation) => annotation.page === pageNumber)}
          onSelectionChange={onSelectionChange}
        />
      </div>,
    )
  }

  return (
    <div
      ref={containerRef}
      className="pdf-scroll-container"
      onScroll={handleScroll}
    >
      <div
        style={{
          position: 'relative',
          height: totalHeight || pageHeight,
        }}
      >
        {pages}
      </div>
    </div>
  )
})
