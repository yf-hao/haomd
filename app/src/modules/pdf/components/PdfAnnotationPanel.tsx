import { memo, useMemo } from 'react'
import { useI18n } from '../../i18n/I18nContext'
import { isMarkupAnnotation, type Annotation, type StampKind } from '../types/annotation'

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
  line: 'pdf.annotationTypes.line',
  arrow: 'pdf.annotationTypes.arrow',
  freeText: 'pdf.annotationTypes.freeText',
  note: 'pdf.annotationTypes.note',
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
    case 'line':
      return (
        <svg className="pdf-annotation-type-icon" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M4.5 14.5L15.5 5.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      )
    case 'arrow':
      return (
        <svg className="pdf-annotation-type-icon" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M4.5 14.5L14.2 6.8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M10.8 6.5H14.8V10.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'freeText':
      return (
        <svg className="pdf-annotation-type-icon" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M5.2 5.5H14.8" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          <path d="M10 5.5V15.2" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          <path d="M7.4 15.2H12.6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        </svg>
      )
    case 'note':
      return (
        <svg className="pdf-annotation-type-icon" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M5.2 4.8H14.8V13.6H8.8L5.2 16.2V4.8Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
          <path d="M7.2 7.6H12.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M7.2 10H11.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      )
    case 'text':
      return <span className="pdf-annotation-type-icon pdf-annotation-type-icon-text" aria-hidden="true">T</span>
    case 'popup':
      return <span className="pdf-annotation-type-icon pdf-annotation-type-icon-text" aria-hidden="true">P</span>
    case 'stamp':
      return renderStampIcon('important')
    case 'ink':
      return <span className="pdf-annotation-type-icon pdf-annotation-type-icon-text" aria-hidden="true">✎</span>
  }
}

function renderStampIcon(kind: StampKind) {
  switch (kind) {
    case 'important':
      return (
        <svg className="pdf-annotation-type-icon" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M10 3.6L11.6 8.2L16.5 8.3L12.6 11.2L14.1 15.9L10 13L5.9 15.9L7.4 11.2L3.5 8.3L8.4 8.2Z" fill="currentColor" />
        </svg>
      )
    case 'question':
      return (
        <svg className="pdf-annotation-type-icon" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M7.3 7.6C7.5 5.9 8.8 4.9 10.5 4.9C12.3 4.9 13.6 6 13.6 7.6C13.6 8.8 12.9 9.5 11.9 10.1C10.9 10.7 10.3 11.3 10.3 12.4V12.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="10.3" cy="15.4" r="1.1" fill="currentColor" />
        </svg>
      )
    case 'todo':
      return (
        <svg className="pdf-annotation-type-icon" viewBox="0 0 20 20" aria-hidden="true">
          <rect x="4.7" y="4.7" width="10.6" height="10.6" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M7.5 10.2L9.1 11.8L12.7 8.2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'done':
      return (
        <svg className="pdf-annotation-type-icon" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="5.8" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M7.2 10.2L9.2 12.2L13 8.4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'warning':
      return (
        <svg className="pdf-annotation-type-icon" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M10 4.2L15.8 14.7H4.2L10 4.2Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          <path d="M10 8V11.1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="10" cy="13.4" r="1" fill="currentColor" />
        </svg>
      )
    case 'info':
      return (
        <svg className="pdf-annotation-type-icon" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="5.8" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M10 9V13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="10" cy="6.4" r="1" fill="currentColor" />
        </svg>
      )
    case 'flag':
      return (
        <svg className="pdf-annotation-type-icon" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M6 4.5V15.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M6.8 5.2H14.8L12.6 8.4L14.8 11.4H6.8Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      )
    case 'pin':
      return (
        <svg className="pdf-annotation-type-icon" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M8.1 5.3C8.1 4.2 9 3.3 10.1 3.3C11.2 3.3 12.1 4.2 12.1 5.3C12.1 5.9 11.8 6.5 11.3 6.9L13.2 9.6L10.8 10.1L10.3 15.5L9.6 15.5L9.1 10.1L6.7 9.6L8.7 6.9C8.3 6.5 8.1 5.9 8.1 5.3Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      )
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
                    {primary.type === 'stamp'
                      ? renderStampIcon(primary.stampKind ?? 'important')
                      : renderAnnotationTypeIcon(primary.type)}
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
