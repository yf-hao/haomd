import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from '../hooks/usePdfDocument'
import { renderPage } from '../utils/pdfRender'
import { PdfTextLayer } from './PdfTextLayer'

export interface PdfPageProps {
  pdfDocument: PDFDocumentProxy
  pageNumber: number
  scale: number
  style?: React.CSSProperties
}

export function PdfPage({ pdfDocument, pageNumber, scale, style }: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 })

  // 确保同一 canvas 上的渲染顺序执行，避免 PDF.js 抛出并发渲染错误
  const renderLockRef = useRef<Promise<void> | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let cancelled = false

    const render = async () => {
      // 等待前一次渲染完成，避免在同一 canvas 上并发调用 render()
      const prev = renderLockRef.current
      if (prev) {
        try {
          await prev
        } catch {
          // 忽略上一轮渲染的错误，当前渲染继续执行
        }
      }

      if (cancelled) return

      const current = (async () => {
        const result = await renderPage({ pdfDocument, pageNumber, scale, canvas })
        if (!cancelled) {
          setSize({ width: result.width, height: result.height })
        }
      })()

      renderLockRef.current = current

      try {
        await current
      } catch (e) {
        if (!cancelled) {
          console.error('[PdfPage] render failed', e)
        }
      }
    }

    void render()

    return () => {
      cancelled = true
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
      }
    }
  }, [pdfDocument, pageNumber, scale])

  return (
    <div
      className="pdf-page"
      style={{
        position: 'relative',
        width: size.width,
        height: size.height,
        ...style,
      }}
    >
      {/* 底层：位图渲染层 */}
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />

      {/* 叠加：文本层，用于选择/复制（与 canvas 完全重叠） */}
      <PdfTextLayer pdfDocument={pdfDocument} pageNumber={pageNumber} scale={scale} />
    </div>
  )
}
