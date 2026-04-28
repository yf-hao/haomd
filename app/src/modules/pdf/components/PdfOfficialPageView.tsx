import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from '../hooks/usePdfDocument'
import { EventBus, PDFLinkService, PDFPageView } from 'pdfjs-dist/web/pdf_viewer.mjs'
import 'pdfjs-dist/web/pdf_viewer.css'

export interface PdfOfficialPageViewProps {
  pdfDocument: PDFDocumentProxy
  pageNumber: number
  scale: number
}

type SelectionBlock = {
  left: number
  top: number
  width: number
  height: number
}

function mergeSelectionRects(rects: SelectionBlock[]): SelectionBlock[] {
  if (rects.length === 0) return []

  const sorted = [...rects].sort((a, b) => {
    if (Math.abs(a.top - b.top) > 2) return a.top - b.top
    return a.left - b.left
  })

  const merged: SelectionBlock[] = []
  const lineThreshold = 3
  const horizontalGap = 8

  for (const rect of sorted) {
    const last = merged[merged.length - 1]
    if (!last) {
      merged.push(rect)
      continue
    }

    const sameLine = Math.abs(last.top - rect.top) <= lineThreshold
    const closeEnough = rect.left <= last.left + last.width + horizontalGap

    if (sameLine && closeEnough) {
      const right = Math.max(last.left + last.width, rect.left + rect.width)
      last.top = Math.min(last.top, rect.top)
      last.height = Math.max(last.height, rect.height)
      last.width = right - last.left
      continue
    }

    merged.push(rect)
  }

  return merged
}

/**
 * 官方单页页视图。
 *
 * 基于 pdf.js 的 PDFPageView，负责：
 * - canvas 渲染
 * - 官方 text layer
 * - annotation layer
 *
 * 当前仍保持最小接法，不接 PDFViewer 整体体系。
 */
export function PdfOfficialPageView({
  pdfDocument,
  pageNumber,
  scale,
}: PdfOfficialPageViewProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const pageHostRef = useRef<HTMLDivElement | null>(null)
  const [selectionBlocks, setSelectionBlocks] = useState<SelectionBlock[]>([])

  useEffect(() => {
    const container = pageHostRef.current
    if (!container) return

    let cancelled = false
    let pageView: PDFPageView | null = null

    const render = async () => {
      try {
        const page = await pdfDocument.getPage(pageNumber)
        if (cancelled) return

        const eventBus = new EventBus()
        const linkService = new PDFLinkService({ eventBus })
        linkService.setDocument(pdfDocument, null)
        linkService.setViewer({
          currentPageNumber: pageNumber,
          currentScale: scale,
          pagesCount: pdfDocument.numPages ?? 0,
        } as never)

        const viewport = page.getViewport({ scale: 1 })

        pageView = new PDFPageView({
          container,
          eventBus,
          id: pageNumber,
          scale,
          defaultViewport: viewport,
          textLayerMode: 1,
        })

        pageView.setPdfPage(page)
        await pageView.draw()
      } catch (e) {
        if (!cancelled) {
          console.error('[PdfOfficialPageView] failed to render page view', e)
        }
      }
    }

    container.replaceChildren()
    void render()

    return () => {
      cancelled = true
      pageView?.destroy()
      container.replaceChildren()
    }
  }, [pdfDocument, pageNumber, scale])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    let frame = 0

    const updateSelectionBlocks = () => {
      frame = 0

      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        setSelectionBlocks([])
        return
      }

      const pageEl = root.querySelector('.page') as HTMLElement | null
      if (!pageEl) {
        setSelectionBlocks([])
        return
      }

      const anchorNode = selection.anchorNode
      const focusNode = selection.focusNode
      if ((!anchorNode || !root.contains(anchorNode)) && (!focusNode || !root.contains(focusNode))) {
        setSelectionBlocks([])
        return
      }

      const pageRect = pageEl.getBoundingClientRect()
      const rawRects = Array.from(selection.getRangeAt(0).getClientRects())
      const blocks = rawRects
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => {
          const left = Math.max(rect.left, pageRect.left)
          const top = Math.max(rect.top, pageRect.top)
          const right = Math.min(rect.right, pageRect.right)
          const bottom = Math.min(rect.bottom, pageRect.bottom)
          return {
            left: left - pageRect.left,
            top: top - pageRect.top,
            width: Math.max(0, right - left),
            height: Math.max(0, bottom - top),
          }
        })
        .filter((rect) => rect.width > 0 && rect.height > 0)

      setSelectionBlocks(mergeSelectionRects(blocks))
    }

    const scheduleUpdate = () => {
      if (frame) return
      frame = window.requestAnimationFrame(updateSelectionBlocks)
    }

    document.addEventListener('selectionchange', scheduleUpdate)
    scheduleUpdate()

    return () => {
      document.removeEventListener('selectionchange', scheduleUpdate)
      if (frame) {
        window.cancelAnimationFrame(frame)
      }
    }
  }, [pdfDocument, pageNumber, scale])

  return (
    <div
      ref={rootRef}
      className="pdf-official-page-view pdfViewer"
      style={{ '--scale-factor': String(scale) } as React.CSSProperties}
    >
      <div ref={pageHostRef} className="pdf-official-page-host" />
      <div className="pdf-selection-overlay" aria-hidden="true">
        {selectionBlocks.map((block, index) => (
          <div
            key={`${pageNumber}-${index}`}
            className="pdf-selection-block"
            style={{
              left: block.left,
              top: block.top,
              width: block.width,
              height: block.height,
            }}
          />
        ))}
      </div>
    </div>
  )
}
