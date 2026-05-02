import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from '../hooks/usePdfDocument'
import { EventBus, PDFLinkService, PDFPageView } from 'pdfjs-dist/web/pdf_viewer.mjs'
import 'pdfjs-dist/web/pdf_viewer.css'
import {
  annotationRectsToSelectionBlocks,
  areSelectionBlocksEqual,
  buildSelectionBlocks,
  type RectLike,
  type SelectionBlock,
} from './pdfSelectionOverlay'
import {
  selectionRectsToAnnotationRects,
  type PdfSelectionDraft,
} from '../annotationUtils'
import type { Annotation } from '../types/annotation'

export interface PdfOfficialPageViewProps {
  pdfDocument: PDFDocumentProxy
  pageNumber: number
  scale: number
  previewHighlightColor?: string
  clearSelectionSignal?: number
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
  previewHighlightColor = '#f5d90a',
  clearSelectionSignal = 0,
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

    const normalizeSelectionRects = (rawRects: DOMRectList | DOMRect[]) => {
      const pageEl = root.querySelector('.page') as HTMLElement | null
      if (!pageEl) return [] as RectLike[]

      const pageRect = pageEl.getBoundingClientRect()
      return Array.from(rawRects)
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => {
          const offsetY = rect.height * 0.14
          const top = Math.max(pageRect.top, rect.top - offsetY)
          return {
            left: rect.left,
            top,
            right: rect.right,
            bottom: top + rect.height,
            width: rect.width,
            height: rect.height,
          }
        })
    }

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
      const normalizedRawRects = normalizeSelectionRects(selection.getRangeAt(0).getClientRects())
      if (textRectsDirtyRef.current || textRectsRef.current.length === 0) {
        updateCachedTextRects()
      }
      const textRects = textRectsRef.current

      const text = selection.toString().trim()
      const rects = selectionRectsToAnnotationRects(normalizedRawRects, {
        left: pageRect.left,
        top: pageRect.top,
        right: pageRect.right,
        bottom: pageRect.bottom,
        width: pageRect.width,
        height: pageRect.height,
      })
      const nextBlocks =
        rects.length > 0
          ? annotationRectsToSelectionBlocks(rects, pageRect.width, pageRect.height)
          : buildSelectionBlocks(normalizedRawRects, pageRect, textRects)

      applySelectionBlocks(nextBlocks)
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
      if (frame) {
        window.cancelAnimationFrame(frame)
        frame = 0
      }
      updateSelectionBlocks()
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
  }, [onSelectionChange, pageNumber, pdfDocument, scale, clearSelectionSignal])

  useEffect(() => {
    clearSelectionBlocks()
    hasActiveSelectionRef.current = false
    onSelectionChange?.(null)
  }, [clearSelectionSignal, onSelectionChange])

  return (
    <div
      ref={rootRef}
      className="pdf-official-page-view pdfViewer"
      style={{
        '--scale-factor': String(scale),
        '--pdf-selection-preview-color': previewHighlightColor,
      } as React.CSSProperties}
    >
      <div ref={pageHostRef} className="pdf-official-page-host" />
      <div className="pdf-annotation-overlay" aria-hidden="true">
        {annotations.flatMap((annotation) =>
          annotation.rects.map((rect, index) => {
            const left = `${rect.x1 * 100}%`
            const top = `${rect.y1 * 100}%`
            const width = `${(rect.x2 - rect.x1) * 100}%`
            const height = `${(rect.y2 - rect.y1) * 100}%`
            const annotationKey = `${annotation.id}-${index}`
            const sharedClassName = `pdf-annotation-block pdf-annotation-block--${annotation.type} ${selectedAnnotationId === annotation.id ? 'selected' : ''}`
            const sharedProps = {
              className: sharedClassName,
              style: {
                left,
                top,
                width,
                height,
                '--pdf-annotation-color': annotation.color,
                '--pdf-annotation-opacity': String(annotation.opacity),
              } as React.CSSProperties,
              onClick: () => {
                onAnnotationClick?.(annotation.id)
              },
            }

            if (annotation.type === 'highlight') {
              return (
                <div
                  key={annotationKey}
                  {...sharedProps}
                  style={{
                    ...sharedProps.style,
                    background: annotation.color,
                    opacity: annotation.opacity,
                  }}
                />
              )
            }

            return (
              <div
                key={annotationKey}
                {...sharedProps}
                style={{
                  ...sharedProps.style,
                  opacity: 1,
                }}
              >
                <div className={`pdf-annotation-mark pdf-annotation-mark--${annotation.type}`}>
                  {annotation.type === 'squiggly' ? (
                    <svg className="pdf-annotation-squiggly" viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true">
                      <path
                        d="M0 8 Q 6 2 12 8 T 24 8 T 36 8 T 48 8 T 60 8 T 72 8 T 84 8 T 96 8"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : null}
                </div>
              </div>
            )
          }),
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
