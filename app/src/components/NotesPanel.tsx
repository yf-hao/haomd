import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { useI18n } from '../modules/i18n/I18nContext'
import { SidebarBackgroundShell } from './SidebarBackgroundShell'
import { getNotesConfig, saveNotesConfig } from '../modules/settings/editorSettings'
import { listNotes, createNote, type NoteFile } from '../modules/notes/notesFileService'

export type NotesPanelProps = {
  panelWidth?: number
  onOpenFile?: (path: string) => Promise<unknown>
}

export const NotesPanel = memo(function NotesPanel({ panelWidth, onOpenFile }: NotesPanelProps) {
  const { t } = useI18n()
  const [notesDir, setNotesDir] = useState<string | null>(null)
  const [notes, setNotes] = useState<NoteFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)

  const style = panelWidth ? { width: panelWidth } : undefined

  const refreshList = useCallback(async (dir: string) => {
    setLoading(true)
    setError('')
    try {
      const list = await listNotes(dir)
      setNotes(list)
    } catch (e) {
      setError(String(e))
      setNotes([])
    } finally {
      setLoading(false)
    }
  }, [])

  // Load config on mount
  useEffect(() => {
    void (async () => {
      const cfg = await getNotesConfig()
      setNotesDir(cfg.notesDirectory)
      if (cfg.notesDirectory) {
        await refreshList(cfg.notesDirectory)
      } else {
        setLoading(false)
      }
    })()
  }, [refreshList])

  // Focus the title input when inline creation starts
  useEffect(() => {
    if (isCreating) {
      titleInputRef.current?.focus()
    }
  }, [isCreating])

  // Configure notes directory via native folder picker
  const handleConfigDir = useCallback(async () => {
    const selected = await openDialog({ directory: true, multiple: false })
    if (!selected || typeof selected !== 'string') return
    await saveNotesConfig({ notesDirectory: selected })
    setNotesDir(selected)
    await refreshList(selected)
  }, [refreshList])

  // Show inline title input
  const handleNewNoteClick = useCallback(() => {
    if (!notesDir) return
    setNewTitle('')
    setIsCreating(true)
  }, [notesDir])

  // Confirm creation with the entered title
  const handleTitleConfirm = useCallback(async () => {
    if (!notesDir) return
    setIsCreating(false)
    const title = newTitle.trim()
    try {
      const path = await createNote(notesDir, '', title || undefined)
      await refreshList(notesDir)
      if (onOpenFile) await onOpenFile(path)
    } catch (e) {
      setError(String(e))
    }
  }, [notesDir, newTitle, refreshList, onOpenFile])

  const handleTitleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') void handleTitleConfirm()
      if (e.key === 'Escape') setIsCreating(false)
    },
    [handleTitleConfirm],
  )

  // Open note in editor on click
  const handleOpen = useCallback(
    async (note: NoteFile) => {
      if (onOpenFile) await onOpenFile(note.path)
    },
    [onOpenFile],
  )

  const formatDate = (d: Date) => {
    if (d.getTime() === 0) return ''
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const min = String(d.getMinutes()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd} ${hh}:${min}`
  }

  return (
    <SidebarBackgroundShell className="notes-panel" style={style}>
      <div className="notes-panel-header">
        <span>{t('notes.title')}</span>
        <div className="notes-panel-actions">
          <button
            type="button"
            className="notes-action-btn"
            title={t('notes.configDir')}
            onClick={() => void handleConfigDir()}
          >
            <span className="notes-icon-folder" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="notes-action-btn"
            title={t('notes.newNote')}
            onClick={handleNewNoteClick}
            disabled={!notesDir}
          >
            +
          </button>
        </div>
      </div>

      <div className="notes-panel-content">
        {!notesDir ? (
          <p className="notes-panel-empty">{t('notes.dirNotConfigured')}</p>
        ) : loading ? (
          <p className="notes-panel-empty">{t('notes.loading')}</p>
        ) : error ? (
          <p className="notes-panel-empty notes-panel-error">{error}</p>
        ) : (
          <>
            {isCreating && (
              <div className="notes-new-item">
                <input
                  ref={titleInputRef}
                  className="notes-new-input"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={handleTitleKeyDown}
                  onBlur={() => void handleTitleConfirm()}
                  placeholder={t('notes.titlePlaceholder')}
                />
              </div>
            )}
            {notes.length === 0 && !isCreating ? (
              <p className="notes-panel-empty">{t('notes.empty')}</p>
            ) : (
              <ul className="notes-list">
                {notes.map((note) => (
                  <li
                    key={note.path}
                    className="notes-item"
                    onClick={() => void handleOpen(note)}
                    title={note.path}
                  >
                    <div className="notes-item-info">
                      <span className="notes-item-title">
                        {note.name.replace(/\.md$/, '')}
                      </span>
                      <span className="notes-item-meta">{formatDate(note.createdAt)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </SidebarBackgroundShell>
  )
})
