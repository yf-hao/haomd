import type { ReactNode } from 'react'
import { createContext, useContext, useMemo, useEffect } from 'react'
import { AiChatSessionService } from '../application/aiChatSessionService'
import { loadEditorSettings } from '../../settings/editorSettings'

export type AiChatContextValue = {
  sessionService: AiChatSessionService
}

const AiChatContext = createContext<AiChatContextValue | null>(null)

export function AiChatProvider({ children }: { children: ReactNode }) {
  const sessionService = useMemo(() => new AiChatSessionService(), [])

  useEffect(() => {
    // 应用启动时预加载 editor_settings，确保 editor_settings.json 存在并补全 aiCompression
    loadEditorSettings().catch((err) => {
      console.error('[AiChatProvider] preload editor_settings failed', err)
    })
  }, [])

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
