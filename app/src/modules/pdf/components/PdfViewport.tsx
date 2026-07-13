import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type UIEventHandler,
} from 'react'
import type { PDFDocumentProxy } from '../hooks/usePdfDocument'
import type { PdfSelectionDraft } from '../annotationUtils'
import type { Annotation, Rect, StampKind } from '../types/annotation'
import type { AnnotationType } from '../types/annotation'
import { useVirtualPages } from '../hooks/useVirtualPages'
import { PdfOfficialPageView } from './PdfOfficialPageView'

export interface PdfViewportHandle {
  scrollToPage: (page: number, estimatedPageHeight?: number) => void
  scrollToOffset: (offset: number) => void
  getContainerWidth: () => number | null
  getContainerHeight: () => number | null
  getRenderedPageMetrics: (page: number) => { top: number; viewportTop: number; left: number; width: number; height: number } | null
}

const EMPTY_ANNOTATIONS: Annotation[] = []

export interface PdfViewportProps {
  pdfDocument: PDFDocumentProxy
  pageCount: number
  scale: number
  pageHeight: number
  previewHighlightColor?: string
  clearSelectionSignal?: number
  clearSelectionOnBlankClick?: boolean
  currentPage: number
  onCurrentPageChange: (page: number) => void
  onRegisterSelectionGetter?: (getter: (() => string | null) | null) => void
  annotations?: Annotation[]
  onSelectionChange?: (selection: PdfSelectionDraft | null) => void
  activeShapeTool?: Extract<AnnotationType, 'square' | 'circle' | 'line' | 'arrow'> | null
  onShapeCreate?: (shape: {
    page: number
    rect: Rect
    type: Extract<AnnotationType, 'square' | 'circle' | 'line' | 'arrow'>
    linePoints?: Rect
  }) => void
  activeFreeTextTool?: boolean
  onFreeTextCreate?: (draft: {
    page: number
    rect: Rect
  }) => void
  onFreeTextResize?: (freeText: { annotationId: string; rect: Rect }) => void
  activeNoteTool?: boolean
  onNoteCreate?: (draft: {
    page: number
    rect: Rect
  }) => void
  onNoteResize?: (note: { annotationId: string; rect: Rect }) => void
  editingFreeTextDraft?: {
    page: number
    rect: Rect
  } | null
  editingFreeTextAnnotationId?: string | null
  editingFreeTextInitialValue?: string
  onFreeTextSave?: (value: string, rect: Rect) => void
  onFreeTextCancel?: () => void
  editingNoteDraft?: {
    page: number
    rect: Rect
  } | null
  editingNoteAnnotationId?: string | null
  editingNoteInitialValue?: string
  onNoteSave?: (value: string, rect: Rect) => void
  onNoteCancel?: () => void
  activeStampKind?: StampKind | null
  activeStampLabel?: string | null
  activeStampSize?: number
  onStampCreate?: (stamp: {
    page: number
    rect: Rect
    kind: StampKind
    label: string
  }) => void
  onStampResize?: (stamp: { annotationId: string; rect: Rect }) => void
  onLineResize?: (shape: {
    annotationId: string
    rect: Rect
    linePoints: Rect
  }) => void
  selectedAnnotationId?: string | null
  pulsingAnnotationId?: string | null
  onAnnotationClick?: (annotationId: string) => void
  onAnnotationDoubleClick?: (annotationId: string) => void
  onClearAnnotationSelection?: () => void
}

