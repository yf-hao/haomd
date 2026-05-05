import { memo, useMemo } from 'react'
import { useI18n } from '../../i18n/I18nContext'
import { isMarkupAnnotation, type Annotation } from '../types/annotation'

export interface PdfAnnotationPanelProps {
  annotations: Annotation[]
  selectedAnnotationId?: string | null
  onAnnotationClick?: (annotation: Annotation) => void
  onAnnotationDoubleClick?: (annotation: Annotation) => void
}

type DisplayAnnotationItem = {
  primary: Annotation
  noteSource: Annotation | null
  noteText: string | null
}

const COLOR_LABELS: Record<string, string> = {
  '#f5d90a': 'pdf.highlightColors.yellow',
  '#7ccf00': 'pdf.highlightColors.green',
  '#4da3ff': 'pdf.highlightColors.blue',
  '#ff8a4c': 'pdf.highlightColors.orange',
  '#f06292': 'pdf.highlightColors.pink',
  '#ff0000': 'pdf.highlightColors.pureRed',
  '#ffff00': 'pdf.highlightColors.pureYellow',
  '#0000ff': 'pdf.highlightColors.pureBlue',
  '#000000': 'pdf.highlightColors.black',
}

const TYPE_LABELS: Record<Annotation['type'], string> = {
  highlight: 'pdf.annotationTypes.highlight',
  underline: 'pdf.annotationTypes.underline',
  strikeout: 'pdf.annotationTypes.strikeout',
  squiggly: 'pdf.annotationTypes.squiggly',
  square: 'pdf.annotationTypes.square',
  circle: 'pdf.annotationTypes.circle',
  text: 'pdf.annotationTypes.text',
  popup: 'pdf.annotationTypes.popup',
  stamp: 'pdf.annotationTypes.stamp',
  ink: 'pdf.annotationTypes.ink',
}

