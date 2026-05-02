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
                  <span className="pdf-annotation-type">{annotation.type}</span>
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
