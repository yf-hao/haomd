import { memo } from 'react'
import { useI18n } from '../../i18n/I18nContext'
import type { PdfNote } from '../types/note'

export interface PdfNotesPanelProps {
  notes: PdfNote[]
  selectedNoteId?: string | null
  busy?: boolean
  onSelectNote?: (note: PdfNote) => void
  onStartCreate?: () => void
  onExportMarkdown?: () => void
  onDeleteNote?: (note: PdfNote) => void
}

export const PdfNotesPanel = memo(function PdfNotesPanel({
  notes,
  selectedNoteId = null,
  busy = false,
  onSelectNote,
  onStartCreate,
  onExportMarkdown,
  onDeleteNote,
}: PdfNotesPanelProps) {
  const { t } = useI18n()

  return (
    <div className="pdf-annotation-panel">
      <div className="pdf-annotation-panel-header">
        <div className="pdf-annotation-panel-title">{t('pdf.notesPanelTitle')}</div>
        <div className="pdf-notes-panel-actions">
          <button
            type="button"
            className="pdf-notes-panel-action"
            onClick={onStartCreate}
            disabled={busy}
          >
            {t('pdf.newNote')}
          </button>
          <button
            type="button"
            className="pdf-notes-panel-action"
            onClick={onExportMarkdown}
            disabled={busy || notes.length === 0}
          >
            {t('pdf.exportNotes')}
          </button>
          <span className="pdf-annotation-panel-count">{notes.length}</span>
        </div>
      </div>
      <div className="pdf-annotation-panel-body">
        {notes.length === 0 ? (
          <div className="pdf-annotation-empty">{t('pdf.notesEmpty')}</div>
        ) : (
          notes.map((note) => (
            <button
              key={note.id}
              type="button"
              className={`pdf-annotation-item ${selectedNoteId === note.id ? 'selected' : ''}`}
              onClick={() => {
                onSelectNote?.(note)
              }}
            >
              <div className="pdf-annotation-item-top">
                <span className="pdf-annotation-type-badge" style={{ '--pdf-annotation-color': note.color } as React.CSSProperties}>
                  <svg className="pdf-annotation-type-icon" viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M5.2 4.8H14.8V13.6H8.8L5.2 16.2V4.8Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
                    <path d="M7.2 7.6H12.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                    <path d="M7.2 10H11.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  </svg>
                </span>
                <div className="pdf-annotation-item-meta">
                  {note.page ? t('pdf.notePage', { page: note.page }) : t('pdf.annotationTypes.note')}
                </div>
              </div>
              {note.quote ? <div className="pdf-note-card-quote">{note.quote}</div> : null}
              <div className="pdf-annotation-note">{note.text}</div>
              <div className="pdf-note-card-list-actions">
                <button
                  type="button"
                  className="pdf-note-inline-btn"
                  onClick={(event) => {
                    event.stopPropagation()
                    onSelectNote?.(note)
                  }}
                >
                  {t('common.edit')}
                </button>
                <button
                  type="button"
                  className="pdf-note-inline-btn"
                  onClick={(event) => {
                    event.stopPropagation()
                    onDeleteNote?.(note)
                  }}
                >
                  {t('common.delete')}
                </button>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
})
