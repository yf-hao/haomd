import type { AiSettingsState } from '../../modules/ai/settings'

export type WebLiteChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
}

export type WebLiteChatSession = {
  id: string
  title: string
  messages: WebLiteChatMessage[]
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

export type WebLiteNote = {
  id: string
  title: string
  content: string
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

export type WebLiteSyncProvider = 'webdav'

export type WebLiteSyncSettings = {
  provider: WebLiteSyncProvider
  endpoint: string
  username: string
  password: string
  remoteRoot: string
  lastSyncedAt?: number
}

export type WebLiteSettings = {
  ai: AiSettingsState
  sync?: WebLiteSyncSettings | null
}

export const createEmptyWebLiteSettings = (): WebLiteSettings => ({
  ai: { providers: [], defaultProviderId: undefined },
  sync: null,
})
