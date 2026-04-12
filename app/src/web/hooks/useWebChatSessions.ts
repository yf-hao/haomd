import { useCallback, useEffect, useState } from 'react'
import type { WebLiteChatSession } from '../domain/models'
import { chatSessionsRepoWeb } from '../storage/chatSessionsRepo.web'

export function useWebChatSessions() {
  const [sessions, setSessions] = useState<WebLiteChatSession[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setSessions(await chatSessionsRepoWeb.listSessions())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const createSession = useCallback(async () => {
    const session = await chatSessionsRepoWeb.createSession()
    await refresh()
    return session
  }, [refresh])

  const deleteSession = useCallback(async (id: string) => {
    await chatSessionsRepoWeb.deleteSession(id)
    await refresh()
  }, [refresh])

  const saveSession = useCallback(async (session: WebLiteChatSession) => {
    await chatSessionsRepoWeb.saveSession(session)
    await refresh()
  }, [refresh])

  return { sessions, loading, refresh, createSession, deleteSession, saveSession }
}
