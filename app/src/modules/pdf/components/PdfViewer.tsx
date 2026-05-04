import { memo, useRef, useState, useEffect, useCallback } from 'react'
import type { PDFDocumentProxy } from '../hooks/usePdfDocument'
import { usePdfDocument } from '../hooks/usePdfDocument'
import { PdfViewport, type PdfViewportHandle } from './PdfViewport'
import { PdfAnnotationPanel } from './PdfAnnotationPanel'
import { useI18n } from '../../i18n/I18nContext'
import { isTauriEnv } from '../../platform/runtime'
import {
  appendAnnotation,
  createTextMarkupAnnotation,
  createTextNoteAnnotation,
  getPdfFileName,
  normalizeDocumentAnnotations,
  type PdfSelectionDraft,
} from '../annotationUtils'
import { computePdfHash, loadAnnotations, saveAnnotations } from '../store/annotationStore'
import type { Annotation, DocumentAnnotations } from '../types/annotation'
import type { AnnotationType } from '../types/annotation'

type PdfReadingState = {
  page: number
  scale: number
}

type NoteEditorPosition = {
  top: number
  left: number
}

type PdfNoteEditorPopoverProps = {
  position: NoteEditorPosition
  initialValue: string
  placeholder: string
  cancelLabel: string
  saveLabel: string
  busy: boolean
  onCancel: () => void
  onSave: (value: string) => void
}

type AnnotationRect = {
  x1: number
  y1: number
  x2: number
  y2: number
}

const PDF_CSS_UNITS = 96 / 72
const HIGHLIGHT_COLOR_OPTIONS = [
  { value: '#f5d90a', key: 'yellow' },
  { value: '#7ccf00', key: 'green' },
  { value: '#4da3ff', key: 'blue' },
  { value: '#ff8a4c', key: 'orange' },
  { value: '#f06292', key: 'pink' },
  { value: '#ff0000', key: 'pureRed' },
  { value: '#ffff00', key: 'pureYellow' },
  { value: '#0000ff', key: 'pureBlue' },
  { value: '#000000', key: 'black' },
] as const

const TEXT_MARKUP_TOOL_OPTIONS = [
  { type: 'highlight', labelKey: 'pdf.annotationTypes.highlight' },
  { type: 'underline', labelKey: 'pdf.annotationTypes.underline' },
  { type: 'strikeout', labelKey: 'pdf.annotationTypes.strikeout' },
  { type: 'squiggly', labelKey: 'pdf.annotationTypes.squiggly' },
] as const satisfies ReadonlyArray<{
  type: Extract<AnnotationType, 'highlight' | 'underline' | 'strikeout' | 'squiggly'>
  labelKey: string
}>