function renderAnnotationTypeIcon(type: Annotation['type']) {
  switch (type) {
    case 'highlight':
      return (
        <svg className="pdf-annotation-type-icon" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M5 13.5H15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M6.5 9.5L9.2 6.8L13.2 10.8L10.5 13.5H6.5V9.5Z" fill="currentColor" opacity="0.88" />
        </svg>
      )
    case 'underline':
      return (
        <svg className="pdf-annotation-type-icon" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M6.2 5.5V10C6.2 12.1 7.8 13.7 10 13.7C12.2 13.7 13.8 12.1 13.8 10V5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M5 16H15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      )
    case 'strikeout':
      return (
        <svg className="pdf-annotation-type-icon" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M4.5 10H15.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      )
    case 'squiggly':
      return (
        <svg className="pdf-annotation-type-icon" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M4 12Q5.5 9.2 7 12T10 12T13 12T16 12" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'square':
      return (
        <svg className="pdf-annotation-type-icon" viewBox="0 0 20 20" aria-hidden="true">
          <rect x="4.5" y="4.5" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      )
    case 'circle':
      return (
        <svg className="pdf-annotation-type-icon" viewBox="0 0 20 20" aria-hidden="true">
          <ellipse cx="10" cy="10" rx="5.5" ry="5.5" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      )
    case 'text':
      return <span className="pdf-annotation-type-icon pdf-annotation-type-icon-text" aria-hidden="true">T</span>
    case 'popup':
      return <span className="pdf-annotation-type-icon pdf-annotation-type-icon-text" aria-hidden="true">P</span>
    case 'stamp':
      return <span className="pdf-annotation-type-icon pdf-annotation-type-icon-text" aria-hidden="true">S</span>
    case 'ink':
      return <span className="pdf-annotation-type-icon pdf-annotation-type-icon-text" aria-hidden="true">✎</span>
  }
}

function areRectsEqual(left: Annotation['rects'], right: Annotation['rects']) {
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

function findLinkedMarkupAnnotation(annotation: Annotation, annotations: readonly Annotation[]) {
  if (annotation.type !== 'text') return null
  return (
    annotations.find(
      (candidate) =>
        candidate.id !== annotation.id &&
        isMarkupAnnotation(candidate) &&
        candidate.page === annotation.page &&
        (candidate.content?.trim() || '') === (annotation.content?.trim() || '') &&
        areRectsEqual(candidate.rects, annotation.rects),
    ) ?? null
  )
}

function getAnchorRect(annotation: Annotation) {
  return [...annotation.rects].sort((left, right) => {
    if (left.y1 !== right.y1) return left.y1 - right.y1
    return left.x1 - right.x1
  })[0] ?? null
}

function PdfAnnotationPanelInner({
  annotations,
  selectedAnnotationId = null,
  onAnnotationClick,
  onAnnotationDoubleClick,
}: PdfAnnotationPanelProps) {
  const { t } = useI18n()

  const displayAnnotations = useMemo(() => {
    const sortedAnnotations = [...annotations].sort((left, right) => {
      if (left.page !== right.page) return left.page - right.page
      return left.createdAt - right.createdAt
    })

    const nextDisplayAnnotations: DisplayAnnotationItem[] = []
    const consumedTextIds = new Set<string>()

    for (const annotation of sortedAnnotations) {
      if (annotation.type === 'text' && consumedTextIds.has(annotation.id)) {
        continue
      }

      if (annotation.type === 'text') {
        const linkedMarkup = findLinkedMarkupAnnotation(annotation, sortedAnnotations)
        if (linkedMarkup) {
          consumedTextIds.add(annotation.id)
          continue
        }
      }

      const linkedText =
        isMarkupAnnotation(annotation)
          ? sortedAnnotations.find(
              (candidate) =>
                candidate.type === 'text' &&
                candidate.page === annotation.page &&
                (candidate.content?.trim() || '') === (annotation.content?.trim() || '') &&
                areRectsEqual(candidate.rects, annotation.rects),
            ) ?? null
          : null

      if (linkedText) {
        consumedTextIds.add(linkedText.id)
      }

      nextDisplayAnnotations.push({
        primary: annotation,
        noteSource: annotation.note?.trim() ? annotation : linkedText,
        noteText: annotation.note?.trim() || linkedText?.note?.trim() || null,
      })
    }

    nextDisplayAnnotations.sort((left, right) => {
      if (left.primary.page !== right.primary.page) {
        return left.primary.page - right.primary.page
      }

      const leftAnchor = getAnchorRect(left.primary)
      const rightAnchor = getAnchorRect(right.primary)

      if (leftAnchor && rightAnchor) {
        if (leftAnchor.y1 !== rightAnchor.y1) return leftAnchor.y1 - rightAnchor.y1
        if (leftAnchor.x1 !== rightAnchor.x1) return leftAnchor.x1 - rightAnchor.x1
      } else if (leftAnchor || rightAnchor) {
        return leftAnchor ? -1 : 1
      }

      return left.primary.createdAt - right.primary.createdAt
    })

    return nextDisplayAnnotations
  }, [annotations])

  return (
    <aside className="pdf-annotation-panel">
      <div className="pdf-annotation-panel-header">
        <div className="pdf-annotation-panel-title">{t('pdf.annotationTools')}</div>
        <div className="pdf-annotation-panel-count">{displayAnnotations.length}</div>
      </div>

      <div className="pdf-annotation-panel-body">
        {displayAnnotations.length === 0 ? (
          <div className="pdf-annotation-empty">{t('pdf.noAnnotations')}</div>
        ) : (
          displayAnnotations.map(({ primary, noteSource, noteText }) => {
            const colorKey = COLOR_LABELS[primary.color]
            return (
              <button
                key={primary.id}
                type="button"
                className={`pdf-annotation-item ${selectedAnnotationId === primary.id || selectedAnnotationId === noteSource?.id ? 'selected' : ''}`}
                onClick={() => {
                  onAnnotationClick?.(primary)
                }}
                onDoubleClick={() => {
                  if (noteSource && noteText) {
                    onAnnotationDoubleClick?.(noteSource)
                  }
                }}
              >
                <div className="pdf-annotation-item-top">
                  <span className="pdf-annotation-page">P{primary.page}</span>
                  <span className="pdf-annotation-type-badge">
                    {renderAnnotationTypeIcon(primary.type)}
                    <span className="pdf-annotation-type">{t(TYPE_LABELS[primary.type])}</span>
                  </span>
                  <span
                    className="pdf-annotation-color-dot"
                    style={{ '--pdf-annotation-color': primary.color } as React.CSSProperties}
                    title={colorKey ? t(colorKey) : primary.color}
                  />
                </div>
                <div className="pdf-annotation-content">
                  {primary.content?.trim() || t(TYPE_LABELS[primary.type])}
                </div>
                {noteText ? (
                  <div className="pdf-annotation-note">{noteText}</div>
                ) : null}
              </button>
            )
          })
        )}
      </div>
    </aside>
  )
}

export const PdfAnnotationPanel = memo(PdfAnnotationPanelInner)