const PdfViewportInner = forwardRef<PdfViewportHandle, PdfViewportProps>(function PdfViewport(
  {
    pdfDocument,
    pageCount,
    scale,
    pageHeight,
    previewHighlightColor,
    clearSelectionSignal = 0,
    clearSelectionOnBlankClick = false,
    currentPage,
    onCurrentPageChange,
    onRegisterSelectionGetter,
    annotations = EMPTY_ANNOTATIONS,
    onSelectionChange,
    activeShapeTool = null,
    onShapeCreate,
    activeFreeTextTool = false,
    onFreeTextCreate,
    onFreeTextResize,
    activeNoteTool = false,
    onNoteCreate,
    onNoteResize,
    editingFreeTextDraft = null,
    editingFreeTextAnnotationId = null,
    editingFreeTextInitialValue = '',
    onFreeTextSave,
    onFreeTextCancel,
    editingNoteDraft = null,
    editingNoteAnnotationId = null,
    editingNoteInitialValue = '',
    onNoteSave,
    onNoteCancel,
    activeStampKind = null,
    activeStampLabel = null,
    activeStampSize = 0.045,
    onStampCreate,
    onStampResize,
    onLineResize,
    selectedAnnotationId = null,
    pulsingAnnotationId = null,
    onAnnotationClick,
    onAnnotationDoubleClick,
    onClearAnnotationSelection,
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
      scrollToOffset(offset) {
        const container = containerRef.current
        if (!container) return
        container.scrollTop = Math.max(0, offset)
      },
      getContainerWidth() {
        return containerRef.current?.clientWidth ?? null
      },
      getContainerHeight() {
        return containerRef.current?.clientHeight ?? null
      },
      getRenderedPageMetrics(page) {
        const container = containerRef.current
        if (!container) return null
        const slot = container.querySelector<HTMLElement>(`.pdf-page-slot[data-page-number="${page}"]`)
        if (!slot) return null
        const pageEl = slot.querySelector<HTMLElement>('.page')
        const containerRect = container.getBoundingClientRect()
        const pageRect = pageEl?.getBoundingClientRect() ?? slot.getBoundingClientRect()
        const height = pageRect.height
        const width = pageRect.width
        if (!height || height <= 0 || !width || width <= 0) return null
        return {
          top: slot.offsetTop,
          viewportTop: pageRect.top - containerRect.top,
          left: pageRect.left - containerRect.left,
          width,
          height,
        }
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

  const annotationsByPage = useMemo(() => {
    const grouped = new Map<number, Annotation[]>()
    for (const annotation of annotations) {
      const current = grouped.get(annotation.page)
      if (current) {
        current.push(annotation)
      } else {
        grouped.set(annotation.page, [annotation])
      }
    }
    return grouped
  }, [annotations])

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
        data-page-number={pageNumber}
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
            previewHighlightColor={previewHighlightColor}
            clearSelectionSignal={clearSelectionSignal}
            clearSelectionOnBlankClick={clearSelectionOnBlankClick}
            annotations={annotationsByPage.get(pageNumber) ?? EMPTY_ANNOTATIONS}
            onSelectionChange={onSelectionChange}
            activeShapeTool={activeShapeTool}
            onShapeCreate={onShapeCreate}
            activeFreeTextTool={activeFreeTextTool}
            onFreeTextCreate={onFreeTextCreate}
            onFreeTextResize={onFreeTextResize}
            activeNoteTool={activeNoteTool}
            onNoteCreate={onNoteCreate}
            onNoteResize={onNoteResize}
            editingFreeTextDraft={editingFreeTextDraft}
            editingFreeTextAnnotationId={editingFreeTextAnnotationId}
            editingFreeTextInitialValue={editingFreeTextInitialValue}
            onFreeTextSave={onFreeTextSave}
            onFreeTextCancel={onFreeTextCancel}
            editingNoteDraft={editingNoteDraft}
            editingNoteAnnotationId={editingNoteAnnotationId}
            editingNoteInitialValue={editingNoteInitialValue}
            onNoteSave={onNoteSave}
            onNoteCancel={onNoteCancel}
            activeStampKind={activeStampKind}
            activeStampLabel={activeStampLabel}
            activeStampSize={activeStampSize}
            onStampCreate={onStampCreate}
            onStampResize={onStampResize}
            onLineResize={onLineResize}
            selectedAnnotationId={selectedAnnotationId}
            pulsingAnnotationId={pulsingAnnotationId}
            onAnnotationClick={onAnnotationClick}
            onAnnotationDoubleClick={onAnnotationDoubleClick}
            onClearAnnotationSelection={onClearAnnotationSelection}
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

PdfViewportInner.displayName = 'PdfViewport'

export const PdfViewport = memo(PdfViewportInner)
