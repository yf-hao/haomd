import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../modules/i18n/I18nContext'
import { SidebarBackgroundShell } from './SidebarBackgroundShell'
import {
  loadSessionsIndex,
  loadSession,
  saveSession,
  deleteSession as deleteSessionApi,
  type AiChatSessionIndexEntry,
  type AiChatSessionCfg,
} from '../modules/ai/config/aiSessionsRepo'

export type SessionsPanelProps = {
  panelWidth?: number
  activeSessionKey: string
  onSelectSession: (key: string) => void
}

function generateSessionId(): string {
  return `session:${crypto.randomUUID()}`
}

export const SessionsPanel = memo(function SessionsPanel({
  panelWidth,
  activeSessionKey,
  onSelectSession,
}: SessionsPanelProps) {
  const { t } = useI18n()
  const [sessions, setSessions] = useState<AiChatSessionIndexEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)

  const style = panelWidth ? { width: panelWidth } : undefined

  const refreshList = useCallback(async () => {
    const list = await loadSessionsIndex()
    // Sort by updatedAt descending (most recent first)
    list.sort((a, b) => b.updatedAt - a.updatedAt)
    setSessions(list)
    setLoading(false)
  }, [])

  useEffect(() => {
    void refreshList()
  }, [refreshList])

  const handleCreate = useCallback(async () => {
    const now = Date.now()
    const newSession: AiChatSessionCfg = {
      id: generateSessionId(),
      title: null,
      entryMode: 'chat',
      messages: [],
      createdAt: now,
      updatedAt: now,
    }
    await saveSession(newSession)
    await refreshList()
    onSelectSession(newSession.id)
  }, [refreshList, onSelectSession])

  const handleDelete = useCallback(
    async (e: React.MouseEvent, id: string) => {
      e.stopPropagation()
      await deleteSessionApi(id)
      if (activeSessionKey === id) {
        onSelectSession('global')
      }
      await refreshList()
    },
    [activeSessionKey, onSelectSession, refreshList],
  )

  const handleStartRename = useCallback(
    (e: React.MouseEvent, id: string, currentTitle: string | null | undefined) => {
      e.stopPropagation()
      setEditingId(id)
      setEditingTitle(currentTitle ?? '')
      // Focus the input after render
      requestAnimationFrame(() => editInputRef.current?.focus())
    },
    [],
  )

  const handleRenameConfirm = useCallback(
    async (id: string) => {
      if (editingId !== id) return
      const trimmed = editingTitle.trim()
      // Load full session to preserve messages, then update title
      const full = await loadSession(id)
      if (full) {
        full.title = trimmed || null
        full.updatedAt = Date.now()
        await saveSession(full)
        await refreshList()
      }
      setEditingId(null)
    },
    [editingId, editingTitle, refreshList],
  )

  const handleRenameCancel = useCallback(() => {
    setEditingId(null)
  }, [])

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    const now = new Date()
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    }
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  return (
    <SidebarBackgroundShell className="sessions-panel" style={style}>
      <div className="sessions-panel-header">
        <span>{t('sessions.title')}</span>
        <button
          type="button"
          className="sessions-new-btn"
          title={t('sessions.newSession')}
          onClick={handleCreate}
        >
          +
        </button>
      </div>
      <div className="sessions-panel-content">
        {loading ? (
          <p className="sessions-panel-empty">{t('sessions.loading')}</p>
        ) : sessions.length === 0 ? (
          <p className="sessions-panel-empty">{t('sessions.empty')}</p>
        ) : (
          <ul className="sessions-list">
            {sessions.map((s) => (
              <li
                key={s.id}
                className={`sessions-item ${activeSessionKey === s.id ? 'active' : ''}`}
                onClick={() => onSelectSession(s.id)}
                onDoubleClick={(e) => handleStartRename(e, s.id, s.title)}
              >
                {editingId === s.id ? (
                  <input
                    ref={editInputRef}
                    className="sessions-item-rename-input"
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void handleRenameConfirm(s.id)
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        handleRenameCancel()
                      }
                    }}
                    onBlur={() => void handleRenameConfirm(s.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <>
                    <div className="sessions-item-info">
                      <span className="sessions-item-title">
                        {s.title || t('sessions.untitled')}
                      </span>
                      <span className="sessions-item-meta">
                        {s.messageCount > 0 && (
                          <span className="sessions-item-count">{s.messageCount}</span>
                        )}
                        <span className="sessions-item-time">{formatTime(s.updatedAt)}</span>
                      </span>
                    </div>
                    <button
                      type="button"
                      className="sessions-item-delete"
                      title={t('sessions.delete')}
                      onClick={(e) => void handleDelete(e, s.id)}
                    >
                      ×
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </SidebarBackgroundShell>
  )
})
