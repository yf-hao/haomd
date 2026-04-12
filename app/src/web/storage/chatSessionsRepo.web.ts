import { get, set } from 'idb-keyval'
import type { WebLiteChatSession } from '../domain/models'
import { DB_KEYS, webLiteStore } from './indexedDb'

async function loadAll(): Promise<WebLiteChatSession[]> {
  return (await get<WebLiteChatSession[]>(DB_KEYS.chatSessions, webLiteStore)) ?? []
}

async function saveAll(sessions: WebLiteChatSession[]): Promise<void> {
  await set(DB_KEYS.chatSessions, sessions, webLiteStore)
}

export const chatSessionsRepoWeb = {
  async listSessions(): Promise<WebLiteChatSession[]> {
    const sessions = await loadAll()
    return sessions
      .filter((session) => !session.deletedAt)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  },

  async listAllSessions(): Promise<WebLiteChatSession[]> {
    const sessions = await loadAll()
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt)
  },

  async getSession(id: string): Promise<WebLiteChatSession | null> {
    const sessions = await loadAll()
    const session = sessions.find((item) => item.id === id) ?? null
    if (!session || session.deletedAt) return null
    return session
  },

  async saveSession(session: WebLiteChatSession): Promise<void> {
    const sessions = await loadAll()
    const next = sessions.some((item) => item.id === session.id)
      ? sessions.map((item) => (item.id === session.id ? session : item))
      : [...sessions, session]
    await saveAll(next)
  },

  async deleteSession(id: string): Promise<void> {
    const sessions = await loadAll()
    const now = Date.now()
    await saveAll(
      sessions.map((session) =>
        session.id === id
          ? {
              ...session,
              updatedAt: now,
              deletedAt: now,
            }
          : session,
      ),
    )
  },

  async replaceAllSessions(sessions: WebLiteChatSession[]): Promise<void> {
    await saveAll(sessions)
  },

  async createSession(): Promise<WebLiteChatSession> {
    const now = Date.now()
    const session: WebLiteChatSession = {
      id: crypto.randomUUID(),
      title: '新对话',
      messages: [],
      createdAt: now,
      updatedAt: now,
    }
    await this.saveSession(session)
    return session
  },
}
