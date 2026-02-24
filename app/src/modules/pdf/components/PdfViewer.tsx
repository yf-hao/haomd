import { useRef, useState, type ReactElement } from 'react'
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
  const [scale] = useState(1.25)

  const { pdfDocument, pageCount, loading, error } = usePdfDocument(filePath)

  const { visibleRange, onScroll, totalHeight } = useVirtualPages({
    pageCount,
    pageHeight: 800 * scale,
    containerRef,
    bufferSize: 2,
  })

  if (loading) {
    return <div className="pdf-viewer">正在加载 PDF…</div>
  }

  if (error) {
    return <div className="pdf-viewer">{error}</div>
  }

  if (!pdfDocument || pageCount === 0) {
    return <div className="pdf-viewer">未加载 PDF 文档</div>
  }

  const pages: ReactElement[] = []
  for (let i = visibleRange.start; i < visibleRange.end; i += 1) {
    const pageNumber = i + 1
    if (pageNumber < 1 || pageNumber > pageCount) continue
    const top = i * 800 * scale
    pages.push(
      <PdfPage
        key={pageNumber}
        pdfDocument={pdfDocument as PDFDocumentProxy}
        pageNumber={pageNumber}
        scale={scale}
        style={{ top }}
      />,
    )
  }

  return (
    <div className="pdf-viewer">
      <div
        ref={containerRef}
        className="pdf-scroll-container"
        onScroll={onScroll}
      >
        <div style={{ height: totalHeight, position: 'relative' }}>{pages}</div>
      </div>
    </div>
  )
}
