import { useI18n } from '../../i18n/I18nContext'
import type { Annotation } from '../types/annotation'

export interface PdfAnnotationPanelProps {
  annotations: Annotation[]
  selectedAnnotationId?: string | null
  onAnnotationClick?: (annotation: Annotation) => void
}

const COLOR_LABELS: Record<string, string> = {
  '#f5d90a': 'pdf.highlightColors.yellow',
  '#7ccf00': 'pdf.highlightColors.green',
  '#4da3ff': 'pdf.highlightColors.blue',
  '#ff8a4c': 'pdf.highlightColors.orange',
  '#f06292': 'pdf.highlightColors.pink',
}

const TYPE_LABELS: Record<Annotation['type'], string> = {
  highlight: 'pdf.annotationTypes.highlight',
  underline: 'pdf.annotationTypes.underline',
  strikeout: 'pdf.annotationTypes.strikeout',
  squiggly: 'pdf.annotationTypes.squiggly',
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

export function PdfAnnotationPanel({
  annotations,
  selectedAnnotationId = null,
  onAnnotationClick,
}: PdfAnnotationPanelProps) {
  const { t } = useI18n()

  const sortedAnnotations = [...annotations].sort((left, right) => {
    if (left.page !== right.page) return left.page - right.page
    return left.createdAt - right.createdAt
  })

  return (
    <aside className="pdf-annotation-panel">
      <div className="pdf-annotation-panel-header">
        <div className="pdf-annotation-panel-title">{t('pdf.annotationTools')}</div>
        <div className="pdf-annotation-panel-count">{sortedAnnotations.length}</div>
      </div>

      <div className="pdf-annotation-panel-body">
        {sortedAnnotations.length === 0 ? (
          <div className="pdf-annotation-empty">{t('pdf.noAnnotations')}</div>
        ) : (
          sortedAnnotations.map((annotation) => {
            const colorKey = COLOR_LABELS[annotation.color]
            return (
              <button
                key={annotation.id}
                type="button"
                className={`pdf-annotation-item ${selectedAnnotationId === annotation.id ? 'selected' : ''}`}
                onClick={() => {
                  onAnnotationClick?.(annotation)
                }}
              >
                <div className="pdf-annotation-item-top">
                  <span className="pdf-annotation-page">P{annotation.page}</span>
                  <span className="pdf-annotation-type-badge">
                    {renderAnnotationTypeIcon(annotation.type)}
                    <span className="pdf-annotation-type">{t(TYPE_LABELS[annotation.type])}</span>
                  </span>
                  <span
                    className="pdf-annotation-color-dot"
                    style={{ '--pdf-annotation-color': annotation.color } as React.CSSProperties}
                    title={colorKey ? t(colorKey) : annotation.color}
                  />
                </div>
                <div className="pdf-annotation-content">
                  {annotation.content?.trim() || t('pdf.emptyAnnotationContent')}
                </div>
              </button>
            )
          })
        )}
      </div>
    </aside>
  )
}
