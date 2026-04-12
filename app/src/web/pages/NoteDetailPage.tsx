import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { NotesEditor } from '../components/NotesEditor'
import type { WebLiteNote } from '../domain/models'

export function NoteDetailPage({
  note,
  loading,
  onBack,
  onSave,
  onContinueChat,
  onExportMarkdown,
}: {
  note: WebLiteNote | null
  loading: boolean
  onBack?: () => void
  onSave: (note: WebLiteNote) => Promise<void> | void
  onContinueChat?: (note: WebLiteNote) => Promise<void> | void
  onExportMarkdown?: (note: WebLiteNote) => void
}) {
  const [draft, setDraft] = useState<WebLiteNote | null>(note)
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')

  useEffect(() => {
    setDraft(note)
  }, [note])

  useEffect(() => {
    if (!draft) return
    const timer = window.setTimeout(() => {
      void onSave(draft)
    }, 600)
    return () => window.clearTimeout(timer)
  }, [draft, onSave])

  if (loading) {
    return <section className="web-detail"><div className="web-empty">加载中...</div></section>
  }

  if (!draft) {
    return <section className="web-detail"><div className="web-empty">请选择一篇随笔。</div></section>
  }

  return (
    <section className="web-detail">
      <header className="web-detail-header">
        {onBack ? <button onClick={onBack}>返回</button> : <span />}
        <h2>{draft.title}</h2>
        <div className="web-detail-actions">
          <button onClick={() => setMode((prev) => (prev === 'edit' ? 'preview' : 'edit'))}>
            {mode === 'edit' ? '预览' : '编辑'}
          </button>
          {onExportMarkdown ? <button onClick={() => onExportMarkdown(draft)}>导出 Markdown</button> : null}
          {onContinueChat ? <button onClick={() => void onContinueChat(draft)}>继续聊天</button> : null}
          <span className="web-saving-indicator">自动保存</span>
        </div>
      </header>
      {mode === 'edit' ? (
        <NotesEditor note={draft} onChange={setDraft} />
      ) : (
        <article className="web-note-preview">
          <h1>{draft.title}</h1>
          <ReactMarkdown>{draft.content || '_暂无内容_'}</ReactMarkdown>
        </article>
      )}
    </section>
  )
}
