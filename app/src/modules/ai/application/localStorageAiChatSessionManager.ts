import type { IAiChatSessionManager, PersistedAiChatSession } from '../domain/aiChatSessionManager'
import type { ConversationState, EntryContext, ChatEntryMode } from '../domain/chatSession'
import type { SystemPromptInfo } from './systemPromptService'
import type { ProviderType } from '../domain/types'

const STORAGE_KEY = 'haomd_ai_chat_sessions'

/**
 * 基于 localStorage 的简单 AI Chat 会话持久化实现。
 *
 * - 仅在浏览器环境下启用（SSR/Tauri 后端不会访问 localStorage）。
 * - 内部使用 Map 作为内存缓存，启动时从 localStorage 反序列化。
 */
export class LocalStorageAiChatSessionManager implements IAiChatSessionManager {
  private sessions: Map<string, PersistedAiChatSession>

  constructor() {
    this.sessions = this.loadFromStorage()
  }

  private loadFromStorage(): Map<string, PersistedAiChatSession> {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
      return new Map()
    }
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (!raw) return new Map()
      const parsed = JSON.parse(raw) as [string, PersistedAiChatSession][]
      return new Map(parsed)
    } catch (e) {
      console.error('[LocalStorageAiChatSessionManager] Failed to load sessions:', e)
      return new Map()
    }
  }

  private saveToStorage(): void {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
      return
    }
    try {
      const data = Array.from(this.sessions.entries())
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch (e) {
      console.error('[LocalStorageAiChatSessionManager] Failed to save sessions:', e)
    }
  }

  getOrCreateSession(tabId: string): PersistedAiChatSession | null {
    return this.sessions.get(tabId) ?? null
  }

  saveSession(
    tabId: string,
    data: {
      state: ConversationState
      systemPromptInfo: SystemPromptInfo | null
      providerType: ProviderType | null
      entryMode?: ChatEntryMode
      initialContext?: EntryContext
    },
  ): void {
    const existing = this.sessions.get(tabId)
    const now = Date.now()

    const session: PersistedAiChatSession = {
      tabId,
      state: data.state,
      systemPromptInfo: data.systemPromptInfo,
      providerType: data.providerType,
      entryMode: data.entryMode ?? existing?.entryMode ?? 'chat',
      initialContext: data.initialContext ?? existing?.initialContext,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }

    this.sessions.set(tabId, session)
    this.saveToStorage()
  }

  deleteSession(tabId: string): void {
    this.sessions.delete(tabId)
    this.saveToStorage()
  }

  clearAllSessions(): void {
    this.sessions.clear()
    this.saveToStorage()
  }

  hasSession(tabId: string): boolean {
    return this.sessions.has(tabId)
  }
}

// 默认导出一个全局单例，方便直接使用
export const aiChatSessionManager = new LocalStorageAiChatSessionManager()
