import { useMemo, useState } from 'react'
import type { WebLiteChatSession } from '../domain/models'

export function ChatListPage({
  sessions,
  activeSessionId,
  onCreate,
  onOpen,
  onDelete,
}: {
  sessions: WebLiteChatSession[]
  activeSessionId?: string
  onCreate: () => Promise<void> | void
  onOpen: (id: string) => void
  onDelete: (id: string) => Promise<void> | void
}) {
  const [query, setQuery] = useState('')
  const filteredSessions = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return sessions
    return sessions.filter((session) =>
      session.title.toLowerCase().includes(keyword) ||
      session.messages.some((message) => message.content.toLowerCase().includes(keyword)),
    )
  }, [query, sessions])

  return (
    <section className="web-panel">
      <header className="web-panel-header">
        <h1>会话</h1>
        <button onClick={() => void onCreate()}>新建</button>
      </header>
      <input
        className="web-search-input"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="搜索会话"
      />
      <div className="web-list">
        {filteredSessions.map((session) => (
          <div key={session.id} className={`web-list-item ${session.id === activeSessionId ? 'active' : ''}`}>
            <button className="web-list-main" onClick={() => onOpen(session.id)}>
              <span className="web-list-title">{session.title}</span>
              <span className="web-list-meta">{new Date(session.updatedAt).toLocaleString()}</span>
            </button>
            <button className="web-list-delete" onClick={() => void onDelete(session.id)}>删除</button>
          </div>
        ))}
        {sessions.length === 0 && <div className="web-empty">还没有会话，先新建一个。</div>}
        {sessions.length > 0 && filteredSessions.length === 0 && <div className="web-empty">没有匹配的会话。</div>}
      </div>
    </section>
  )
}
