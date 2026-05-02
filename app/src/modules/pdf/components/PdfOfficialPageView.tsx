import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from '../hooks/usePdfDocument'
import { EventBus, PDFLinkService, PDFPageView } from 'pdfjs-dist/web/pdf_viewer.mjs'
import 'pdfjs-dist/web/pdf_viewer.css'
import {
  areSelectionBlocksEqual,
  buildSelectionBlocks,
  type RectLike,
  type SelectionBlock,
} from './pdfSelectionOverlay'
import { selectionBlocksToAnnotationRects, type PdfSelectionDraft } from '../annotationUtils'
import type { Annotation } from '../types/annotation'

export interface PdfOfficialPageViewProps {
  pdfDocument: PDFDocumentProxy
  pageNumber: number
  scale: number
  annotations?: Annotation[]
  onSelectionChange?: (selection: PdfSelectionDraft | null) => void
  selectedAnnotationId?: string | null
  onAnnotationClick?: (annotationId: string) => void
  onClearAnnotationSelection?: () => void
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
  annotations = [],
  onSelectionChange,
  selectedAnnotationId = null,
  onAnnotationClick,
  onClearAnnotationSelection,
}: PdfOfficialPageViewProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const pageHostRef = useRef<HTMLDivElement | null>(null)
  const textRectsRef = useRef<RectLike[]>([])
  const textRectsDirtyRef = useRef(true)
  const isPointerSelectionActiveRef = useRef(false)
  const hasActiveSelectionRef = useRef(false)
  const [selectionBlocks, setSelectionBlocks] = useState<SelectionBlock[]>([])

  const clearSelectionBlocks = () => {
    setSelectionBlocks((prev) => (prev.length === 0 ? prev : []))
  }

  const applySelectionBlocks = (nextBlocks: SelectionBlock[]) => {
    setSelectionBlocks((prev) => (areSelectionBlocksEqual(prev, nextBlocks) ? prev : nextBlocks))
  }

  const setPointerSelectingState = (active: boolean) => {
    isPointerSelectionActiveRef.current = active
    rootRef.current?.classList.toggle('is-pointer-selecting', active)
  }

  const invalidateCachedTextRects = () => {
    textRectsDirtyRef.current = true
  }

  const updateCachedTextRects = () => {
    const root = rootRef.current
    if (!root) return

    const pageEl = root.querySelector('.page') as HTMLElement | null
    if (!pageEl) {
      textRectsRef.current = []
      textRectsDirtyRef.current = false
      return
    }

    const pageRect = pageEl.getBoundingClientRect()
    textRectsRef.current = Array.from(root.querySelectorAll('.textLayer span'))
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({
        left: rect.left - pageRect.left,
        top: rect.top - pageRect.top,
        right: rect.right - pageRect.left,
        bottom: rect.bottom - pageRect.top,
        width: rect.width,
        height: rect.height,
      }))
    textRectsDirtyRef.current = false
  }

  const selectionBelongsToCurrentPage = (selection: Selection | null) => {
    const root = rootRef.current
    if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return false
    }

    const textLayer = root.querySelector('.textLayer')
    if (!textLayer) return false

    const belongsToTextLayer = (node: Node | null) => !!node && textLayer.contains(node)
    if (belongsToTextLayer(selection.anchorNode) || belongsToTextLayer(selection.focusNode)) {
      return true
    }

    const range = selection.getRangeAt(0)
    return belongsToTextLayer(range.commonAncestorContainer)
  }

  useEffect(() => {
    const container = pageHostRef.current
    if (!container) return

    let cancelled = false
    let pageView: PDFPageView | null = null
    let textRectFrame = 0
    let resizeObserver: ResizeObserver | null = null

    const scheduleTextRectRefresh = () => {
      invalidateCachedTextRects()
      if (textRectFrame) {
        window.cancelAnimationFrame(textRectFrame)
      }
      textRectFrame = window.requestAnimationFrame(() => {
        textRectFrame = 0
        if (!cancelled) {
          updateCachedTextRects()
        }
      })
    }

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
        if (!cancelled) {
          scheduleTextRectRefresh()
          const pageEl = rootRef.current?.querySelector('.page')
          if (pageEl) {
            resizeObserver = new ResizeObserver(() => {
              scheduleTextRectRefresh()
            })
            resizeObserver.observe(pageEl)
            resizeObserver.observe(rootRef.current ?? pageEl)
          }
        }
      } catch (e) {
        if (!cancelled) {
          console.error('[PdfOfficialPageView] failed to render page view', e)
        }
      }
    }

    invalidateCachedTextRects()
    textRectsRef.current = []
    container.replaceChildren()
    void render()

    return () => {
      cancelled = true
      resizeObserver?.disconnect()
      if (textRectFrame) {
        window.cancelAnimationFrame(textRectFrame)
      }
      textRectsDirtyRef.current = true
      textRectsRef.current = []
      pageView?.destroy()
      container.replaceChildren()
    }
  }, [pdfDocument, pageNumber, scale])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    let frame = 0

    const publishSelection = (selection: PdfSelectionDraft | null) => {
      if (!onSelectionChange) return

      if (selection) {
        hasActiveSelectionRef.current = true
        onSelectionChange(selection)
        return
      }

      if (!hasActiveSelectionRef.current) return
      hasActiveSelectionRef.current = false
      onSelectionChange(null)
    }

    const updateSelectionBlocks = () => {
      frame = 0

      const selection = window.getSelection()
      if (!selection || !selectionBelongsToCurrentPage(selection)) {
        clearSelectionBlocks()
        publishSelection(null)
        return
      }

      const pageEl = root.querySelector('.page') as HTMLElement | null
      if (!pageEl) {
        clearSelectionBlocks()
        return
      }

      const pageRect = pageEl.getBoundingClientRect()
      const rawRects = Array.from(selection.getRangeAt(0).getClientRects())
      if (textRectsDirtyRef.current || textRectsRef.current.length === 0) {
        updateCachedTextRects()
      }
      const textRects = textRectsRef.current

      const nextBlocks = buildSelectionBlocks(rawRects, pageRect, textRects)
      applySelectionBlocks(nextBlocks)

      const text = selection.toString().trim()
      const rects = selectionBlocksToAnnotationRects(nextBlocks, pageRect.width, pageRect.height)
      publishSelection(text && rects.length > 0 ? { page: pageNumber, text, rects } : null)
    }

    const scheduleUpdate = () => {
      if (frame) return
      frame = window.requestAnimationFrame(updateSelectionBlocks)
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      const target = event.target
      if (!(target instanceof Node) || !root.contains(target)) return
      const annotationBlock = target instanceof HTMLElement ? target.closest('.pdf-annotation-block') : null
      if (annotationBlock instanceof HTMLElement) {
        return
      }
      onClearAnnotationSelection?.()
      setPointerSelectingState(true)
      clearSelectionBlocks()
    }

    const handlePointerFinish = () => {
      if (!isPointerSelectionActiveRef.current) return
      setPointerSelectingState(false)
      scheduleUpdate()
    }

    const handleSelectionChange = () => {
      if (isPointerSelectionActiveRef.current) {
        return
      }
      const selection = window.getSelection()
      if (!selectionBelongsToCurrentPage(selection)) {
        clearSelectionBlocks()
        publishSelection(null)
        return
      }
      scheduleUpdate()
    }

    root.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('pointerup', handlePointerFinish)
    document.addEventListener('pointercancel', handlePointerFinish)
    document.addEventListener('selectionchange', handleSelectionChange)
    const selection = window.getSelection()
    if (selectionBelongsToCurrentPage(selection)) {
      scheduleUpdate()
    } else {
      clearSelectionBlocks()
      publishSelection(null)
    }

    return () => {
      root.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('pointerup', handlePointerFinish)
      document.removeEventListener('pointercancel', handlePointerFinish)
      document.removeEventListener('selectionchange', handleSelectionChange)
      setPointerSelectingState(false)
      publishSelection(null)
      if (frame) {
        window.cancelAnimationFrame(frame)
      }
    }
  }, [onSelectionChange, pageNumber, pdfDocument, scale])

  return (
    <div
      ref={rootRef}
      className="pdf-official-page-view pdfViewer"
      style={{ '--scale-factor': String(scale) } as React.CSSProperties}
    >
      <div ref={pageHostRef} className="pdf-official-page-host" />
      <div className="pdf-annotation-overlay" aria-hidden="true">
        {annotations
          .filter((annotation) => annotation.type === 'highlight')
          .flatMap((annotation) =>
            annotation.rects.map((rect, index) => (
              <div
                key={`${annotation.id}-${index}`}
                className={`pdf-annotation-block ${selectedAnnotationId === annotation.id ? 'selected' : ''}`}
                style={{
                  left: `${rect.x1 * 100}%`,
                  top: `${rect.y1 * 100}%`,
                  width: `${(rect.x2 - rect.x1) * 100}%`,
                  height: `${(rect.y2 - rect.y1) * 100}%`,
                  background: annotation.color,
                  opacity: annotation.opacity,
                }}
                onClick={() => {
                  onAnnotationClick?.(annotation.id)
                }}
              />
            )),
          )}
      </div>
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
