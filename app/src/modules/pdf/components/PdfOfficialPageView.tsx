import { Fragment, memo, useEffect, useRef, useState } from 'react'
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
import type { Annotation, Rect, StampKind } from '../types/annotation'
import type { AnnotationType } from '../types/annotation'

const MIN_STAMP_SIZE = 0.045 / 3
const LINE_RECT_PADDING = 0.006

type TextCaret = {
  node: Node
  offset: number
}

type VisualSpanLayout = { span: HTMLElement; rect: DOMRect }

type VisualLine = {
  spans: VisualSpanLayout[]
  top: number
  bottom: number
  left: number
  right: number
  height: number
}

type VisualTextLayout = {
  lines: VisualLine[]
  lineBySpan: Map<HTMLElement, VisualLine>
}

const PDF_TEXT_LAYER_DEBUG = false

type SelectionPublicationSnapshot = {
  text: string
  rectsKey: string
}

export interface PdfOfficialPageViewProps {
  pdfDocument: PDFDocumentProxy
  pageNumber: number
  scale: number
  previewHighlightColor?: string
  clearSelectionSignal?: number
  clearSelectionOnBlankClick?: boolean
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
  clearSelectionOnBlankClick = false,
  annotations = [],
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
}: PdfOfficialPageViewProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const pageHostRef = useRef<HTMLDivElement | null>(null)
  const textRectsRef = useRef<RectLike[]>([])
  const textRectsDirtyRef = useRef(true)
  const visualTextLayoutRef = useRef<VisualTextLayout | null>(null)
  const isPointerSelectionActiveRef = useRef(false)
  const selectionAnchorCaretRef = useRef<TextCaret | null>(null)
  const lastValidSelectionCaretRef = useRef<TextCaret | null>(null)
  const assistRegionRef = useRef<{ left: number; top: number; right: number; bottom: number } | null>(null)
  const assistRegionSnapshotRef = useRef<string | null>(null)
  const hasActiveSelectionRef = useRef(false)
  const shapeDraftStartRef = useRef<{ x: number; y: number } | null>(null)
  const isShapeDrawingActiveRef = useRef(false)
  const shapeDraftRectRef = useRef<Rect | null>(null)
  const stampResizeDraftRef = useRef<{ annotationId: string; rect: Rect } | null>(null)
  const lineResizeDraftRef = useRef<{ annotationId: string; rect: Rect; linePoints: Rect } | null>(null)
  const movingStampStateRef = useRef<{
    annotationId: string
    pointerOffsetX: number
    pointerOffsetY: number
    width: number
    height: number
  } | null>(null)
  const resizingStampStateRef = useRef<{
    annotationId: string
    centerX: number
    centerY: number
    minHalfSize: number
  } | null>(null)
  const movingLineStateRef = useRef<{
    annotationId: string
    origin: { x: number; y: number }
    startPoints: Rect
  } | null>(null)
  const resizingLineStateRef = useRef<{
    annotationId: string
    handle: 'start' | 'end'
    startPoints: Rect
  } | null>(null)
  const movingFreeTextStateRef = useRef<{
    annotationId: string
    pointerOffsetX: number
    pointerOffsetY: number
    width: number
    height: number
  } | null>(null)
  const resizingFreeTextStateRef = useRef<{
    annotationId: string
    handle: 'left' | 'right' | 'top' | 'bottom' | 'tl' | 'tr' | 'bl' | 'br'
    startRect: Rect
    minWidth: number
    minHeight: number
  } | null>(null)
  const [selectionBlocks, setSelectionBlocks] = useState<SelectionBlock[]>([])
  const [shapeDraftRect, setShapeDraftRect] = useState<Rect | null>(null)
  const [stampResizeDraft, setStampResizeDraft] = useState<{ annotationId: string; rect: Rect } | null>(null)
  const [lineResizeDraft, setLineResizeDraft] = useState<{ annotationId: string; rect: Rect; linePoints: Rect } | null>(null)
  const [freeTextResizeDraft, setFreeTextResizeDraft] = useState<{ annotationId: string; rect: Rect } | null>(null)
  const lastPublishedSelectionSnapshotRef = useRef<SelectionPublicationSnapshot | null>(null)
  const freeTextResizeDraftRef = useRef<{ annotationId: string; rect: Rect } | null>(null)
  const freeTextLiveAnnotationIdRef = useRef<string | null>(null)
  const [lineDraftOrigin, setLineDraftOrigin] = useState<{ x: number; y: number } | null>(null)
  const freeTextEditorRef = useRef<HTMLTextAreaElement | null>(null)
  const freeTextEditorLineCountRef = useRef(1)
  const activeFreeTextDraft = editingFreeTextDraft?.page === pageNumber ? editingFreeTextDraft : null
  const activeNoteDraft = editingNoteDraft?.page === pageNumber ? editingNoteDraft : null
  const activeTextBoxType = activeFreeTextDraft ? 'freeText' : activeNoteDraft ? 'note' : null
  const activeTextBoxDraft = activeFreeTextDraft ?? activeNoteDraft
  const activeTextBoxEditingAnnotationId = editingFreeTextAnnotationId ?? editingNoteAnnotationId
  const activeTextBoxInitialValue =
    activeTextBoxType === 'freeText' ? editingFreeTextInitialValue : editingNoteInitialValue
  const activeTextBoxEditorKey = activeTextBoxDraft
    ? `${activeTextBoxType ?? 'text'}-${activeTextBoxEditingAnnotationId ?? 'new'}-${activeTextBoxDraft.rect.x1}-${activeTextBoxDraft.rect.y1}-${activeTextBoxDraft.rect.x2}-${activeTextBoxDraft.rect.y2}`
    : null
  const activeTextBoxColor =
    (
      activeTextBoxEditingAnnotationId
        ? annotations.find((annotation) => annotation.id === activeTextBoxEditingAnnotationId)?.color
        : null
    ) ?? previewHighlightColor

  const updateFreeTextEditorHeight = (input: HTMLTextAreaElement, force = false) => {
    const computed = window.getComputedStyle(input)
    const lineHeight = Number.parseFloat(computed.lineHeight)
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) return
    const nextLineCount = Math.max(1, Math.round(input.scrollHeight / lineHeight))
    if (!force && nextLineCount <= freeTextEditorLineCountRef.current) {
      return
    }
    input.style.height = `${input.scrollHeight}px`
    freeTextEditorLineCountRef.current = nextLineCount
  }

  const buildPaddedLineRect = (linePoints: Rect): Rect => ({
    x1: Math.max(0, Math.min(linePoints.x1, linePoints.x2) - LINE_RECT_PADDING),
    y1: Math.max(0, Math.min(linePoints.y1, linePoints.y2) - LINE_RECT_PADDING),
    x2: Math.min(1, Math.max(linePoints.x1, linePoints.x2) + LINE_RECT_PADDING),
    y2: Math.min(1, Math.max(linePoints.y1, linePoints.y2) + LINE_RECT_PADDING),
  })

  const applyLineResizeDraft = (nextDraft: { annotationId: string; rect: Rect; linePoints: Rect } | null) => {
    lineResizeDraftRef.current = nextDraft
    setLineResizeDraft((prev) => {
      if (prev === nextDraft) return prev
      if (!prev || !nextDraft) return nextDraft
      if (
        prev.annotationId === nextDraft.annotationId &&
        prev.rect.x1 === nextDraft.rect.x1 &&
        prev.rect.y1 === nextDraft.rect.y1 &&
        prev.rect.x2 === nextDraft.rect.x2 &&
        prev.rect.y2 === nextDraft.rect.y2 &&
        prev.linePoints.x1 === nextDraft.linePoints.x1 &&
        prev.linePoints.y1 === nextDraft.linePoints.y1 &&
        prev.linePoints.x2 === nextDraft.linePoints.x2 &&
        prev.linePoints.y2 === nextDraft.linePoints.y2
      ) {
        return prev
      }
      return nextDraft
    })
  }

  const renderStampIcon = (kind: StampKind) => {
    switch (kind) {
      case 'important':
        return (
          <svg className="pdf-annotation-stamp-icon" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M10 3.6L11.6 8.2L16.5 8.3L12.6 11.2L14.1 15.9L10 13L5.9 15.9L7.4 11.2L3.5 8.3L8.4 8.2Z" fill="currentColor" />
          </svg>
        )
      case 'question':
        return (
          <svg className="pdf-annotation-stamp-icon" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M7.3 7.6C7.5 5.9 8.8 4.9 10.5 4.9C12.3 4.9 13.6 6 13.6 7.6C13.6 8.8 12.9 9.5 11.9 10.1C10.9 10.7 10.3 11.3 10.3 12.4V12.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="10.3" cy="15.4" r="1.1" fill="currentColor" />
          </svg>
        )
      case 'todo':
        return (
          <svg className="pdf-annotation-stamp-icon" viewBox="0 0 20 20" aria-hidden="true">
            <rect x="4.7" y="4.7" width="10.6" height="10.6" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M7.5 10.2L9.1 11.8L12.7 8.2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )
      case 'done':
        return (
          <svg className="pdf-annotation-stamp-icon" viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="10" cy="10" r="5.8" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M7.2 10.2L9.2 12.2L13 8.4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )
      case 'warning':
        return (
          <svg className="pdf-annotation-stamp-icon" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M10 4.2L15.8 14.7H4.2L10 4.2Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            <path d="M10 8V11.1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="10" cy="13.4" r="1" fill="currentColor" />
          </svg>
        )
      case 'info':
        return (
          <svg className="pdf-annotation-stamp-icon" viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="10" cy="10" r="5.8" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M10 9V13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="10" cy="6.4" r="1" fill="currentColor" />
          </svg>
        )
      case 'flag':
        return (
          <svg className="pdf-annotation-stamp-icon" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M6 4.5V15.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M6.8 5.2H14.8L12.6 8.4L14.8 11.4H6.8Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          </svg>
        )
      case 'pin':
        return (
          <svg className="pdf-annotation-stamp-icon" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M8.1 5.3C8.1 4.2 9 3.3 10.1 3.3C11.2 3.3 12.1 4.2 12.1 5.3C12.1 5.9 11.8 6.5 11.3 6.9L13.2 9.6L10.8 10.1L10.3 15.5L9.6 15.5L9.1 10.1L6.7 9.6L8.7 6.9C8.3 6.5 8.1 5.9 8.1 5.3Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
        )
    }
  }

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

  const applyStampResizeDraft = (nextDraft: { annotationId: string; rect: Rect } | null) => {
    stampResizeDraftRef.current = nextDraft
    setStampResizeDraft((prev) => {
      if (prev === nextDraft) return prev
      if (!prev || !nextDraft) return nextDraft
      if (
        prev.annotationId === nextDraft.annotationId &&
        prev.rect.x1 === nextDraft.rect.x1 &&
        prev.rect.y1 === nextDraft.rect.y1 &&
        prev.rect.x2 === nextDraft.rect.x2 &&
        prev.rect.y2 === nextDraft.rect.y2
      ) {
        return prev
      }
      return nextDraft
    })
  }

  const commitFreeTextResizeDraft = (nextDraft: { annotationId: string; rect: Rect } | null) => {
    freeTextResizeDraftRef.current = nextDraft
    setFreeTextResizeDraft((prev) => {
      if (prev === nextDraft) return prev
      if (!prev || !nextDraft) return nextDraft
      if (
        prev.annotationId === nextDraft.annotationId &&
        prev.rect.x1 === nextDraft.rect.x1 &&
        prev.rect.y1 === nextDraft.rect.y1 &&
        prev.rect.x2 === nextDraft.rect.x2 &&
        prev.rect.y2 === nextDraft.rect.y2
      ) {
        return prev
      }
      return nextDraft
    })
  }

  const setLiveFreeTextRect = (annotationId: string, rect: Rect | null) => {
    const root = rootRef.current
    if (!root) return
    const selector = `.pdf-annotation-block[data-annotation-id="${annotationId}"]`
    const annotationElement = root.querySelector<HTMLElement>(selector)
    if (!annotationElement) return
    if (!rect) {
      annotationElement.style.removeProperty('--pdf-free-text-left')
      annotationElement.style.removeProperty('--pdf-free-text-top')
      annotationElement.style.removeProperty('--pdf-free-text-width')
      annotationElement.style.removeProperty('--pdf-free-text-height')
      if (freeTextLiveAnnotationIdRef.current === annotationId) {
        freeTextLiveAnnotationIdRef.current = null
      }
      return
    }
    freeTextLiveAnnotationIdRef.current = annotationId
    annotationElement.style.setProperty('--pdf-free-text-left', `${rect.x1 * 100}%`)
    annotationElement.style.setProperty('--pdf-free-text-top', `${rect.y1 * 100}%`)
    annotationElement.style.setProperty('--pdf-free-text-width', `${(rect.x2 - rect.x1) * 100}%`)
    annotationElement.style.setProperty('--pdf-free-text-height', `${(rect.y2 - rect.y1) * 100}%`)
  }

  const applyFreeTextResizeDraft = (nextDraft: { annotationId: string; rect: Rect } | null) => {
    freeTextResizeDraftRef.current = nextDraft
    if (!nextDraft) {
      const liveAnnotationId = freeTextLiveAnnotationIdRef.current
      if (liveAnnotationId) {
        setLiveFreeTextRect(liveAnnotationId, null)
      }
      return
    }
    setLiveFreeTextRect(nextDraft.annotationId, nextDraft.rect)
  }

  const setSelectionAssistRegionDefaults = () => {
    const root = rootRef.current
    if (!root) return
    if (assistRegionSnapshotRef.current === 'defaults') return
    assistRegionSnapshotRef.current = 'defaults'
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
    const nextSnapshot = [
      lineRight.toFixed(2),
      paddedLineTop.toFixed(2),
      paddedLineBottom.toFixed(2),
      pageRect.width.toFixed(2),
      pageRect.height.toFixed(2),
    ].join('|')
    if (assistRegionSnapshotRef.current === nextSnapshot) return
    assistRegionSnapshotRef.current = nextSnapshot
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
    visualTextLayoutRef.current = null
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

  useEffect(() => {
    if (!activeTextBoxDraft) return
    const frame = window.requestAnimationFrame(() => {
      const input = freeTextEditorRef.current
      if (!input) return
      input.style.height = '0px'
      input.style.height = `${Math.max(input.scrollHeight, input.clientHeight)}px`
      const computed = window.getComputedStyle(input)
      const lineHeight = Number.parseFloat(computed.lineHeight)
      freeTextEditorLineCountRef.current =
        Number.isFinite(lineHeight) && lineHeight > 0
          ? Math.max(1, Math.round(input.scrollHeight / lineHeight))
          : 1
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)
    })
    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [activeTextBoxDraft, activeTextBoxInitialValue, activeTextBoxEditorKey])

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
      visualTextLayoutRef.current = null
      pageView?.destroy()
      container.replaceChildren()
    }
  }, [pdfDocument, pageNumber, scale])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    let frame = 0
    let selectionChangeFrame = 0
    let settledSelectionFrame = 0
    let settledSelectionInnerFrame = 0
    let selectionMoveFrame = 0
    let pendingSelectionMove: { clientX: number; clientY: number } | null = null
    let pendingSelectionPreview:
      | {
          pageRect: DOMRect
          normalizedRawRects: RectLike[]
          text: string
        }
      | null = null
    let lastSelectionCaretSample:
      | {
          clientX: number
          clientY: number
          time: number
        }
      | null = null
    let lastNativeSelectionSnapshot:
      | {
          anchorNode: Node | null
          anchorOffset: number
          focusNode: Node | null
          focusOffset: number
          text: string
          collapsed: boolean
        }
      | null = null
    const normalizeSelectionRects = (rawRects: DOMRectList | DOMRect[]) => {
      const pageEl = root.querySelector('.page') as HTMLElement | null
      if (!pageEl) return [] as RectLike[]

      return Array.from(rawRects)
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => ({
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        }))
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

    const readSelectionPreview = () => {
      const selection = window.getSelection()
      if (!selection || !selectionBelongsToCurrentPage(selection)) {
        pendingSelectionPreview = null
        clearSelectionBlocks()
        setSelectionAssistRegionDefaults()
        lastPublishedSelectionSnapshotRef.current = null
        if (!isPointerSelectionActiveRef.current) {
          publishSelection(null)
        }
        return null
      }

      const pageEl = root.querySelector('.page') as HTMLElement | null
      if (!pageEl) {
        pendingSelectionPreview = null
        clearSelectionBlocks()
        lastPublishedSelectionSnapshotRef.current = null
        if (!isPointerSelectionActiveRef.current) {
          publishSelection(null)
        }
        return null
      }

      const pageRect = pageEl.getBoundingClientRect()
      const normalizedRawRects = normalizeSelectionRects(selection.getRangeAt(0).getClientRects())
      setSelectionAssistRegionFromRects(pageRect, normalizedRawRects)
      return {
        pageRect,
        normalizedRawRects,
        text: selection.toString().trim(),
      }
    }

    const updateSelectionBlocks = () => {
      frame = 0

      const shouldDeferSelectionPublish = isPointerSelectionActiveRef.current
      const preview = pendingSelectionPreview ?? readSelectionPreview()
      pendingSelectionPreview = null
      if (!preview) return

      const { pageRect, normalizedRawRects, text } = preview
      if (textRectsDirtyRef.current || textRectsRef.current.length === 0) {
        return
      }
      const textRects = textRectsRef.current

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

      const rectsKey = rects
        .map((rect) =>
          [
            rect.x1.toFixed(4),
            rect.y1.toFixed(4),
            rect.x2.toFixed(4),
            rect.y2.toFixed(4),
          ].join(','),
        )
        .join('|')
      const nextSelectionSnapshot = {
        text,
        rectsKey,
      }
      const lastPublishedSelectionSnapshot = lastPublishedSelectionSnapshotRef.current
      if (
        lastPublishedSelectionSnapshot &&
        lastPublishedSelectionSnapshot.text === nextSelectionSnapshot.text &&
        lastPublishedSelectionSnapshot.rectsKey === nextSelectionSnapshot.rectsKey
      ) {
        applySelectionBlocks(nextBlocks)
        return
      }
      lastPublishedSelectionSnapshotRef.current = nextSelectionSnapshot
      applySelectionBlocks(nextBlocks)
      if (shouldDeferSelectionPublish) return
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

    const getSpanCaret = (span: HTMLElement, atEnd: boolean): TextCaret | null => {
      const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT)
      let textNode = walker.nextNode()
      if (!textNode) return null
      if (atEnd) {
        let nextNode = walker.nextNode()
        while (nextNode) {
          textNode = nextNode
          nextNode = walker.nextNode()
        }
      }
      return {
        node: textNode,
        offset: atEnd ? textNode.textContent?.length ?? 0 : 0,
      }
    }

    const getTextSpanAtPoint = (x: number, y: number): HTMLElement | null => {
      const element = document.elementFromPoint(x, y)
      const span = element?.closest<HTMLElement>('.textLayer span') ?? null
      return span && root.contains(span) ? span : null
    }

    const isTextLayerCaret = (caret: TextCaret, span: HTMLElement): boolean => {
      const element = caret.node instanceof Element ? caret.node : caret.node.parentElement
      return !!element && span.contains(element)
    }

    const getCaretAtPoint = (x: number, y: number): TextCaret | null => {
      const hitSpan = getTextSpanAtPoint(x, y)
      if (!hitSpan) return null

      const position = document.caretPositionFromPoint?.(x, y)
      if (position) {
        const caret = { node: position.offsetNode, offset: position.offset }
        if (isTextLayerCaret(caret, hitSpan)) {
          if (PDF_TEXT_LAYER_DEBUG) {
            console.log('[pdf-text-layer]', 'getCaretAtPoint(caretPositionFromPoint)', {
              x,
              y,
              hitText: hitSpan.textContent,
              caretOffset: caret.offset,
              caretNodeText: caret.node.textContent,
            })
          }
          return caret
        }
      }

      const range = document.caretRangeFromPoint?.(x, y)
      if (range) {
        const caret = { node: range.startContainer, offset: range.startOffset }
        if (isTextLayerCaret(caret, hitSpan)) {
          if (PDF_TEXT_LAYER_DEBUG) {
            console.log('[pdf-text-layer]', 'getCaretAtPoint(caretRangeFromPoint)', {
              x,
              y,
              hitText: hitSpan.textContent,
              caretOffset: caret.offset,
              caretNodeText: caret.node.textContent,
            })
          }
          return caret
        }
      }

      return null
    }

    const getLineEdgeCaretAtPoint = (x: number, y: number): TextCaret | null => {
      const spans = Array.from(root.querySelectorAll<HTMLElement>('.textLayer span'))
        .map((span) => ({ span, rect: span.getBoundingClientRect() }))
        .filter(({ span, rect }) => span.textContent?.trim() && rect.width > 0 && rect.height > 0)
      const lineSpans = spans.filter(({ rect }) => y >= rect.top - 8 && y <= rect.bottom + 8)
      if (lineSpans.length === 0) return null

      const preceding = lineSpans.filter(({ rect }) => rect.left <= x)
      if (preceding.length > 0) {
        const target = preceding.reduce((rightmost, current) =>
          current.rect.right > rightmost.rect.right ? current : rightmost,
        )
        const caret = getSpanCaret(target.span, true)
        if (PDF_TEXT_LAYER_DEBUG) {
          console.log('[pdf-text-layer]', 'getLineEdgeCaretAtPoint(end)', {
            x,
            y,
            spanText: target.span.textContent,
            rectRight: target.rect.right,
            caretOffset: caret?.offset ?? null,
            caretNodeText: caret?.node.textContent ?? null,
          })
        }
        return caret
      }

      const target = lineSpans.reduce((leftmost, current) =>
        current.rect.left < leftmost.rect.left ? current : leftmost,
      )
      const caret = getSpanCaret(target.span, false)
      if (PDF_TEXT_LAYER_DEBUG) {
        console.log('[pdf-text-layer]', 'getLineEdgeCaretAtPoint(start)', {
          x,
          y,
          spanText: target.span.textContent,
          rectLeft: target.rect.left,
          caretOffset: caret?.offset ?? null,
          caretNodeText: caret?.node.textContent ?? null,
        })
      }
      return caret
    }

    const restoreSelectionFromCarets = (anchor: TextCaret | null, focus: TextCaret | null) => {
      if (!anchor || !focus) return
      try {
        const selection = window.getSelection()
        if (!selection) return
        selection.removeAllRanges()
        selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset)
      } catch {
        // pdf.js 可能在虚拟页卸载时移除 text layer；此时保留浏览器原生选区。
      }
    }

    const getVisualTextLayout = (): VisualTextLayout | null => {
      const cached = visualTextLayoutRef.current
      if (cached) return cached
      const spans = Array.from(root.querySelectorAll<HTMLElement>('.textLayer span'))
        .map((span) => ({ span, rect: span.getBoundingClientRect() }))
        .filter(({ span, rect }) => span.textContent?.trim() && rect.width > 0 && rect.height > 0)
        .sort((left, right) => left.rect.top - right.rect.top || left.rect.left - right.rect.left)
      if (spans.length === 0) return null

      const rows: VisualSpanLayout[][] = []
      for (const item of spans) {
        const row = rows.at(-1)
        const rowCenter = row
          ? row.reduce((total, current) => total + (current.rect.top + current.rect.bottom) / 2, 0) / row.length
          : 0
        const itemCenter = (item.rect.top + item.rect.bottom) / 2
        const rowHeight = row
          ? row.reduce((total, current) => total + current.rect.height, 0) / row.length
          : 0
        if (!row || Math.abs(itemCenter - rowCenter) > Math.max(3, Math.min(rowHeight, item.rect.height) * 0.6)) {
          rows.push([item])
        } else {
          row.push(item)
        }
      }

      const lines: VisualLine[] = []
      for (const row of rows) {
        const ordered = [...row].sort((left, right) => left.rect.left - right.rect.left)
        let lineSpans: VisualSpanLayout[] = []
        const appendLine = () => {
          if (lineSpans.length === 0) return
          const rects = lineSpans.map(({ rect }) => rect)
          lines.push({
            spans: lineSpans,
            top: Math.min(...rects.map((rect) => rect.top)),
            bottom: Math.max(...rects.map((rect) => rect.bottom)),
            left: Math.min(...rects.map((rect) => rect.left)),
            right: Math.max(...rects.map((rect) => rect.right)),
            height: rects.reduce((total, rect) => total + rect.height, 0) / rects.length,
          })
          lineSpans = []
        }

        for (const item of ordered) {
          const previous = lineSpans.at(-1)
          const gap = previous ? item.rect.left - previous.rect.right : 0
          const gapLimit = previous ? Math.max(24, Math.max(previous.rect.height, item.rect.height) * 3) : 0
          if (previous && gap > gapLimit) appendLine()
          lineSpans.push(item)
        }
        appendLine()
      }

      const lineBySpan = new Map<HTMLElement, VisualLine>()
      for (const line of lines) {
        for (const { span } of line.spans) {
          lineBySpan.set(span, line)
        }
      }
      const layout = { lines, lineBySpan }
      visualTextLayoutRef.current = layout
      return layout
    }

    const selectVisualParagraph = (targetSpan: HTMLElement) => {
      const layout = getVisualTextLayout()
      if (!layout) return
      const targetLine = layout.lineBySpan.get(targetSpan)
      if (!targetLine) return
      const columnTolerance = Math.max(24, targetLine.height * 2)
      const columnLines = layout.lines
        .filter((line) => Math.abs(line.left - targetLine.left) <= columnTolerance)
        .sort((left, right) => left.top - right.top)
      const targetIndex = columnLines.indexOf(targetLine)
      if (targetIndex < 0) return

      let firstIndex = targetIndex
      let lastIndex = targetIndex
      const canJoin = (previous: VisualLine, next: VisualLine) => {
        const verticalGap = next.top - previous.bottom
        const lineHeight = Math.max(previous.height, next.height)
        const beginsIndentedBlock = next.left - previous.left > Math.max(12, lineHeight * 0.75)
        return verticalGap <= Math.max(8, lineHeight * 0.9) && !beginsIndentedBlock
      }

      while (firstIndex > 0 && canJoin(columnLines[firstIndex - 1], columnLines[firstIndex])) {
        firstIndex -= 1
      }
      while (lastIndex < columnLines.length - 1 && canJoin(columnLines[lastIndex], columnLines[lastIndex + 1])) {
        lastIndex += 1
      }

      const firstSpan = columnLines[firstIndex].spans[0]?.span
      const lastSpan = columnLines[lastIndex].spans.at(-1)?.span
      if (!firstSpan || !lastSpan) return
      restoreSelectionFromCarets(getSpanCaret(firstSpan, false), getSpanCaret(lastSpan, true))
    }

    const buildDraftRect = (
      start: { x: number; y: number },
      end: { x: number; y: number },
      shapeType: Extract<AnnotationType, 'square' | 'circle' | 'line' | 'arrow'> | null,
      constrainAspectRatio: boolean,
    ): Rect => {
      if (shapeType === 'line' || shapeType === 'arrow') {
        return {
          x1: start.x,
          y1: start.y,
          x2: end.x,
          y2: end.y,
        }
      }
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

    const buildStampRect = (
      point: { x: number; y: number },
      _label: string,
    ): Rect => {
      const width = activeStampSize
      const height = activeStampSize
      const x1 = Math.min(Math.max(point.x - width / 2, 0), Math.max(0, 1 - width))
      const y1 = Math.min(Math.max(point.y - height / 2, 0), Math.max(0, 1 - height))
      return {
        x1,
        y1,
        x2: x1 + width,
        y2: y1 + height,
      }
    }

    const buildFreeTextRect = (point: { x: number; y: number }): Rect => {
      const width = 0.22
      const height = 0.034
      const x1 = Math.min(Math.max(point.x, 0), Math.max(0, 1 - width))
      const y1 = Math.min(Math.max(point.y, 0), Math.max(0, 1 - height))
      return {
        x1,
        y1,
        x2: x1 + width,
        y2: y1 + height,
      }
    }

    const scheduleUpdate = () => {
      if (frame) return
      frame = window.requestAnimationFrame(updateSelectionBlocks)
    }

    const scheduleSettledSelectionUpdate = () => {
      if (settledSelectionFrame || settledSelectionInnerFrame) return
      settledSelectionFrame = window.requestAnimationFrame(() => {
        settledSelectionFrame = 0
        settledSelectionInnerFrame = window.requestAnimationFrame(() => {
          settledSelectionInnerFrame = 0
          if (frame) {
            window.cancelAnimationFrame(frame)
            frame = 0
          }
          updateSelectionBlocks()
        })
      })
    }

    const processSelectionChange = () => {
      selectionChangeFrame = 0
      if (isPointerSelectionActiveRef.current) {
        return
      }
      if (activeShapeTool || activeStampLabel || activeFreeTextTool || activeNoteTool) {
        return
      }

      const selection = window.getSelection()
      const nextNativeSelectionSnapshot = selection
        ? {
            anchorNode: selection.anchorNode,
            anchorOffset: selection.anchorOffset,
            focusNode: selection.focusNode,
            focusOffset: selection.focusOffset,
            text: selection.toString(),
            collapsed: selection.isCollapsed,
          }
        : null
      if (
        lastNativeSelectionSnapshot &&
        nextNativeSelectionSnapshot &&
        lastNativeSelectionSnapshot.anchorNode === nextNativeSelectionSnapshot.anchorNode &&
        lastNativeSelectionSnapshot.anchorOffset === nextNativeSelectionSnapshot.anchorOffset &&
        lastNativeSelectionSnapshot.focusNode === nextNativeSelectionSnapshot.focusNode &&
        lastNativeSelectionSnapshot.focusOffset === nextNativeSelectionSnapshot.focusOffset &&
        lastNativeSelectionSnapshot.text === nextNativeSelectionSnapshot.text &&
        lastNativeSelectionSnapshot.collapsed === nextNativeSelectionSnapshot.collapsed
      ) {
        return
      }
      lastNativeSelectionSnapshot = nextNativeSelectionSnapshot
      pendingSelectionPreview = readSelectionPreview()
      if (!pendingSelectionPreview) {
        return
      }
      scheduleUpdate()
    }

    const flushSelectionPointerMove = () => {
      selectionMoveFrame = 0
      const latest = pendingSelectionMove
      if (!latest) return
      pendingSelectionMove = null
      if (!isPointerSelectionActiveRef.current) return

      const now = window.performance.now()
      const lastSample = lastSelectionCaretSample
      const shouldSampleCaret =
        !lastSample ||
        now - lastSample.time >= 24 ||
        Math.hypot(latest.clientX - lastSample.clientX, latest.clientY - lastSample.clientY) >= 2

      if (shouldSampleCaret) {
        lastSelectionCaretSample = {
          clientX: latest.clientX,
          clientY: latest.clientY,
          time: now,
        }
        const caret = getCaretAtPoint(latest.clientX, latest.clientY)
        if (caret) {
          lastValidSelectionCaretRef.current = caret
        }
      }
      const rootNode = rootRef.current
      if (!rootNode) return
      const pageEl = rootNode.querySelector('.page') as HTMLElement | null
      const region = assistRegionRef.current
      if (!pageEl || !region) {
        rootNode.classList.remove('is-selection-assist-active')
        return
      }

      const pageRect = pageEl.getBoundingClientRect()
      const x = latest.clientX - pageRect.left
      const y = latest.clientY - pageRect.top
      const active =
        x >= region.left &&
        x <= region.right &&
        y >= region.top &&
        y <= region.bottom

      if (active) {
        const assistLeft = Math.max(region.left, x - 24)
        rootNode.style.setProperty('--pdf-text-selection-assist-left', `${assistLeft}px`)
      } else {
        rootNode.style.setProperty('--pdf-text-selection-assist-left', `${region.left}px`)
      }

      rootNode.classList.toggle('is-selection-assist-active', active)
    }

    const scheduleSelectionPointerMove = (event: PointerEvent) => {
      pendingSelectionMove = {
        clientX: event.clientX,
        clientY: event.clientY,
      }
      if (selectionMoveFrame) return
      selectionMoveFrame = window.requestAnimationFrame(flushSelectionPointerMove)
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      const target = event.target
      if (!(target instanceof Node) || !root.contains(target)) return
      const targetElement = target instanceof Element ? target : null
      if (
        targetElement?.closest('.pdf-annotation-free-text-editor') ||
        targetElement?.closest('.pdf-annotation-note-editor')
      ) {
        return
      }
      if (activeTextBoxDraft) {
        return
      }
      const lineHandle = targetElement?.closest<SVGElement | HTMLElement>('[data-line-handle]') ?? null
      if (lineHandle) {
        const annotationId = lineHandle.dataset.annotationId
        const handle = lineHandle.dataset.lineHandle
        const annotation =
          annotationId && (handle === 'start' || handle === 'end')
            ? annotations.find(
                (item) =>
                  item.id === annotationId &&
                  (item.type === 'line' || item.type === 'arrow'),
              ) ?? null
            : null
        const points = annotation?.linePoints ?? null
        if (annotationId && points && (handle === 'start' || handle === 'end')) {
          event.preventDefault()
          event.stopPropagation()
          resizingLineStateRef.current = {
            annotationId,
            handle,
            startPoints: points,
          }
          applyLineResizeDraft({
            annotationId,
            rect: buildPaddedLineRect(points),
            linePoints: points,
          })
          return
        }
      }
      const lineMoveZone = targetElement?.closest<SVGElement | HTMLElement>('[data-line-move-zone]') ?? null
      if (lineMoveZone) {
        const annotationId = lineMoveZone.dataset.annotationId
        const annotation =
          annotationId
            ? annotations.find(
                (item) =>
                  item.id === annotationId &&
                  (item.type === 'line' || item.type === 'arrow'),
              ) ?? null
            : null
        const points = annotation?.linePoints ?? null
        const point = getPageRelativePoint(event)
        if (annotationId && points && point) {
          event.preventDefault()
          event.stopPropagation()
          movingLineStateRef.current = {
            annotationId,
            origin: point,
            startPoints: points,
          }
          applyLineResizeDraft({
            annotationId,
            rect: buildPaddedLineRect(points),
            linePoints: points,
          })
          return
        }
      }
      const annotationBlock = targetElement?.closest<HTMLElement>('.pdf-annotation-block') ?? null
      if (annotationBlock instanceof HTMLElement) {
        const annotationId = annotationBlock.dataset.annotationId
        if (annotationId && annotationId === selectedAnnotationId) {
          const noteMarker = targetElement?.closest<HTMLElement>('.pdf-annotation-note-marker') ?? null
          if (noteMarker) {
            return
          }
          const freeTextAnnotation =
            annotations.find(
              (annotation) =>
                annotation.id === annotationId &&
                (annotation.type === 'freeText' || annotation.type === 'note'),
            ) ?? null
          const freeTextRect = freeTextAnnotation?.rects[0] ?? null
          if (freeTextAnnotation && freeTextRect && !activeTextBoxDraft) {
            const handle = targetElement?.closest<HTMLElement>('[data-free-text-handle]')?.dataset.freeTextHandle
            if (
              handle === 'left' ||
              handle === 'right' ||
              handle === 'top' ||
              handle === 'bottom' ||
              handle === 'tl' ||
              handle === 'tr' ||
              handle === 'bl' ||
              handle === 'br'
            ) {
              event.preventDefault()
              event.stopPropagation()
              resizingFreeTextStateRef.current = {
                annotationId,
                handle,
                startRect: freeTextRect,
                minWidth: 0.06,
                minHeight: 0.034,
              }
              applyFreeTextResizeDraft({
                annotationId,
                rect: freeTextRect,
              })
              return
            }
            const freeTextMoveZone = targetElement?.closest<HTMLElement>('[data-free-text-move-zone]')
            if (freeTextMoveZone) {
              const blockRect = annotationBlock.getBoundingClientRect()
              event.preventDefault()
              event.stopPropagation()
              movingFreeTextStateRef.current = {
                annotationId,
                pointerOffsetX: event.clientX - blockRect.left,
                pointerOffsetY: event.clientY - blockRect.top,
                width: freeTextRect.x2 - freeTextRect.x1,
                height: freeTextRect.y2 - freeTextRect.y1,
              }
              applyFreeTextResizeDraft({
                annotationId,
                rect: freeTextRect,
              })
              return
            }
          }
          const stampAnnotation =
            annotations.find((annotation) => annotation.id === annotationId && annotation.type === 'stamp') ?? null
          const stampRect = stampAnnotation?.rects[0] ?? null
          if (stampAnnotation && stampRect) {
            const blockRect = annotationBlock.getBoundingClientRect()
            const localX = event.clientX - blockRect.left
            const localY = event.clientY - blockRect.top
            const edgeThreshold = Math.min(12, Math.max(6, Math.min(blockRect.width, blockRect.height) * 0.28))
            const nearEdge =
              localX <= edgeThreshold ||
              localX >= blockRect.width - edgeThreshold ||
              localY <= edgeThreshold ||
              localY >= blockRect.height - edgeThreshold
            if (nearEdge) {
              event.preventDefault()
              event.stopPropagation()
              resizingStampStateRef.current = {
                annotationId,
                centerX: (stampRect.x1 + stampRect.x2) / 2,
                centerY: (stampRect.y1 + stampRect.y2) / 2,
                minHalfSize: MIN_STAMP_SIZE / 2,
              }
              applyStampResizeDraft({
                annotationId,
                rect: stampRect,
              })
              return
            }
            event.preventDefault()
            event.stopPropagation()
            movingStampStateRef.current = {
              annotationId,
              pointerOffsetX: event.clientX - blockRect.left,
              pointerOffsetY: event.clientY - blockRect.top,
              width: stampRect.x2 - stampRect.x1,
              height: stampRect.y2 - stampRect.y1,
            }
            applyStampResizeDraft({
              annotationId,
              rect: stampRect,
            })
            return
          }
        }
        return
      }
      if (!targetElement?.closest('.textLayer') && clearSelectionOnBlankClick) {
        window.getSelection()?.removeAllRanges()
        selectionAnchorCaretRef.current = null
        lastValidSelectionCaretRef.current = null
        clearSelectionBlocks()
        publishSelection(null)
        setSelectionAssistRegionDefaults()
        setPointerSelectingState(false)
        return
      }
      if (activeFreeTextTool || activeNoteTool) {
        const point = getPageRelativePoint(event)
        if (!point) return
        event.preventDefault()
        onClearAnnotationSelection?.()
        clearSelectionBlocks()
        publishSelection(null)
        setSelectionAssistRegionDefaults()
        const draft = {
          page: pageNumber,
          rect: buildFreeTextRect(point),
        }
        if (activeFreeTextTool) {
          onFreeTextCreate?.(draft)
        } else {
          onNoteCreate?.(draft)
        }
        return
      }
      if (activeStampLabel) {
        const point = getPageRelativePoint(event)
        if (!point) return
        event.preventDefault()
        onClearAnnotationSelection?.()
        clearSelectionBlocks()
        publishSelection(null)
        setSelectionAssistRegionDefaults()
        onStampCreate?.({
          page: pageNumber,
          rect: buildStampRect(point, activeStampLabel),
          kind: activeStampKind ?? 'important',
          label: activeStampLabel,
        })
        return
      }
      if (activeShapeTool === 'line' || activeShapeTool === 'arrow') {
        const point = getPageRelativePoint(event)
        if (!point) return
        event.preventDefault()
        onClearAnnotationSelection?.()
        clearSelectionBlocks()
        publishSelection(null)
        setSelectionAssistRegionDefaults()
        const start = shapeDraftStartRef.current
        if (!start) {
          shapeDraftStartRef.current = point
          setLineDraftOrigin(point)
          applyShapeDraftRect({
            x1: point.x,
            y1: point.y,
            x2: point.x,
            y2: point.y,
          })
          return
        }
        const draftRect = {
          x1: start.x,
          y1: start.y,
          x2: point.x,
          y2: point.y,
        }
        shapeDraftStartRef.current = null
        setLineDraftOrigin(null)
        applyShapeDraftRect(null)
        if (Math.hypot(draftRect.x2 - draftRect.x1, draftRect.y2 - draftRect.y1) >= 0.01) {
          onShapeCreate?.({
            page: pageNumber,
            rect: buildPaddedLineRect(draftRect),
            type: activeShapeTool,
            linePoints: draftRect,
          })
        }
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
      const anchorCaret =
        getCaretAtPoint(event.clientX, event.clientY) ??
        getLineEdgeCaretAtPoint(event.clientX, event.clientY)
      selectionAnchorCaretRef.current = anchorCaret
      lastValidSelectionCaretRef.current = anchorCaret
      lastSelectionCaretSample = null
      setPointerSelectingState(true)
      clearSelectionBlocks()
    }

    const handleTextSelectionClick = (event: MouseEvent) => {
      if (!clearSelectionOnBlankClick || event.button !== 0 || event.detail < 2) return
      const target = event.target
      if (!(target instanceof Element)) return
      const span = target.closest<HTMLElement>('.textLayer span')
      if (!span || !root.contains(span)) return

      if (event.detail >= 3) selectVisualParagraph(span)
      scheduleUpdate()
    }

    const handlePointerFinish = (event: PointerEvent) => {
      const movingFreeText = movingFreeTextStateRef.current
      if (movingFreeText) {
        const draft = freeTextResizeDraftRef.current
        movingFreeTextStateRef.current = null
        if (draft && draft.annotationId === movingFreeText.annotationId) {
          commitFreeTextResizeDraft(draft)
          const annotation = annotations.find((item) => item.id === draft.annotationId) ?? null
          if (annotation?.type === 'note') {
            onNoteResize?.(draft)
          } else {
            onFreeTextResize?.(draft)
          }
        } else {
          applyFreeTextResizeDraft(null)
        }
        return
      }
      const resizingFreeText = resizingFreeTextStateRef.current
      if (resizingFreeText) {
        const draft = freeTextResizeDraftRef.current
        resizingFreeTextStateRef.current = null
        if (draft && draft.annotationId === resizingFreeText.annotationId) {
          commitFreeTextResizeDraft(draft)
          const annotation = annotations.find((item) => item.id === draft.annotationId) ?? null
          if (annotation?.type === 'note') {
            onNoteResize?.(draft)
          } else {
            onFreeTextResize?.(draft)
          }
        } else {
          applyFreeTextResizeDraft(null)
        }
        return
      }
      const movingLine = movingLineStateRef.current
      if (movingLine) {
        const draft = lineResizeDraftRef.current
        movingLineStateRef.current = null
        applyLineResizeDraft(null)
        if (draft && draft.annotationId === movingLine.annotationId) {
          onLineResize?.(draft)
        }
        return
      }
      const resizingLine = resizingLineStateRef.current
      if (resizingLine) {
        const draft = lineResizeDraftRef.current
        resizingLineStateRef.current = null
        applyLineResizeDraft(null)
        if (draft && draft.annotationId === resizingLine.annotationId) {
          onLineResize?.(draft)
        }
        return
      }
      const movingStamp = movingStampStateRef.current
      if (movingStamp) {
        const draft = stampResizeDraftRef.current
        movingStampStateRef.current = null
        applyStampResizeDraft(null)
        if (draft && draft.annotationId === movingStamp.annotationId) {
          onStampResize?.(draft)
        }
        return
      }
      const resizingStamp = resizingStampStateRef.current
      if (resizingStamp) {
        const draft = stampResizeDraftRef.current
        resizingStampStateRef.current = null
        applyStampResizeDraft(null)
        if (draft && draft.annotationId === resizingStamp.annotationId) {
          onStampResize?.(draft)
        }
        return
      }
      if (isShapeDrawingActiveRef.current) {
        const draftRect = shapeDraftRectRef.current
        shapeDraftStartRef.current = null
        isShapeDrawingActiveRef.current = false
        applyShapeDraftRect(null)
        if (
          activeShapeTool &&
          draftRect &&
          (
            activeShapeTool === 'line' ||
            activeShapeTool === 'arrow'
              ? Math.hypot(draftRect.x2 - draftRect.x1, draftRect.y2 - draftRect.y1) >= 0.01
              : (draftRect.x2 - draftRect.x1 >= 0.006 && draftRect.y2 - draftRect.y1 >= 0.006)
          )
        ) {
          const rect =
            activeShapeTool === 'line' || activeShapeTool === 'arrow'
              ? {
                  x1: Math.min(draftRect.x1, draftRect.x2),
                  y1: Math.min(draftRect.y1, draftRect.y2),
                  x2: Math.max(draftRect.x1, draftRect.x2),
                  y2: Math.max(draftRect.y1, draftRect.y2),
                }
              : draftRect
          onShapeCreate?.({
            page: pageNumber,
            rect,
            type: activeShapeTool,
            linePoints:
              activeShapeTool === 'line' || activeShapeTool === 'arrow'
                ? draftRect
                : undefined,
          })
        }
        return
      }
      if (!isPointerSelectionActiveRef.current) return
      setPointerSelectingState(false)
      if (selectionMoveFrame) {
        window.cancelAnimationFrame(selectionMoveFrame)
        selectionMoveFrame = 0
      }
      pendingSelectionMove = null
      lastSelectionCaretSample = null
      const pointerCaret = getCaretAtPoint(event.clientX, event.clientY)
      const lastValidCaret = lastValidSelectionCaretRef.current
      const anchorCaret = selectionAnchorCaretRef.current
      const movedFromAnchor =
        !!anchorCaret &&
        !!lastValidCaret &&
        (anchorCaret.node !== lastValidCaret.node || anchorCaret.offset !== lastValidCaret.offset)
      const focusCaret =
        pointerCaret ??
        (movedFromAnchor
          ? lastValidCaret
          : getLineEdgeCaretAtPoint(event.clientX, event.clientY) ?? lastValidCaret)
      if (event.detail < 2) {
        restoreSelectionFromCarets(anchorCaret, focusCaret)
      }
      selectionAnchorCaretRef.current = null
      lastValidSelectionCaretRef.current = null
      if (frame) {
        window.cancelAnimationFrame(frame)
        frame = 0
      }
      if (event.detail >= 3) return
      scheduleSettledSelectionUpdate()
    }

    const handlePointerMove = (event: PointerEvent) => {
      const movingFreeText = movingFreeTextStateRef.current
      if (movingFreeText) {
        const rootNode = rootRef.current
        const pageEl = rootNode?.querySelector('.page') as HTMLElement | null
        if (!pageEl) return
        const pageRect = pageEl.getBoundingClientRect()
        if (pageRect.width <= 0 || pageRect.height <= 0) return
        const width = movingFreeText.width
        const height = movingFreeText.height
        const x1 = Math.min(
          Math.max((event.clientX - pageRect.left - movingFreeText.pointerOffsetX) / pageRect.width, 0),
          Math.max(0, 1 - width),
        )
        const y1 = Math.min(
          Math.max((event.clientY - pageRect.top - movingFreeText.pointerOffsetY) / pageRect.height, 0),
          Math.max(0, 1 - height),
        )
        applyFreeTextResizeDraft({
          annotationId: movingFreeText.annotationId,
          rect: {
            x1,
            y1,
            x2: x1 + width,
            y2: y1 + height,
          },
        })
        return
      }
      const resizingFreeText = resizingFreeTextStateRef.current
      if (resizingFreeText) {
        const point = getPageRelativePoint(event)
        if (!point) return
        const { handle, startRect, minWidth, minHeight } = resizingFreeText
        let x1 = startRect.x1
        let y1 = startRect.y1
        let x2 = startRect.x2
        let y2 = startRect.y2

        if (handle === 'left' || handle === 'tl' || handle === 'bl') {
          x1 = Math.min(Math.max(0, point.x), Math.max(0, startRect.x2 - minWidth))
        }
        if (handle === 'right' || handle === 'tr' || handle === 'br') {
          x2 = Math.max(Math.min(1, point.x), Math.min(1, startRect.x1 + minWidth))
        }
        if (handle === 'top' || handle === 'tl' || handle === 'tr') {
          y1 = Math.min(Math.max(0, point.y), Math.max(0, startRect.y2 - minHeight))
        }
        if (handle === 'bottom' || handle === 'bl' || handle === 'br') {
          y2 = Math.max(Math.min(1, point.y), Math.min(1, startRect.y1 + minHeight))
        }

        const nextRect = { x1, y1, x2, y2 }
        applyFreeTextResizeDraft({
          annotationId: resizingFreeText.annotationId,
          rect: nextRect,
        })
        return
      }
      const movingLine = movingLineStateRef.current
      if (movingLine) {
        const point = getPageRelativePoint(event)
        if (!point) return
        const rawDx = point.x - movingLine.origin.x
        const rawDy = point.y - movingLine.origin.y
        const minDx = -Math.min(movingLine.startPoints.x1, movingLine.startPoints.x2)
        const maxDx = 1 - Math.max(movingLine.startPoints.x1, movingLine.startPoints.x2)
        const minDy = -Math.min(movingLine.startPoints.y1, movingLine.startPoints.y2)
        const maxDy = 1 - Math.max(movingLine.startPoints.y1, movingLine.startPoints.y2)
        const dx = Math.min(Math.max(rawDx, minDx), maxDx)
        const dy = Math.min(Math.max(rawDy, minDy), maxDy)
        const linePoints = {
          x1: movingLine.startPoints.x1 + dx,
          y1: movingLine.startPoints.y1 + dy,
          x2: movingLine.startPoints.x2 + dx,
          y2: movingLine.startPoints.y2 + dy,
        }
        applyLineResizeDraft({
          annotationId: movingLine.annotationId,
          rect: buildPaddedLineRect(linePoints),
          linePoints,
        })
        return
      }
      const resizingLine = resizingLineStateRef.current
      if (resizingLine) {
        const point = getPageRelativePoint(event)
        if (!point) return
        const linePoints =
          resizingLine.handle === 'start'
            ? {
                x1: point.x,
                y1: point.y,
                x2: resizingLine.startPoints.x2,
                y2: resizingLine.startPoints.y2,
              }
            : {
                x1: resizingLine.startPoints.x1,
                y1: resizingLine.startPoints.y1,
                x2: point.x,
                y2: point.y,
              }
        applyLineResizeDraft({
          annotationId: resizingLine.annotationId,
          rect: buildPaddedLineRect(linePoints),
          linePoints,
        })
        return
      }
      const movingStamp = movingStampStateRef.current
      if (movingStamp) {
        const rootNode = rootRef.current
        const pageEl = rootNode?.querySelector('.page') as HTMLElement | null
        if (!pageEl) return
        const pageRect = pageEl.getBoundingClientRect()
        if (pageRect.width <= 0 || pageRect.height <= 0) return
        const width = movingStamp.width
        const height = movingStamp.height
        const x1 = Math.min(
          Math.max((event.clientX - pageRect.left - movingStamp.pointerOffsetX) / pageRect.width, 0),
          Math.max(0, 1 - width),
        )
        const y1 = Math.min(
          Math.max((event.clientY - pageRect.top - movingStamp.pointerOffsetY) / pageRect.height, 0),
          Math.max(0, 1 - height),
        )
        applyStampResizeDraft({
          annotationId: movingStamp.annotationId,
          rect: {
            x1,
            y1,
            x2: x1 + width,
            y2: y1 + height,
          },
        })
        return
      }
      const resizingStamp = resizingStampStateRef.current
      if (resizingStamp) {
        const point = getPageRelativePoint(event)
        if (!point) return
        const halfSize = Math.max(
          resizingStamp.minHalfSize,
          Math.max(Math.abs(point.x - resizingStamp.centerX), Math.abs(point.y - resizingStamp.centerY)),
        )
        const rect = {
          x1: Math.max(0, resizingStamp.centerX - halfSize),
          y1: Math.max(0, resizingStamp.centerY - halfSize),
          x2: Math.min(1, resizingStamp.centerX + halfSize),
          y2: Math.min(1, resizingStamp.centerY + halfSize),
        }
        applyStampResizeDraft({
          annotationId: resizingStamp.annotationId,
          rect,
        })
        return
      }
      if (isShapeDrawingActiveRef.current) {
        const start = shapeDraftStartRef.current
        const point = getPageRelativePoint(event)
        if (!start || !point) return
        applyShapeDraftRect(buildDraftRect(start, point, activeShapeTool, event.shiftKey))
        return
      }
      if ((activeShapeTool === 'line' || activeShapeTool === 'arrow') && shapeDraftStartRef.current) {
        const point = getPageRelativePoint(event)
        if (!point) return
        const start = shapeDraftStartRef.current
        applyShapeDraftRect({
          x1: start.x,
          y1: start.y,
          x2: point.x,
          y2: point.y,
        })
        return
      }
      if (!isPointerSelectionActiveRef.current) return
      scheduleSelectionPointerMove(event)
    }

    const handleSelectionChange = () => {
      if (selectionChangeFrame) return
      selectionChangeFrame = window.requestAnimationFrame(processSelectionChange)
    }

    root.addEventListener('pointerdown', handlePointerDown)
    root.addEventListener('click', handleTextSelectionClick)
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
      root.removeEventListener('click', handleTextSelectionClick)
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', handlePointerFinish)
      document.removeEventListener('pointercancel', handlePointerFinish)
      document.removeEventListener('selectionchange', handleSelectionChange)
      if (selectionChangeFrame) {
        window.cancelAnimationFrame(selectionChangeFrame)
      }
      if (settledSelectionFrame) {
        window.cancelAnimationFrame(settledSelectionFrame)
      }
      if (settledSelectionInnerFrame) {
        window.cancelAnimationFrame(settledSelectionInnerFrame)
      }
      pendingSelectionPreview = null
      setPointerSelectingState(false)
      selectionAnchorCaretRef.current = null
      lastValidSelectionCaretRef.current = null
      lastSelectionCaretSample = null
      shapeDraftStartRef.current = null
      isShapeDrawingActiveRef.current = false
      applyShapeDraftRect(null)
      setLineDraftOrigin(null)
      movingStampStateRef.current = null
      resizingStampStateRef.current = null
      applyStampResizeDraft(null)
      movingFreeTextStateRef.current = null
      resizingFreeTextStateRef.current = null
      freeTextResizeDraftRef.current = null
      applyFreeTextResizeDraft(null)
      movingLineStateRef.current = null
      resizingLineStateRef.current = null
      applyLineResizeDraft(null)
      setSelectionAssistRegionDefaults()
      publishSelection(null)
      lastPublishedSelectionSnapshotRef.current = null
      lastNativeSelectionSnapshot = null
      if (frame) {
        window.cancelAnimationFrame(frame)
      }
      if (selectionMoveFrame) {
        window.cancelAnimationFrame(selectionMoveFrame)
      }
      lastNativeSelectionSnapshot = null
    }
  }, [annotations, selectedAnnotationId, onSelectionChange, pageNumber, pdfDocument, scale, clearSelectionSignal, clearSelectionOnBlankClick, activeShapeTool, onShapeCreate, activeFreeTextTool, activeNoteTool, activeTextBoxDraft, onFreeTextCreate, onNoteCreate, activeStampKind, activeStampLabel, activeStampSize, onStampCreate, onStampResize, onLineResize, onFreeTextResize, onNoteResize, onClearAnnotationSelection])

  useEffect(() => {
    clearSelectionBlocks()
    hasActiveSelectionRef.current = false
    applyShapeDraftRect(null)
    shapeDraftStartRef.current = null
    isShapeDrawingActiveRef.current = false
    setLineDraftOrigin(null)
    movingLineStateRef.current = null
    resizingLineStateRef.current = null
    applyLineResizeDraft(null)
    movingFreeTextStateRef.current = null
    resizingFreeTextStateRef.current = null
    freeTextResizeDraftRef.current = null
    applyFreeTextResizeDraft(null)
    setSelectionAssistRegionDefaults()
    onSelectionChange?.(null)
  }, [clearSelectionSignal, onSelectionChange, activeShapeTool, activeFreeTextTool, activeNoteTool])

  useEffect(() => {
    const draft = freeTextResizeDraft
    if (!draft) return
    const annotation = annotations.find(
      (item) => item.id === draft.annotationId && (item.type === 'freeText' || item.type === 'note'),
    )
    const rect = annotation?.rects[0]
    if (
      rect &&
      rect.x1 === draft.rect.x1 &&
      rect.y1 === draft.rect.y1 &&
      rect.x2 === draft.rect.x2 &&
      rect.y2 === draft.rect.y2
    ) {
      setLiveFreeTextRect(draft.annotationId, null)
      commitFreeTextResizeDraft(null)
    }
  }, [annotations, freeTextResizeDraft])

  const handleFreeTextEditorSave = () => {
    const input = freeTextEditorRef.current
    const value = input?.value.trim() ?? ''
    if (!value) {
      if (activeTextBoxType === 'note') {
        onNoteCancel?.()
      } else {
        onFreeTextCancel?.()
      }
      return
    }
    if (input) {
      input.style.height = '0px'
      input.style.height = `${Math.max(input.scrollHeight, input.clientHeight)}px`
      const computed = window.getComputedStyle(input)
      const lineHeight = Number.parseFloat(computed.lineHeight)
      freeTextEditorLineCountRef.current =
        Number.isFinite(lineHeight) && lineHeight > 0
          ? Math.max(1, Math.round(input.scrollHeight / lineHeight))
          : 1
    }
    const pageEl = rootRef.current?.querySelector('.page') as HTMLElement | null
    const pageHeightPx = pageEl?.getBoundingClientRect().height ?? 0
    const nextRect =
      activeTextBoxDraft && pageHeightPx > 0 && input
        ? {
            ...activeTextBoxDraft.rect,
            y2: Math.min(
              1,
              activeTextBoxDraft.rect.y1 + input.offsetHeight / pageHeightPx,
            ),
          }
        : activeTextBoxDraft?.rect
    if (!nextRect) {
      if (activeTextBoxType === 'note') {
        onNoteCancel?.()
      } else {
        onFreeTextCancel?.()
      }
      return
    }
    if (activeTextBoxType === 'note') {
      onNoteSave?.(value, nextRect)
    } else {
      onFreeTextSave?.(value, nextRect)
    }
  }

  const handleFreeTextEditorCancel = () => {
    if (activeTextBoxType === 'note') {
      onNoteCancel?.()
    } else {
      onFreeTextCancel?.()
    }
  }

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
          annotation.rects.map((annotationRect, index) => {
            const rect =
              (annotation.type === 'line' || annotation.type === 'arrow') &&
              index === 0 &&
              lineResizeDraft &&
              lineResizeDraft.annotationId === annotation.id
                ? lineResizeDraft.rect
                : (
              annotation.type === 'freeText' &&
              index === 0 &&
              freeTextResizeDraft &&
              freeTextResizeDraft.annotationId === annotation.id
                ? freeTextResizeDraft.rect
                : (
              annotation.type === 'note' &&
              index === 0 &&
              freeTextResizeDraft &&
              freeTextResizeDraft.annotationId === annotation.id
                ? freeTextResizeDraft.rect
                : (
              annotation.type === 'stamp' &&
              index === 0 &&
              stampResizeDraft &&
              stampResizeDraft.annotationId === annotation.id
                ? stampResizeDraft.rect
                : annotationRect
                )))
            const left = `${rect.x1 * 100}%`
            const top = `${rect.y1 * 100}%`
            const width = `${(rect.x2 - rect.x1) * 100}%`
            const height = `${(rect.y2 - rect.y1) * 100}%`
            const annotationKey = `${annotation.id}-${index}`
            const isSelected = selectedAnnotationId === annotation.id
            const isPulsing = pulsingAnnotationId === annotation.id
            const notePreview = annotation.note?.trim() || annotation.content?.trim() || ''
            const noteMarker = annotation.note?.trim() && index === 0 ? (
              <div className="pdf-annotation-note-marker" title={notePreview}>
                <span className="pdf-annotation-note-marker-glyph" aria-hidden="true">
                  N
                </span>
              </div>
            ) : null
            const sharedClassName = `pdf-annotation-block pdf-annotation-block--${annotation.type} ${isSelected ? 'selected' : ''} ${isPulsing ? 'pulsing' : ''}`
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
              'data-annotation-id': annotation.id,
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

            if (annotation.type === 'freeText' || annotation.type === 'note') {
              if (activeTextBoxDraft && activeTextBoxEditingAnnotationId === annotation.id) {
                return []
              }
              const text = annotation.text?.trim() || annotation.content?.trim() || ''
              const isNote = annotation.type === 'note'
              return (
                <div
                  key={annotationKey}
                  {...sharedProps}
                  style={{
                    ...sharedProps.style,
                    left: `var(--pdf-free-text-left, ${left})`,
                    top: `var(--pdf-free-text-top, ${top})`,
                    width: `var(--pdf-free-text-width, ${width})`,
                    height: `var(--pdf-free-text-height, ${height})`,
                    opacity: 1,
                  }}
                >
                  <div className={isNote ? 'pdf-annotation-note-box' : 'pdf-annotation-free-text'}>
                    {text}
                  </div>
                  {isSelected ? (
                    <div className="pdf-annotation-free-text-frame" aria-hidden="true">
                      <span className="pdf-annotation-free-text-move-zone" data-free-text-move-zone="true" />
                      <span className="pdf-annotation-free-text-edge pdf-annotation-free-text-edge--top" data-free-text-handle="top" />
                      <span className="pdf-annotation-free-text-edge pdf-annotation-free-text-edge--right" data-free-text-handle="right" />
                      <span className="pdf-annotation-free-text-edge pdf-annotation-free-text-edge--bottom" data-free-text-handle="bottom" />
                      <span className="pdf-annotation-free-text-edge pdf-annotation-free-text-edge--left" data-free-text-handle="left" />
                      <span className="pdf-annotation-free-text-handle pdf-annotation-free-text-handle--tl" data-free-text-handle="tl" />
                      <span className="pdf-annotation-free-text-handle pdf-annotation-free-text-handle--tr" data-free-text-handle="tr" />
                      <span className="pdf-annotation-free-text-handle pdf-annotation-free-text-handle--br" data-free-text-handle="br" />
                      <span className="pdf-annotation-free-text-handle pdf-annotation-free-text-handle--bl" data-free-text-handle="bl" />
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

            if (annotation.type === 'line' || annotation.type === 'arrow') {
              const points =
                lineResizeDraft && lineResizeDraft.annotationId === annotation.id
                  ? lineResizeDraft.linePoints
                  : (annotation.linePoints ?? rect)
              const startX = points.x1 * 100
              const startY = points.y1 * 100
              const endX = points.x2 * 100
              const endY = points.y2 * 100
              const angle = Math.atan2(endY - startY, endX - startX)
              const arrowSize = 1.8
              const arrowAngle = Math.PI / 7
              const leftX = endX - Math.cos(angle - arrowAngle) * arrowSize
              const leftY = endY - Math.sin(angle - arrowAngle) * arrowSize
              const rightX = endX - Math.cos(angle + arrowAngle) * arrowSize
              const rightY = endY - Math.sin(angle + arrowAngle) * arrowSize
              return (
                <Fragment key={annotationKey}>
                  <div
                    {...sharedProps}
                    style={{
                      ...sharedProps.style,
                      opacity: 1,
                    }}
                  >
                    {noteMarker}
                  </div>
                  <div
                    className={`pdf-annotation-line-layer${isSelected ? ' selected' : ''}${isPulsing ? ' pulsing' : ''}`}
                    aria-hidden="true"
                    style={{
                      '--pdf-annotation-color': annotation.color,
                    } as React.CSSProperties}
                  >
                    <svg
                      className={`pdf-annotation-line pdf-annotation-line--${annotation.type}`}
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                    >
                      <path
                        d={`M ${startX} ${startY} L ${endX} ${endY}`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="0.32"
                        strokeLinecap="round"
                      />
                      {annotation.type === 'arrow' ? (
                        <path
                          d={`M ${leftX} ${leftY} L ${endX} ${endY} L ${rightX} ${rightY}`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="0.32"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      ) : null}
                    </svg>
                    {isSelected ? (
                      <>
                      <svg
                        className="pdf-annotation-line-interaction"
                        viewBox="0 0 100 100"
                        preserveAspectRatio="none"
                        aria-hidden="true"
                      >
                        <path
                          className="pdf-annotation-line-move-zone"
                          data-annotation-id={annotation.id}
                          data-line-move-zone="true"
                          d={`M ${startX} ${startY} L ${endX} ${endY}`}
                        />
                      </svg>
                      <div
                        className="pdf-annotation-line-handle pdf-annotation-line-handle--start"
                        data-annotation-id={annotation.id}
                        data-line-handle="start"
                        style={{
                          left: `${startX}%`,
                          top: `${startY}%`,
                        } as React.CSSProperties}
                      />
                      <div
                        className="pdf-annotation-line-handle pdf-annotation-line-handle--end"
                        data-annotation-id={annotation.id}
                        data-line-handle="end"
                        style={{
                          left: `${endX}%`,
                          top: `${endY}%`,
                        } as React.CSSProperties}
                      />
                      </>
                    ) : null}
                  </div>
                </Fragment>
              )
            }

            if (annotation.type === 'stamp') {
              const isSelected = selectedAnnotationId === annotation.id
              return (
                <div
                  key={annotationKey}
                  {...sharedProps}
                  style={{
                    ...sharedProps.style,
                    opacity: 1,
                  }}
                >
                  <div className="pdf-annotation-stamp">
                    {renderStampIcon(annotation.stampKind ?? 'important')}
                  </div>
                  {isSelected ? (
                    <div className="pdf-annotation-stamp-frame" aria-hidden="true">
                      <span className="pdf-annotation-stamp-move-zone" />
                      <span className="pdf-annotation-stamp-edge pdf-annotation-stamp-edge--top" />
                      <span className="pdf-annotation-stamp-edge pdf-annotation-stamp-edge--right" />
                      <span className="pdf-annotation-stamp-edge pdf-annotation-stamp-edge--bottom" />
                      <span className="pdf-annotation-stamp-edge pdf-annotation-stamp-edge--left" />
                      <span className="pdf-annotation-stamp-handle pdf-annotation-stamp-handle--tl" />
                      <span className="pdf-annotation-stamp-handle pdf-annotation-stamp-handle--tr" />
                      <span className="pdf-annotation-stamp-handle pdf-annotation-stamp-handle--br" />
                      <span className="pdf-annotation-stamp-handle pdf-annotation-stamp-handle--bl" />
                    </div>
                  ) : null}
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
      {activeTextBoxDraft ? (
        <div
          key={activeTextBoxEditorKey ?? undefined}
          className={activeTextBoxType === 'note' ? 'pdf-note-editor-layer' : 'pdf-free-text-editor-layer'}
          style={{
            left: `${activeTextBoxDraft.rect.x1 * 100}%`,
            top: `${activeTextBoxDraft.rect.y1 * 100}%`,
            width: `${(activeTextBoxDraft.rect.x2 - activeTextBoxDraft.rect.x1) * 100}%`,
            minHeight: `${(activeTextBoxDraft.rect.y2 - activeTextBoxDraft.rect.y1) * 100}%`,
            '--pdf-annotation-color': activeTextBoxColor,
          } as React.CSSProperties}
        >
          <textarea
            ref={freeTextEditorRef}
            className={activeTextBoxType === 'note' ? 'pdf-annotation-note-editor' : 'pdf-annotation-free-text-editor'}
            defaultValue={activeTextBoxInitialValue}
            onInput={(event) => {
              updateFreeTextEditorHeight(event.currentTarget)
            }}
            onBlur={handleFreeTextEditorSave}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                handleFreeTextEditorCancel()
                return
              }
              if (event.key === 'Enter') {
                const target = event.currentTarget
                window.requestAnimationFrame(() => {
                  updateFreeTextEditorHeight(target, true)
                })
              }
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                handleFreeTextEditorSave()
              }
            }}
            spellCheck={false}
          />
        </div>
      ) : null}
      <div className="pdf-selection-overlay" aria-hidden="true">
        {shapeDraftRect ? (
          activeShapeTool === 'line' || activeShapeTool === 'arrow' ? (
            (() => {
              const startX = shapeDraftRect.x1 * 100
              const startY = shapeDraftRect.y1 * 100
              const endX = shapeDraftRect.x2 * 100
              const endY = shapeDraftRect.y2 * 100
              const angle = Math.atan2(endY - startY, endX - startX)
              const arrowSize = 1.8
              const arrowAngle = Math.PI / 7
              const leftX = endX - Math.cos(angle - arrowAngle) * arrowSize
              const leftY = endY - Math.sin(angle - arrowAngle) * arrowSize
              const rightX = endX - Math.cos(angle + arrowAngle) * arrowSize
              const rightY = endY - Math.sin(angle + arrowAngle) * arrowSize
              return (
                <>
              {lineDraftOrigin ? (
                <div
                  className="pdf-selection-line-origin"
                  style={{
                    left: `${lineDraftOrigin.x * 100}%`,
                    top: `${lineDraftOrigin.y * 100}%`,
                    '--pdf-selection-preview-color': previewHighlightColor,
                  } as React.CSSProperties}
                />
              ) : null}
              <svg
                className={`pdf-selection-line-draft pdf-selection-line-draft--${activeShapeTool}`}
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                style={{
                  '--pdf-selection-preview-color': previewHighlightColor,
                } as React.CSSProperties}
                aria-hidden="true"
              >
                <path
                  d={`M ${startX} ${startY} L ${endX} ${endY}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="0.32"
                  strokeLinecap="round"
                />
                {activeShapeTool === 'arrow' ? (
                  <path
                    d={`M ${leftX} ${leftY} L ${endX} ${endY} L ${rightX} ${rightY}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="0.32"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ) : null}
              </svg>
            </>
              )
            })()
          ) : (
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
          )
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
