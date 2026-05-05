import { memo, useEffect, useRef, useState } from 'react'
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
import type { Annotation, Rect } from '../types/annotation'
import type { AnnotationType } from '../types/annotation'

export interface PdfOfficialPageViewProps {
  pdfDocument: PDFDocumentProxy
  pageNumber: number
  scale: number
  previewHighlightColor?: string
  clearSelectionSignal?: number
  annotations?: Annotation[]
  onSelectionChange?: (selection: PdfSelectionDraft | null) => void
  activeShapeTool?: Extract<AnnotationType, 'square' | 'circle'> | null
  onShapeCreate?: (shape: {
    page: number
    rect: Rect
    type: Extract<AnnotationType, 'square' | 'circle'>
  }) => void
  selectedAnnotationId?: string | null
  pulsingAnnotationId?: string | null
  onAnnotationClick?: (annotationId: string) => void
  onAnnotationDoubleClick?: (annotationId: string) => void
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
export const PdfOfficialPageView = memo(function PdfOfficialPageView({
  pdfDocument,
  pageNumber,
  scale,
  previewHighlightColor = '#f5d90a',
  clearSelectionSignal = 0,
  annotations = [],
  onSelectionChange,
  activeShapeTool = null,
  onShapeCreate,
  selectedAnnotationId = null,
  pulsingAnnotationId = null,
  onAnnotationClick,
  onAnnotationDoubleClick,
  onClearAnnotationSelection,
}: PdfOfficialPageViewProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const pageHostRef = useRef<HTMLDivElement | null>(null)
  const textRectsRef = useRef<RectLike[]>([])
  const textRectsDirtyRef = useRef(true)
  const isPointerSelectionActiveRef = useRef(false)
  const assistRegionRef = useRef<{ left: number; top: number; right: number; bottom: number } | null>(null)
  const hasActiveSelectionRef = useRef(false)
  const shapeDraftStartRef = useRef<{ x: number; y: number } | null>(null)
  const isShapeDrawingActiveRef = useRef(false)
  const shapeDraftRectRef = useRef<Rect | null>(null)
  const [selectionBlocks, setSelectionBlocks] = useState<SelectionBlock[]>([])
  const [shapeDraftRect, setShapeDraftRect] = useState<Rect | null>(null)

  const clearSelectionBlocks = () => {
    setSelectionBlocks((prev) => (prev.length === 0 ? prev : []))
  }

  const applySelectionBlocks = (nextBlocks: SelectionBlock[]) => {
    setSelectionBlocks((prev) => (areSelectionBlocksEqual(prev, nextBlocks) ? prev : nextBlocks))
  }

  const applyShapeDraftRect = (nextRect: Rect | null) => {
    shapeDraftRectRef.current = nextRect
    setShapeDraftRect((prev) => {
      if (prev === nextRect) return prev
      if (!prev || !nextRect) return nextRect
      if (
        prev.x1 === nextRect.x1 &&
        prev.y1 === nextRect.y1 &&
        prev.x2 === nextRect.x2 &&
        prev.y2 === nextRect.y2
      ) {
        return prev
      }
      return nextRect
    })
  }

  const setSelectionAssistRegionDefaults = () => {
    const root = rootRef.current
    if (!root) return
    assistRegionRef.current = null
    root.classList.remove('is-selection-assist-active')
    root.style.setProperty('--pdf-text-right-edge', '100%')
    root.style.setProperty('--pdf-text-selection-top', '0px')
    root.style.setProperty('--pdf-text-selection-height', '100%')
    root.style.setProperty('--pdf-text-selection-assist-left', '100%')
  }

  const setSelectionAssistRegionFromRects = (
    pageRect: DOMRect,
    selectionRects: readonly RectLike[],
  ) => {
    const root = rootRef.current
    if (!root) return

    if (selectionRects.length === 0) {
      setSelectionAssistRegionDefaults()
      return
    }

    const pageRelativeRects = selectionRects
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({
        left: Math.max(0, rect.left - pageRect.left),
        top: Math.max(0, rect.top - pageRect.top),
        right: Math.min(pageRect.width, rect.right - pageRect.left),
        bottom: Math.min(pageRect.height, rect.bottom - pageRect.top),
        width: rect.width,
        height: rect.height,
      }))
      .filter((rect) => rect.right > rect.left && rect.bottom > rect.top)

    if (pageRelativeRects.length === 0) {
      setSelectionAssistRegionDefaults()
      return
    }

    const lineBottom = Math.max(...pageRelativeRects.map((rect) => rect.bottom))
    const lineHeight = Math.max(...pageRelativeRects.map((rect) => rect.height))
    const lineThreshold = Math.max(3, lineHeight * 0.45)
    const currentLineRects = pageRelativeRects.filter(
      (rect) => Math.abs(rect.bottom - lineBottom) <= lineThreshold,
    )

    const intersectingTextRects = textRectsRef.current.filter((textRect) =>
      currentLineRects.some(
        (lineRect) =>
          textRect.left < lineRect.right &&
          textRect.right > lineRect.left &&
          textRect.top < lineRect.bottom &&
          textRect.bottom > lineRect.top,
      ),
    )

    const effectiveLineRects = intersectingTextRects.length > 0 ? intersectingTextRects : currentLineRects
    const lineTop = Math.max(0, Math.min(...effectiveLineRects.map((rect) => rect.top)))
    const lineBottomFromRects = Math.min(
      pageRect.height,
      Math.max(...effectiveLineRects.map((rect) => rect.bottom)),
    )
    const effectiveLineHeight = Math.max(1, lineBottomFromRects - lineTop)
    const paddedLineTop = Math.max(0, lineTop - effectiveLineHeight * 0.12)
    const paddedLineBottom = Math.min(
      pageRect.height,
      lineBottomFromRects + effectiveLineHeight * 0.12,
    )
    const lineRight = Math.min(pageRect.width, Math.max(...effectiveLineRects.map((rect) => rect.right)))
    assistRegionRef.current = {
      left: lineRight,
      top: paddedLineTop,
      right: pageRect.width,
      bottom: paddedLineBottom,
    }

    root.style.setProperty('--pdf-text-right-edge', `${lineRight}px`)
    root.style.setProperty('--pdf-text-selection-top', `${paddedLineTop}px`)
    root.style.setProperty(
      '--pdf-text-selection-height',
      `${Math.max(1, paddedLineBottom - paddedLineTop)}px`,
    )
    root.style.setProperty('--pdf-text-selection-assist-left', `${lineRight}px`)
  }

  const setPointerSelectingState = (active: boolean) => {
    isPointerSelectionActiveRef.current = active
    rootRef.current?.classList.toggle('is-pointer-selecting', active)
    if (!active) {
      rootRef.current?.classList.remove('is-selection-assist-active')
    }
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
      root.style.setProperty('--pdf-text-right-edge', '100%')
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
    const maxRight = textRectsRef.current.reduce((right, rect) => Math.max(right, rect.right), 0)
    root.style.setProperty(
      '--pdf-text-right-edge',
      textRectsRef.current.length > 0 ? `${Math.min(maxRight, pageRect.width)}px` : '100%',
    )
    root.style.setProperty('--pdf-text-selection-top', '0px')
    root.style.setProperty('--pdf-text-selection-height', '100%')
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
        setSelectionAssistRegionDefaults()
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
      setSelectionAssistRegionFromRects(pageRect, normalizedRawRects)
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

    const getPageRelativePoint = (event: PointerEvent) => {
      const pageEl = root.querySelector('.page') as HTMLElement | null
      if (!pageEl) return null
      const pageRect = pageEl.getBoundingClientRect()
      if (pageRect.width <= 0 || pageRect.height <= 0) return null
      const x = Math.min(Math.max((event.clientX - pageRect.left) / pageRect.width, 0), 1)
      const y = Math.min(Math.max((event.clientY - pageRect.top) / pageRect.height, 0), 1)
      return { x, y }
    }

    const buildDraftRect = (
      start: { x: number; y: number },
      end: { x: number; y: number },
      shapeType: Extract<AnnotationType, 'square' | 'circle'> | null,
      constrainAspectRatio: boolean,
    ): Rect => {
      if (!shapeType || !constrainAspectRatio) {
        return {
          x1: Math.min(start.x, end.x),
          y1: Math.min(start.y, end.y),
          x2: Math.max(start.x, end.x),
          y2: Math.max(start.y, end.y),
        }
      }

      const deltaX = end.x - start.x
      const deltaY = end.y - start.y
      const size = Math.min(Math.abs(deltaX), Math.abs(deltaY))
      const constrainedEndX = start.x + Math.sign(deltaX || 1) * size
      const constrainedEndY = start.y + Math.sign(deltaY || 1) * size

      return {
        x1: Math.min(start.x, constrainedEndX),
        y1: Math.min(start.y, constrainedEndY),
        x2: Math.max(start.x, constrainedEndX),
        y2: Math.max(start.y, constrainedEndY),
      }
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
      if (activeShapeTool) {
        const point = getPageRelativePoint(event)
        if (!point) return
        event.preventDefault()
        onClearAnnotationSelection?.()
        clearSelectionBlocks()
        publishSelection(null)
        setSelectionAssistRegionDefaults()
        shapeDraftStartRef.current = point
        isShapeDrawingActiveRef.current = true
        applyShapeDraftRect({
          x1: point.x,
          y1: point.y,
          x2: point.x,
          y2: point.y,
        })
        return
      }
      onClearAnnotationSelection?.()
      setPointerSelectingState(true)
      clearSelectionBlocks()
    }

    const handlePointerFinish = () => {
      if (isShapeDrawingActiveRef.current) {
        const draftRect = shapeDraftRectRef.current
        shapeDraftStartRef.current = null
        isShapeDrawingActiveRef.current = false
        applyShapeDraftRect(null)
        if (
          activeShapeTool &&
          draftRect &&
          draftRect.x2 - draftRect.x1 >= 0.006 &&
          draftRect.y2 - draftRect.y1 >= 0.006
        ) {
          onShapeCreate?.({
            page: pageNumber,
            rect: draftRect,
            type: activeShapeTool,
          })
        }
        return
      }
      if (!isPointerSelectionActiveRef.current) return
      setPointerSelectingState(false)
      if (frame) {
        window.cancelAnimationFrame(frame)
        frame = 0
      }
      updateSelectionBlocks()
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (isShapeDrawingActiveRef.current) {
        const start = shapeDraftStartRef.current
        const point = getPageRelativePoint(event)
        if (!start || !point) return
        applyShapeDraftRect(buildDraftRect(start, point, activeShapeTool, event.shiftKey))
        return
      }
      if (!isPointerSelectionActiveRef.current) return
      const root = rootRef.current
      if (!root) return
      const pageEl = root.querySelector('.page') as HTMLElement | null
      const region = assistRegionRef.current
      if (!pageEl || !region) {
        root.classList.remove('is-selection-assist-active')
        return
      }

      const pageRect = pageEl.getBoundingClientRect()
      const x = event.clientX - pageRect.left
      const y = event.clientY - pageRect.top
      const active =
        x >= region.left &&
        x <= region.right &&
        y >= region.top &&
        y <= region.bottom

      if (active) {
        const assistLeft = Math.max(region.left, x - 24)
        root.style.setProperty('--pdf-text-selection-assist-left', `${assistLeft}px`)
      } else {
        root.style.setProperty('--pdf-text-selection-assist-left', `${region.left}px`)
      }

      root.classList.toggle('is-selection-assist-active', active)
    }

    const handleSelectionChange = () => {
      if (isPointerSelectionActiveRef.current) {
        return
      }
      if (activeShapeTool) {
        return
      }
      const selection = window.getSelection()
      if (!selectionBelongsToCurrentPage(selection)) {
        clearSelectionBlocks()
        setSelectionAssistRegionDefaults()
        publishSelection(null)
        return
      }
      scheduleUpdate()
    }

    root.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', handlePointerFinish)
    document.addEventListener('pointercancel', handlePointerFinish)
    document.addEventListener('selectionchange', handleSelectionChange)
    const selection = window.getSelection()
    if (selectionBelongsToCurrentPage(selection)) {
      scheduleUpdate()
    } else {
      clearSelectionBlocks()
      setSelectionAssistRegionDefaults()
      publishSelection(null)
    }

    return () => {
      root.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', handlePointerFinish)
      document.removeEventListener('pointercancel', handlePointerFinish)
      document.removeEventListener('selectionchange', handleSelectionChange)
      setPointerSelectingState(false)
      shapeDraftStartRef.current = null
      isShapeDrawingActiveRef.current = false
      applyShapeDraftRect(null)
      setSelectionAssistRegionDefaults()
      publishSelection(null)
      if (frame) {
        window.cancelAnimationFrame(frame)
      }
    }
  }, [onSelectionChange, pageNumber, pdfDocument, scale, clearSelectionSignal, activeShapeTool, onShapeCreate, onClearAnnotationSelection])