function renderMarkupToolIcon(
  type: Extract<AnnotationType, 'highlight' | 'underline' | 'strikeout' | 'squiggly'>,
) {
  switch (type) {
    case 'highlight':
      return (
        <svg className="pdf-markup-tool-icon" viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M10 3.2C6.1 3.2 3 6 3 9.8C3 13.4 5.8 16 9.1 16H10.7C11.4 16 11.9 15.4 11.9 14.8C11.9 14.3 11.6 13.9 11.6 13.5C11.6 12.8 12.2 12.4 12.9 12.4H13.8C16.1 12.4 17.8 10.8 17.8 8.6C17.8 5.4 14.7 3.2 10 3.2Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="7" cy="8.1" r="1" fill="currentColor" />
          <circle cx="9.8" cy="6.9" r="1" fill="currentColor" />
          <circle cx="12.7" cy="8" r="1" fill="currentColor" />
          <circle cx="8.6" cy="10.9" r="1" fill="currentColor" />
        </svg>
      )
    case 'underline':
      return (
        <svg className="pdf-markup-tool-icon" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M6.2 5.5V10C6.2 12.1 7.8 13.7 10 13.7C12.2 13.7 13.8 12.1 13.8 10V5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M5 16H15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      )
    case 'strikeout':
      return (
        <svg className="pdf-markup-tool-icon" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M5 7.2C5 5.8 6.2 4.8 8 4.8H12C13.8 4.8 15 5.8 15 7.2C15 8.7 13.7 9.4 12.3 9.8L7.7 11.1C6.3 11.5 5 12.2 5 13.6C5 15 6.2 16 8 16H12C13.8 16 15 15 15 13.6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4.5 10H15.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      )
    case 'squiggly':
      return (
        <svg className="pdf-markup-tool-icon" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M4 12Q5.5 9.2 7 12T10 12T13 12T16 12" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
  }
}

function getPdfStateKey(filePath: string) {
  return `pdf-reading-state:${filePath}`
}

function loadPdfReadingState(filePath: string): PdfReadingState | null {
  if (typeof window === 'undefined') return null
  try {
    const key = getPdfStateKey(filePath)
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PdfReadingState
    if (typeof parsed.page === 'number' && typeof parsed.scale === 'number') {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

function savePdfReadingState(filePath: string, state: PdfReadingState) {
  if (typeof window === 'undefined') return
  try {
    const key = getPdfStateKey(filePath)
    window.localStorage.setItem(key, JSON.stringify(state))
  } catch {
    // ignore
  }
}

function getAnchorRect(rects: readonly AnnotationRect[]) {
  if (rects.length === 0) return null
  return [...rects].sort((left, right) => {
    if (left.y1 !== right.y1) return left.y1 - right.y1
    return left.x1 - right.x1
  })[0] ?? null
}

function isMarkupAnnotation(
  annotation: Annotation,
): annotation is Annotation & { type: 'highlight' | 'underline' | 'strikeout' | 'squiggly' } {
  return (
    annotation.type === 'highlight' ||
    annotation.type === 'underline' ||
    annotation.type === 'strikeout' ||
    annotation.type === 'squiggly'
  )
}

function areAnnotationRectsEqual(left: readonly AnnotationRect[], right: readonly AnnotationRect[]) {
  if (left.length !== right.length) return false
  return left.every((rect, index) => {
    const other = right[index]
    return (
      rect.x1 === other.x1 &&
      rect.y1 === other.y1 &&
      rect.x2 === other.x2 &&
      rect.y2 === other.y2
    )
  })
}

function findLinkedMarkupAnnotation(
  annotation: Annotation,
  annotations: readonly Annotation[],
) {
  if (annotation.type !== 'text') return null
  return (
    annotations.find(
      (candidate) =>
        candidate.id !== annotation.id &&
        isMarkupAnnotation(candidate) &&
        candidate.page === annotation.page &&
        (candidate.content?.trim() || '') === (annotation.content?.trim() || '') &&
        areAnnotationRectsEqual(candidate.rects, annotation.rects),
    ) ?? null
  )
}

function findLinkedTextAnnotation(
  annotation: Annotation,
  annotations: readonly Annotation[],
) {
  if (!isMarkupAnnotation(annotation)) return null
  return (
    annotations.find(
      (candidate) =>
        candidate.id !== annotation.id &&
        candidate.type === 'text' &&
        candidate.page === annotation.page &&
        (candidate.content?.trim() || '') === (annotation.content?.trim() || '') &&
        areAnnotationRectsEqual(candidate.rects, annotation.rects),
    ) ?? null
  )
}

const PdfNoteEditorPopover = memo(function PdfNoteEditorPopover({
  position,
  initialValue,
  placeholder,
  cancelLabel,
  saveLabel,
  busy,
  onCancel,
  onSave,
}: PdfNoteEditorPopoverProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  return (
    <div
      className="pdf-note-editor pdf-note-editor-popover"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
    >
      <textarea
        ref={inputRef}
        className="pdf-note-editor-input"
        defaultValue={initialValue}
        placeholder={placeholder}
        rows={2}
        autoFocus
      />
      <div className="pdf-note-editor-actions">
        <button
          type="button"
          className="pdf-note-editor-btn"
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className="pdf-note-editor-btn primary"
          onClick={() => {
            onSave(inputRef.current?.value ?? initialValue)
          }}
          disabled={busy}
        >
          {saveLabel}
        </button>
      </div>
    </div>
  )
})

export interface PdfViewerProps {
  filePath: string
  onClose?: () => void
  onRegisterSelectionGetter?: (getter: (() => string | null) | null) => void
}

export function PdfViewer({ filePath, onRegisterSelectionGetter }: PdfViewerProps) {
  const { t } = useI18n()
  const viewportRef = useRef<PdfViewportHandle | null>(null)
  const selectionDraftRef = useRef<PdfSelectionDraft | null>(null)
  const pulseTimerRef = useRef<number | null>(null)
  const [scale, setScale] = useState(1.25)
  const { pdfDocument, pageCount, loading, error } = usePdfDocument(filePath)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const [basePageWidth, setBasePageWidth] = useState<number | null>(null)
  const [basePageHeight, setBasePageHeight] = useState<number | null>(null)
  const [annotationDocument, setAnnotationDocument] = useState<DocumentAnnotations | null>(null)
  const [, setSelectionDraft] = useState<PdfSelectionDraft | null>(null)
  const [annotationMessage, setAnnotationMessage] = useState<string | null>(null)
  const [isAnnotationBusy, setAnnotationBusy] = useState(false)
  const [selectedHighlightColor, setSelectedHighlightColor] = useState<string>(HIGHLIGHT_COLOR_OPTIONS[0].value)
  const [activeMarkupTool, setActiveMarkupTool] = useState<Extract<AnnotationType, 'highlight' | 'underline' | 'strikeout' | 'squiggly'> | null>(null)
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null)
  const [pulsingAnnotationId, setPulsingAnnotationId] = useState<string | null>(null)
  const [annotationPanelOpen, setAnnotationPanelOpen] = useState(true)
  const [clearSelectionSignal, setClearSelectionSignal] = useState(0)
  const [isTextNoteArmed, setIsTextNoteArmed] = useState(false)
  const [pendingNoteDraft, setPendingNoteDraft] = useState<PdfSelectionDraft | null>(null)
  const [pendingNoteTargetAnnotationId, setPendingNoteTargetAnnotationId] = useState<string | null>(null)
  const [editingTextNoteAnnotationId, setEditingTextNoteAnnotationId] = useState<string | null>(null)
  const [noteEditorPosition, setNoteEditorPosition] = useState<NoteEditorPosition | null>(null)
  const [openedNoteAnnotationId, setOpenedNoteAnnotationId] = useState<string | null>(null)
  const [notePreviewPosition, setNotePreviewPosition] = useState<NoteEditorPosition | null>(null)
  const selectedAnnotatableAnnotation =
    selectedAnnotationId && annotationDocument
      ? annotationDocument.annotations.find(
          (annotation) =>
            annotation.id === selectedAnnotationId &&
            (annotation.type === 'highlight' ||
              annotation.type === 'underline' ||
              annotation.type === 'strikeout' ||
              annotation.type === 'squiggly'),
        ) ?? null
      : null
  const selectedColorableAnnotation =
    selectedAnnotationId && annotationDocument
      ? (() => {
          const selected =
            annotationDocument.annotations.find((annotation) => annotation.id === selectedAnnotationId) ?? null
          if (!selected) return null
          const linkedMarkup = findLinkedMarkupAnnotation(selected, annotationDocument.annotations)
          if (linkedMarkup) return linkedMarkup
          return (
            (isMarkupAnnotation(selected) || selected.type === 'text')
              ? selected
              : null
          )
        })()
      : null
  const selectedNoteAnnotation =
    selectedAnnotationId && annotationDocument
      ? annotationDocument.annotations.find(
          (annotation) => annotation.id === selectedAnnotationId && !!annotation.note?.trim(),
        ) ?? null
      : null
  const openedNoteAnnotation =
    openedNoteAnnotationId && annotationDocument
      ? annotationDocument.annotations.find(
          (annotation) => annotation.id === openedNoteAnnotationId && annotation.note?.trim(),
        ) ?? null
      : null
  const noteEditorInitialValue =
    editingTextNoteAnnotationId && annotationDocument
      ? (
          annotationDocument.annotations.find((annotation) => annotation.id === editingTextNoteAnnotationId)?.note ??
          (pendingNoteTargetAnnotationId
            ? annotationDocument.annotations.find((annotation) => annotation.id === pendingNoteTargetAnnotationId)?.note
            : '') ??
          ''
        )
      : (
          pendingNoteTargetAnnotationId && annotationDocument
            ? annotationDocument.annotations.find((annotation) => annotation.id === pendingNoteTargetAnnotationId)?.note ?? ''
            : ''
        )

  const ZOOM_MIN = 0.5
  const ZOOM_MAX = 3
  const ZOOM_STEP = 0.25
  const zoomPercent = Math.round(scale * 100)

  const scrollToPageWithScale = useCallback((page: number, scaleForScroll: number) => {
    const baseHeight = basePageHeight ?? 800
    const estimatedPageHeight = Math.max(1, baseHeight * scaleForScroll)
    viewportRef.current?.scrollToPage(page, estimatedPageHeight)
  }, [basePageHeight])

  const handleZoomIn = () => {
    setScale((prev) => {
      const next = Math.min(ZOOM_MAX, prev + ZOOM_STEP)
      scrollToPageWithScale(currentPage, next)
      return next
    })
  }

  const handleZoomOut = () => {
    setScale((prev) => {
      const next = Math.max(ZOOM_MIN, prev - ZOOM_STEP)
      scrollToPageWithScale(currentPage, next)
      return next
    })
  }

  const handleZoomReset = () => {
    const next = 1.0
    setScale(next)
    scrollToPageWithScale(currentPage, next)
  }

  const handleZoomFitWidth = () => {
    const containerWidth = viewportRef.current?.getContainerWidth()
    if (!containerWidth || !basePageWidth) return

    const horizontalPadding = 32
    const availableWidth = containerWidth - horizontalPadding
    if (availableWidth <= 0) return

    const fitScale = availableWidth / basePageWidth
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, fitScale))

    setScale(clamped)
    scrollToPageWithScale(currentPage, clamped)
  }

  const triggerAnnotationPulse = useCallback((annotationId: string) => {
    setPulsingAnnotationId(annotationId)
    if (pulseTimerRef.current) {
      window.clearTimeout(pulseTimerRef.current)
    }
    pulseTimerRef.current = window.setTimeout(() => {
      setPulsingAnnotationId((current) => (current === annotationId ? null : current))
      pulseTimerRef.current = null
    }, 1400)
  }, [])

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

  useEffect(() => {
    if (!pdfDocument || !pageCount || pageCount <= 0) return

    const saved = loadPdfReadingState(filePath)

    if (saved) {
      const clampedPage = Math.min(Math.max(saved.page, 1), pageCount)
      const clampedScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, saved.scale))

      setScale(clampedScale)
      setCurrentPage(clampedPage)
      setPageInput(String(clampedPage))
      scrollToPageWithScale(clampedPage, clampedScale)
      return
    }

    const containerWidth = viewportRef.current?.getContainerWidth()
    if (!containerWidth || !basePageWidth) return

    const horizontalPadding = 32
    const availableWidth = containerWidth - horizontalPadding
    if (availableWidth <= 0) return

    const fitScale = availableWidth / basePageWidth
    const clampedFit = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, fitScale))

    setScale(clampedFit)
    setCurrentPage(1)
    setPageInput('1')
    scrollToPageWithScale(1, clampedFit)
  }, [pdfDocument, pageCount, filePath, basePageHeight, basePageWidth, scrollToPageWithScale])

  useEffect(() => {
    if (!pageCount || pageCount <= 0) return

    const handle = window.setTimeout(() => {
      savePdfReadingState(filePath, {
        page: currentPage,
        scale,
      })
    }, 300)

    return () => {
      window.clearTimeout(handle)
    }
  }, [filePath, currentPage, scale, pageCount])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!pdfDocument) return
      try {
        const page = await (pdfDocument as PDFDocumentProxy).getPage(1)
        if (cancelled) return
        const viewport = page.getViewport({ scale: 1 })
        setBasePageWidth(viewport.width * PDF_CSS_UNITS)
        setBasePageHeight(viewport.height * PDF_CSS_UNITS)
      } catch (e) {
        console.error('[PdfViewer] failed to compute base page size', e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pdfDocument])

  useEffect(() => {
    return () => {
      if (pulseTimerRef.current) {
        window.clearTimeout(pulseTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!pdfDocument || pageCount <= 0) {
      setAnnotationDocument(null)
      setSelectionDraft(null)
      selectionDraftRef.current = null
      setActiveMarkupTool(null)
      setAnnotationMessage(null)
      setAnnotationBusy(false)
      setSelectedAnnotationId(null)
      setIsTextNoteArmed(false)
      setPendingNoteDraft(null)
      setPendingNoteTargetAnnotationId(null)
      setEditingTextNoteAnnotationId(null)
      setNoteEditorPosition(null)
      setOpenedNoteAnnotationId(null)
      setNotePreviewPosition(null)
      return
    }

    let cancelled = false

    const loadDocumentAnnotations = async () => {
      setAnnotationBusy(true)
      setAnnotationMessage(t('pdf.loadingAnnotations'))

      try {
        const pdfHash = isTauriEnv() ? await computePdfHash(filePath) : `web:${filePath}`
        if (cancelled) return
        const stored = await loadAnnotations(pdfHash)
        if (cancelled) return
        setAnnotationDocument(
          normalizeDocumentAnnotations(stored, pdfHash, getPdfFileName(filePath), pageCount),
        )
        setAnnotationMessage(null)
        setSelectedAnnotationId(null)
      } catch (loadError) {
        if (cancelled) return
        const message = loadError instanceof Error ? loadError.message : String(loadError)
        setAnnotationDocument(null)
        setAnnotationMessage(t('pdf.annotationLoadFailed', { message }))
        setSelectedAnnotationId(null)
      } finally {
        if (!cancelled) {
          setAnnotationBusy(false)
        }
      }
    }

    void loadDocumentAnnotations()

    return () => {
      cancelled = true
    }
  }, [filePath, pageCount, pdfDocument, t])

  const pageHeightForVirtual = Math.max(1, (basePageHeight ?? 800) * scale)

  const goToPage = (page: number, estimatedPageHeight?: number) => {
    if (!pageCount || pageCount <= 0) return
    const clamped = Math.min(Math.max(page, 1), pageCount)
    setCurrentPage(clamped)
    setPageInput(String(clamped))
    viewportRef.current?.scrollToPage(clamped, estimatedPageHeight)
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

  const handleAddHighlight = async (
    type: Extract<AnnotationType, 'highlight' | 'underline' | 'strikeout' | 'squiggly'> = activeMarkupTool ?? 'highlight',
    color = selectedHighlightColor,
    draft = selectionDraftRef.current,
  ) => {
    const currentSelectionDraft = draft
    if (!annotationDocument || !currentSelectionDraft) return

    setSelectionDraft(null)
    selectionDraftRef.current = null
    setSelectedAnnotationId(null)
    setClearSelectionSignal((prev) => prev + 1)
    if (typeof window !== 'undefined') {
      window.getSelection()?.removeAllRanges()
    }

    setAnnotationBusy(true)
    setAnnotationMessage(t('pdf.savingAnnotation'))

    const nextDocument = appendAnnotation(
      annotationDocument,
      createTextMarkupAnnotation(currentSelectionDraft, type, color),
    )

    try {
      await saveAnnotations(nextDocument.pdfHash, nextDocument)
      setAnnotationDocument(nextDocument)
      setAnnotationMessage(null)
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError)
      setAnnotationMessage(t('pdf.annotationSaveFailed', { message }))
    } finally {
      setAnnotationBusy(false)
    }
  }

  const handleDeleteHighlight = async () => {
    if (!annotationDocument || !selectedAnnotationId) return

    setAnnotationBusy(true)
    setAnnotationMessage(t('pdf.savingAnnotation'))

    const nextDocument = {
      ...annotationDocument,
      annotations: annotationDocument.annotations.filter((annotation) => annotation.id !== selectedAnnotationId),
      lastModified: Date.now(),
    }

    try {
      await saveAnnotations(nextDocument.pdfHash, nextDocument)
      setAnnotationDocument(nextDocument)
      setSelectedAnnotationId(null)
      setAnnotationMessage(null)
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError)
      setAnnotationMessage(t('pdf.annotationSaveFailed', { message }))
    } finally {
      setAnnotationBusy(false)
    }
  }

  const handleUpdateSelectedAnnotationColor = async (color: string) => {
    if (!annotationDocument || !selectedColorableAnnotation || !selectedAnnotationId) return

    const selectedAnnotation =
      annotationDocument.annotations.find((annotation) => annotation.id === selectedAnnotationId) ?? null
    const linkedMarkup = selectedAnnotation
      ? findLinkedMarkupAnnotation(selectedAnnotation, annotationDocument.annotations)
      : null
    const linkedText = selectedAnnotation
      ? findLinkedTextAnnotation(selectedAnnotation, annotationDocument.annotations)
      : null
    const targetIds = new Set<string>([selectedColorableAnnotation.id])
    if (linkedMarkup) targetIds.add(linkedMarkup.id)
    if (linkedText) targetIds.add(linkedText.id)

    const nextDocument = {
      ...annotationDocument,
      annotations: annotationDocument.annotations.map((annotation) =>
        targetIds.has(annotation.id)
          ? {
              ...annotation,
              color,
              updatedAt: Date.now(),
            }
          : annotation,
      ),
      lastModified: Date.now(),
    }

    setAnnotationBusy(true)
    setAnnotationMessage(t('pdf.savingAnnotation'))

    try {
      await saveAnnotations(nextDocument.pdfHash, nextDocument)
      setAnnotationDocument(nextDocument)
      setAnnotationMessage(null)
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError)
      setAnnotationMessage(t('pdf.annotationSaveFailed', { message }))
    } finally {
      setAnnotationBusy(false)
    }
  }

  const handleStartTextNote = () => {
    const selection = selectionDraftRef.current
    if (!annotationDocument || isAnnotationBusy) return
    if (!selection && selectedAnnotatableAnnotation) {
      setIsTextNoteArmed(false)
      setPendingNoteDraft({
        page: selectedAnnotatableAnnotation.page,
        text: selectedAnnotatableAnnotation.content?.trim() || '',
        rects: selectedAnnotatableAnnotation.rects,
      })
      setPendingNoteTargetAnnotationId(selectedAnnotatableAnnotation.id)
      setEditingTextNoteAnnotationId(null)
      setNoteEditorPosition(null)
      setOpenedNoteAnnotationId(null)
      setNotePreviewPosition(null)
      return
    }
    if (!selection) {
      setSelectedAnnotationId(null)
      setIsTextNoteArmed(true)
      setActiveMarkupTool(null)
      setPendingNoteDraft(null)
      setPendingNoteTargetAnnotationId(null)
      setEditingTextNoteAnnotationId(null)
      setOpenedNoteAnnotationId(null)
      setNotePreviewPosition(null)
      return
    }
    setIsTextNoteArmed(false)
    setSelectedAnnotationId(null)
    setPendingNoteDraft(selection)
    setPendingNoteTargetAnnotationId(null)
    setEditingTextNoteAnnotationId(null)
    setNoteEditorPosition(null)
    setOpenedNoteAnnotationId(null)
    setNotePreviewPosition(null)
    setSelectionDraft(null)
    selectionDraftRef.current = null
    setClearSelectionSignal((prev) => prev + 1)
    if (typeof window !== 'undefined') {
      window.getSelection()?.removeAllRanges()
    }
  }

  const handleCancelTextNote = () => {
    setIsTextNoteArmed(false)
    setPendingNoteDraft(null)
    setPendingNoteTargetAnnotationId(null)
    setEditingTextNoteAnnotationId(null)
    setNoteEditorPosition(null)
  }

  const handleEditTextNote = useCallback((annotation: Annotation) => {
    if (!annotationDocument || isAnnotationBusy || !annotation.note?.trim()) return
    setIsTextNoteArmed(false)
    setSelectedAnnotationId(annotation.id)
    setPendingNoteDraft({
      page: annotation.page,
      text: annotation.content?.trim() || '',
      rects: annotation.rects,
    })
    setPendingNoteTargetAnnotationId(annotation.type === 'text' ? null : annotation.id)
    setEditingTextNoteAnnotationId(annotation.id)
    setNoteEditorPosition(null)
    setOpenedNoteAnnotationId(null)
    setNotePreviewPosition(null)
    setSelectionDraft(null)
    selectionDraftRef.current = null
    setClearSelectionSignal((prev) => prev + 1)
    if (typeof window !== 'undefined') {
      window.getSelection()?.removeAllRanges()
    }
  }, [annotationDocument, isAnnotationBusy])

  const handleSaveTextNote = async (rawValue: string) => {
    const currentSelectionDraft = pendingNoteDraft
    const note = rawValue.trim()
    if (!annotationDocument || !currentSelectionDraft || !note) return

    setSelectionDraft(null)
    selectionDraftRef.current = null
    setSelectedAnnotationId(null)
    setIsTextNoteArmed(false)
    setPendingNoteDraft(null)
    const targetAnnotationId = pendingNoteTargetAnnotationId
    setPendingNoteTargetAnnotationId(null)
    const editingId = editingTextNoteAnnotationId
    setEditingTextNoteAnnotationId(null)
    setNoteEditorPosition(null)
    setOpenedNoteAnnotationId(null)
    setNotePreviewPosition(null)
    setClearSelectionSignal((prev) => prev + 1)
    if (typeof window !== 'undefined') {
      window.getSelection()?.removeAllRanges()
    }

    setAnnotationBusy(true)
    setAnnotationMessage(t('pdf.savingAnnotation'))

    const nextDocument = editingId
      ? {
          ...annotationDocument,
          annotations: annotationDocument.annotations.map((annotation) =>
            annotation.id === editingId
              ? {
                  ...annotation,
                  note,
                  updatedAt: Date.now(),
                }
              : annotation,
          ),
          lastModified: Date.now(),
        }
      : targetAnnotationId
        ? {
            ...annotationDocument,
            annotations: annotationDocument.annotations.map((annotation) =>
              annotation.id === targetAnnotationId
                ? {
                    ...annotation,
                    note,
                    updatedAt: Date.now(),
                  }
                : annotation,
            ),
            lastModified: Date.now(),
          }
      : appendAnnotation(
          annotationDocument,
          createTextNoteAnnotation(currentSelectionDraft, note, selectedHighlightColor),
        )

    try {
      await saveAnnotations(nextDocument.pdfHash, nextDocument)
      setAnnotationDocument(nextDocument)
      setAnnotationMessage(null)
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError)
      setAnnotationMessage(t('pdf.annotationSaveFailed', { message }))
    } finally {
      setAnnotationBusy(false)
    }
  }

  const handleAnnotationPreviewOpen = useCallback((annotation: Annotation | null) => {
    const note = annotation?.note?.trim()
    if (!annotation || !note) {
      setOpenedNoteAnnotationId(null)
      setNotePreviewPosition(null)
      return
    }
    setOpenedNoteAnnotationId(annotation.id)
    setNotePreviewPosition(null)
  }, [])

  const handleAnnotationItemClick = (annotation: Annotation) => {
    setSelectedAnnotationId(annotation.id)
    triggerAnnotationPulse(annotation.id)
    handleAnnotationPreviewOpen(null)
    setSelectionDraft(null)
    selectionDraftRef.current = null
    if (typeof window !== 'undefined') {
      window.getSelection()?.removeAllRanges()
    }
    goToPage(annotation.page, pageHeightForVirtual)

    const anchorRect = getAnchorRect(annotation.rects)
    if (!anchorRect || typeof window === 'undefined') return

    const adjustToRenderedPosition = () => {
      const metrics = viewportRef.current?.getRenderedPageMetrics(annotation.page)
      if (!metrics) return
      const containerHeight = viewportRef.current?.getContainerHeight() ?? 0
      const targetY = metrics.top + ((anchorRect.y1 + anchorRect.y2) / 2) * metrics.height
      const centerBias = 0.42
      const absoluteOffset = Math.max(
        0,
        targetY - containerHeight * centerBias,
      )
      viewportRef.current?.scrollToOffset(absoluteOffset)
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        adjustToRenderedPosition()
      })
    })
  }

  useEffect(() => {
    if (!selectedAnnotationId) return

    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false
      if (target.isContentEditable) return true
      const tag = target.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isAnnotationBusy) return
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      if (isEditableTarget(event.target)) return

      event.preventDefault()
      void handleDeleteHighlight()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [selectedAnnotationId, isAnnotationBusy, handleDeleteHighlight])

  useEffect(() => {
    if (!selectedNoteAnnotation || pendingNoteDraft || isAnnotationBusy) return

    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false
      if (target.isContentEditable) return true
      const tag = target.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'Enter') return
      if (isEditableTarget(event.target)) return
      event.preventDefault()
      handleEditTextNote(selectedNoteAnnotation)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [selectedNoteAnnotation, pendingNoteDraft, isAnnotationBusy, handleEditTextNote])

  useEffect(() => {
    if (!pendingNoteDraft) {
      setNoteEditorPosition(null)
      return
    }

    const updatePosition = () => {
      const metrics = viewportRef.current?.getRenderedPageMetrics(pendingNoteDraft.page)
      if (!metrics) return

      const anchorRect = getAnchorRect(pendingNoteDraft.rects)
      if (!anchorRect) return

      const anchorLeft = metrics.left + ((anchorRect.x1 + anchorRect.x2) / 2) * metrics.width
      const anchorTop = metrics.viewportTop + anchorRect.y1 * metrics.height
      const popupWidth = 360
      const popupHeight = 128
      const mainWidth = viewportRef.current?.getContainerWidth() ?? metrics.width
      const aboveTop = anchorTop - popupHeight - 12
      const nextTop = aboveTop >= 8 ? aboveTop : anchorTop + 18
      const nextLeft = Math.min(
        Math.max(8, anchorLeft - popupWidth / 2),
        Math.max(8, mainWidth - popupWidth - 8),
      )

      setNoteEditorPosition({
        top: nextTop,
        left: nextLeft,
      })
    }

    const frame = window.requestAnimationFrame(() => {
      updatePosition()
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [pendingNoteDraft, currentPage, scale])

  useEffect(() => {
    if (!openedNoteAnnotation || pendingNoteDraft) {
      setNotePreviewPosition(null)
      return
    }

    const updatePosition = () => {
      const metrics = viewportRef.current?.getRenderedPageMetrics(openedNoteAnnotation.page)
      if (!metrics) return

      const anchorRect = getAnchorRect(openedNoteAnnotation.rects)
      if (!anchorRect) return

      const anchorLeft = metrics.left + ((anchorRect.x1 + anchorRect.x2) / 2) * metrics.width
      const anchorTop = metrics.viewportTop + anchorRect.y1 * metrics.height
      const popupWidth = 360
      const popupHeight = 132
      const mainWidth = viewportRef.current?.getContainerWidth() ?? metrics.width
      const aboveTop = anchorTop - popupHeight - 12
      const nextTop = aboveTop >= 8 ? aboveTop : anchorTop + 18
      const nextLeft = Math.min(
        Math.max(8, anchorLeft - popupWidth / 2),
        Math.max(8, mainWidth - popupWidth - 8),
      )

      setNotePreviewPosition({
        top: nextTop,
        left: nextLeft,
      })
    }

    const frame = window.requestAnimationFrame(() => {
      updatePosition()
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [openedNoteAnnotation, pendingNoteDraft, currentPage, scale])

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
      <div className="pdf-viewer-sidebar">
        <div className="pdf-toolbar">
          <div className="pdf-toolbar-group pdf-toolbar-group-annotations">
            <div className="pdf-toolbar-section pdf-toolbar-annotations">
              <div className="pdf-highlight-color-row" aria-label={t('pdf.highlightColor')}>
                <button
                  type="button"
                  className={`pdf-highlight-tool-btn ${activeMarkupTool === null && !isTextNoteArmed && !pendingNoteDraft ? 'active' : ''}`}
                  onMouseDown={(event) => {
                    event.preventDefault()
                  }}
                  onClick={() => {
                    setIsTextNoteArmed(false)
                    setPendingNoteDraft(null)
                    setPendingNoteTargetAnnotationId(null)
                    setNoteEditorPosition(null)
                    handleAnnotationPreviewOpen(null)
                    setActiveMarkupTool(null)
                  }}
                  aria-label={t('pdf.selectTextOnly')}
                  aria-pressed={activeMarkupTool === null && !isTextNoteArmed && !pendingNoteDraft}
                  title={t('pdf.selectTextOnly')}
                >
                  <svg
                    className="pdf-highlight-tool-arrow"
                    viewBox="0 0 16 16"
                    aria-hidden="true"
                  >
                    <path
                      d="M3 2.5L12.5 8L7.2 8.8L10 14L8.2 14.8L5.5 9.6L3 13V2.5Z"
                      fill="currentColor"
                    />
                  </svg>
                </button>
                {TEXT_MARKUP_TOOL_OPTIONS.map((option) => (
                  <button
                    key={option.type}
                    type="button"
                    className={`pdf-highlight-tool-btn ${activeMarkupTool === option.type ? 'active' : ''}`}
                    onMouseDown={(event) => {
                      event.preventDefault()
                    }}
                    onClick={() => {
                      handleAnnotationPreviewOpen(null)
                      setActiveMarkupTool(option.type)
                      if (selectionDraftRef.current && annotationDocument && !isAnnotationBusy) {
                        void handleAddHighlight(option.type, selectedHighlightColor)
                      }
                    }}
                    aria-label={t(option.labelKey)}
                    aria-pressed={activeMarkupTool === option.type}
                    title={t(option.labelKey)}
                  >
                    {renderMarkupToolIcon(option.type)}
                  </button>
                ))}
                <button
                  type="button"
                  className={`pdf-highlight-tool-btn ${(pendingNoteDraft || isTextNoteArmed) ? 'active' : ''}`}
                  onMouseDown={(event) => {
                    event.preventDefault()
                  }}
                  onClick={handleStartTextNote}
                  aria-label={t('pdf.annotationTypes.text')}
                  aria-pressed={pendingNoteDraft !== null || isTextNoteArmed}
                  title={t('pdf.annotationTypes.text')}
                  disabled={(!annotationDocument || isAnnotationBusy) || (!selectionDraftRef.current && !selectedAnnotatableAnnotation && !pendingNoteDraft)}
                >
                  <svg className="pdf-markup-tool-icon pdf-markup-tool-icon--text-note" viewBox="0 0 20 20" aria-hidden="true">
                    <path
                      d="M5 5.5H15V12.5H9.5L6.5 15V12.5H5V5.5Z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                    <path d="M7.2 8.4H12.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                    <path d="M7.2 10.6H10.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  </svg>
                </button>
                {HIGHLIGHT_COLOR_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`pdf-highlight-color-swatch ${selectedHighlightColor === option.value && activeMarkupTool === 'highlight' ? 'active' : ''}`}
                    style={{ '--pdf-highlight-color': option.value } as React.CSSProperties}
                    onMouseDown={(event) => {
                      event.preventDefault()
                    }}
                    onClick={() => {
                      setSelectedHighlightColor(option.value)
                      if (selectionDraftRef.current && annotationDocument && !isAnnotationBusy) {
                        if (activeMarkupTool === null) {
                          return
                        }
                        handleAnnotationPreviewOpen(null)
                        void handleAddHighlight(activeMarkupTool, option.value)
                        return
                      }
                      if (selectedColorableAnnotation && !isAnnotationBusy) {
                        handleAnnotationPreviewOpen(null)
                        void handleUpdateSelectedAnnotationColor(option.value)
                      }
                    }}
                    aria-label={t(`pdf.highlightColors.${option.key}`)}
                    aria-pressed={selectedHighlightColor === option.value && activeMarkupTool === 'highlight'}
                    title={t(`pdf.highlightColors.${option.key}`)}
                  />
                ))}
              </div>
              <button
                type="button"
                className={`pdf-highlight-color-swatch pdf-highlight-color-swatch-delete ${selectedAnnotationId ? 'active' : ''}`}
                onMouseDown={(event) => {
                  event.preventDefault()
                }}
                onClick={() => {
                  handleAnnotationPreviewOpen(null)
                  void handleDeleteHighlight()
                }}
                disabled={!selectedAnnotationId || isAnnotationBusy}
                aria-label={
                  selectedAnnotationId
                    ? t('pdf.deleteHighlight')
                    : t('pdf.deleteHighlightDisabled')
                }
                title={
                  selectedAnnotationId
                    ? t('pdf.deleteHighlight')
                    : t('pdf.deleteHighlightDisabled')
                }
              />
              {annotationMessage ? <div className="pdf-annotation-status">{annotationMessage}</div> : null}
            </div>
          </div>

          <div className="pdf-toolbar-group pdf-toolbar-group-controls">
            <div className="pdf-toolbar-section pdf-toolbar-controls">
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
                <button
                  type="button"
                  className={`pdf-icon-btn ${annotationPanelOpen ? 'active' : ''}`}
                  onClick={() => {
                    setAnnotationPanelOpen((prev) => !prev)
                  }}
                  aria-label={annotationPanelOpen ? t('pdf.hideAnnotationPanel') : t('pdf.showAnnotationPanel')}
                  title={annotationPanelOpen ? t('pdf.hideAnnotationPanel') : t('pdf.showAnnotationPanel')}
                >
                  ≣
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className={`pdf-viewer-content ${annotationPanelOpen ? '' : 'annotation-panel-collapsed'}`}>
        <div className="pdf-viewer-main">
          <PdfViewport
            ref={viewportRef}
            pdfDocument={pdfDocument as PDFDocumentProxy}
            pageCount={pageCount}
            scale={scale}
            pageHeight={pageHeightForVirtual}
            previewHighlightColor={selectedHighlightColor}
            clearSelectionSignal={clearSelectionSignal}
            currentPage={currentPage}
            onCurrentPageChange={(page) => {
              setCurrentPage(page)
              setPageInput(String(page))
            }}
            onRegisterSelectionGetter={onRegisterSelectionGetter}
            annotations={annotationDocument?.annotations ?? []}
            onSelectionChange={(selection) => {
              if (pendingNoteDraft) {
                return
              }
              if (isTextNoteArmed) {
                selectionDraftRef.current = selection
                setSelectionDraft(selection)
                if (selection) {
                  setSelectedAnnotationId(null)
                  handleAnnotationPreviewOpen(null)
                  setIsTextNoteArmed(false)
                  setPendingNoteDraft(selection)
                  setPendingNoteTargetAnnotationId(null)
                  setSelectionDraft(null)
                  selectionDraftRef.current = null
                  setClearSelectionSignal((prev) => prev + 1)
                  if (typeof window !== 'undefined') {
                    window.getSelection()?.removeAllRanges()
                  }
                }
                return
              }
              selectionDraftRef.current = selection
              setSelectionDraft(selection)
              if (selection) {
                setSelectedAnnotationId(null)
                handleAnnotationPreviewOpen(null)
                if (activeMarkupTool && annotationDocument && !isAnnotationBusy) {
                  void handleAddHighlight(activeMarkupTool, selectedHighlightColor, selection)
                }
              }
            }}
            selectedAnnotationId={selectedAnnotationId}
            pulsingAnnotationId={pulsingAnnotationId}
            onAnnotationClick={(annotationId) => {
              const annotation = annotationDocument?.annotations.find((item) => item.id === annotationId) ?? null
              setSelectedAnnotationId(annotationId)
              triggerAnnotationPulse(annotationId)
              handleAnnotationPreviewOpen(annotation)
              setSelectionDraft(null)
              selectionDraftRef.current = null
              if (typeof window !== 'undefined') {
                window.getSelection()?.removeAllRanges()
              }
            }}
            onAnnotationDoubleClick={(annotationId) => {
              const annotation = annotationDocument?.annotations.find((item) => item.id === annotationId)
              if (annotation?.note?.trim()) {
                handleEditTextNote(annotation)
              }
            }}
            onClearAnnotationSelection={() => {
              setSelectedAnnotationId(null)
              handleAnnotationPreviewOpen(null)
            }}
          />
          {openedNoteAnnotation && notePreviewPosition && !pendingNoteDraft ? (
            <div
              className="pdf-note-preview pdf-note-preview-popover"
              style={{
                top: `${notePreviewPosition.top}px`,
                left: `${notePreviewPosition.left}px`,
              }}
            >
              {openedNoteAnnotation.content?.trim() ? (
                <div className="pdf-note-preview-selection">{openedNoteAnnotation.content.trim()}</div>
              ) : null}
              <div className="pdf-note-preview-body">{openedNoteAnnotation.note?.trim()}</div>
            </div>
          ) : null}
          {pendingNoteDraft && noteEditorPosition ? (
            <PdfNoteEditorPopover
              key={`${editingTextNoteAnnotationId ?? pendingNoteTargetAnnotationId ?? pendingNoteDraft.page}-${pendingNoteDraft.rects[0]?.x1 ?? 0}-${pendingNoteDraft.rects[0]?.y1 ?? 0}`}
              position={noteEditorPosition}
              initialValue={noteEditorInitialValue}
              placeholder={t('pdf.notePlaceholder')}
              cancelLabel={t('common.cancel')}
              saveLabel={t('common.save')}
              busy={isAnnotationBusy}
              onCancel={handleCancelTextNote}
              onSave={(value) => {
                void handleSaveTextNote(value)
              }}
            />
          ) : null}
        </div>
        {annotationPanelOpen && (
          <PdfAnnotationPanel
            annotations={annotationDocument?.annotations ?? []}
            selectedAnnotationId={selectedAnnotationId}
            onAnnotationClick={handleAnnotationItemClick}
            onAnnotationDoubleClick={(annotation) => {
              if (annotation.note?.trim()) {
                handleEditTextNote(annotation)
              }
            }}
          />
        )}
      </div>
    </div>
  )
}
