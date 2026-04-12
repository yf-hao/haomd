import type { WebLiteNote } from '../domain/models'

export function NotesEditor({
  note,
  onChange,
}: {
  note: WebLiteNote
  onChange: (note: WebLiteNote) => void
}) {
  return (
    <div className="web-note-editor">
      <input
        className="web-note-title"
        value={note.title}
        onChange={(event) => onChange({ ...note, title: event.target.value, updatedAt: Date.now() })}
        placeholder="笔记标题"
      />
      <textarea
        className="web-note-content"
        value={note.content}
        onChange={(event) => onChange({ ...note, content: event.target.value, updatedAt: Date.now() })}
        placeholder="输入 Markdown 内容..."
      />
    </div>
  )
}
