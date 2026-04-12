import { useRef, useState, useMemo } from 'react'
import type { WebLiteNote } from '../domain/models'

export function NotesListPage({
  notes,
  activeNoteId,
  onCreate,
  onImport,
  onOpen,
  onDelete,
}: {
  notes: WebLiteNote[]
  activeNoteId?: string
  onCreate: () => Promise<void> | void
  onImport?: (file: File) => Promise<void> | void
  onOpen: (id: string) => void
  onDelete: (id: string) => Promise<void> | void
}) {
  const [query, setQuery] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const filteredNotes = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return notes
    return notes.filter((note) =>
      note.title.toLowerCase().includes(keyword) ||
      note.content.toLowerCase().includes(keyword),
    )
  }, [notes, query])

  return (
    <section className="web-panel">
      <header className="web-panel-header">
        <h1>随笔</h1>
        <div className="web-panel-actions">
          {onImport ? <button onClick={() => fileInputRef.current?.click()}>导入</button> : null}
          <button onClick={() => void onCreate()}>新建</button>
        </div>
      </header>
      {onImport ? (
        <input
          ref={fileInputRef}
          className="web-hidden-file-input"
          type="file"
          accept=".md,text/markdown"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void onImport(file)
            event.currentTarget.value = ''
          }}
        />
      ) : null}
      <input
        className="web-search-input"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="搜索随笔"
      />
      <div className="web-list">
        {filteredNotes.map((note) => (
          <div key={note.id} className={`web-list-item ${note.id === activeNoteId ? 'active' : ''}`}>
            <button className="web-list-main" onClick={() => onOpen(note.id)}>
              <span className="web-list-title">{note.title}</span>
              <span className="web-list-meta">{new Date(note.updatedAt).toLocaleString()}</span>
            </button>
            <button className="web-list-delete" onClick={() => void onDelete(note.id)}>删除</button>
          </div>
        ))}
        {notes.length === 0 && <div className="web-empty">还没有随笔，先新建一篇。</div>}
        {notes.length > 0 && filteredNotes.length === 0 && <div className="web-empty">没有匹配的随笔。</div>}
      </div>
    </section>
  )
}
