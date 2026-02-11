import type { ReactNode } from 'react'
import { createContext, useContext, useMemo } from 'react'
import { AiChatSessionService } from '../application/aiChatSessionService'

export type AiChatContextValue = {
  sessionService: AiChatSessionService
}

const AiChatContext = createContext<AiChatContextValue | null>(null)

export function AiChatProvider({ children }: { children: ReactNode }) {
  const sessionService = useMemo(() => new AiChatSessionService(), [])

  return (
    <AiChatContext.Provider value={{ sessionService }}>
      {children}
    </AiChatContext.Provider>
  )
}

export function useAiChatSessionService(): AiChatSessionService {
  const ctx = useContext(AiChatContext)
  if (!ctx) {
    throw new Error('useAiChatSessionService must be used within AiChatProvider')
  }
  return ctx.sessionService
}