  useEffect(() => {
    clearSelectionBlocks()
    hasActiveSelectionRef.current = false
    applyShapeDraftRect(null)
    shapeDraftStartRef.current = null
    isShapeDrawingActiveRef.current = false
    setSelectionAssistRegionDefaults()
    onSelectionChange?.(null)
  }, [clearSelectionSignal, onSelectionChange, activeShapeTool])

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
            const notePreview = annotation.note?.trim() || annotation.content?.trim() || ''
            const noteMarker = annotation.note?.trim() && index === 0 ? (
              <div className="pdf-annotation-note-marker" title={notePreview}>
                <span className="pdf-annotation-note-marker-glyph" aria-hidden="true">
                  N
                </span>
              </div>
            ) : null
            const sharedClassName = `pdf-annotation-block pdf-annotation-block--${annotation.type} ${selectedAnnotationId === annotation.id ? 'selected' : ''} ${pulsingAnnotationId === annotation.id ? 'pulsing' : ''}`
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
              onDoubleClick: () => {
                onAnnotationDoubleClick?.(annotation.id)
              },
            }

            if (annotation.type === 'highlight') {
              return (
                <div
                  key={annotationKey}
                  {...sharedProps}
                  style={{
                    ...sharedProps.style,
                    opacity: 1,
                  }}
                >
                  <div
                    className="pdf-annotation-highlight-fill"
                    style={{
                      background: annotation.color,
                      opacity: annotation.opacity,
                    }}
                  />
                  {noteMarker}
                </div>
              )
            }

            if (annotation.type === 'text') {
              const notePreview = annotation.note?.trim() || annotation.content?.trim() || ''
              return (
                <div
                  key={annotationKey}
                  {...sharedProps}
                  style={{
                    ...sharedProps.style,
                    opacity: 1,
                  }}
                >
                  {index === 0 ? (
                    <div className="pdf-annotation-note-marker" title={notePreview}>
                      <span className="pdf-annotation-note-marker-glyph" aria-hidden="true">
                        N
                      </span>
                    </div>
                  ) : null}
                </div>
              )
            }

            if (annotation.type === 'square' || annotation.type === 'circle') {
              return (
                <div
                  key={annotationKey}
                  {...sharedProps}
                  style={{
                    ...sharedProps.style,
                    opacity: 1,
                  }}
                >
                  <div className={`pdf-annotation-shape pdf-annotation-shape--${annotation.type}`} />
                  {noteMarker}
                </div>
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
                {noteMarker}
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
        {shapeDraftRect ? (
          <div
            className={`pdf-selection-shape-draft pdf-selection-shape-draft--${activeShapeTool ?? 'square'}`}
            style={{
              left: `${shapeDraftRect.x1 * 100}%`,
              top: `${shapeDraftRect.y1 * 100}%`,
              width: `${(shapeDraftRect.x2 - shapeDraftRect.x1) * 100}%`,
              height: `${(shapeDraftRect.y2 - shapeDraftRect.y1) * 100}%`,
              '--pdf-selection-preview-color': previewHighlightColor,
            } as React.CSSProperties}
          />
        ) : null}
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
})
