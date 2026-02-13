import type { ChatEntryMode, ConversationState, EntryContext } from '../domain/chatSession'
import type { ChatSession, StartChatOptions } from './chatSessionService'
import { createChatSession } from './chatSessionService'

export type AiChatSessionKey = string // session key

export type SessionListener = (state: ConversationState) => void

export interface ChatSessionRecord {
  id: string
  key: AiChatSessionKey
  entryMode: ChatEntryMode
  initialContext?: EntryContext
  session: ChatSession
  state: ConversationState
  createdAt: number
  lastActiveAt: number
  disposed: boolean
}

export class AiChatSessionService {
  private sessions = new Map<AiChatSessionKey, ChatSessionRecord>()
  private listeners = new Map<AiChatSessionKey, Set<SessionListener>>()

  private genId(): string {
    return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }

  getSession(key: AiChatSessionKey): ChatSessionRecord | null {
    const record = this.sessions.get(key) ?? null
    if (!record || record.disposed) return null
    return record
  }

  async getOrCreateSession(
    key: AiChatSessionKey,
    options: Omit<StartChatOptions, 'onStateChange'> & { onStateChange?: (state: ConversationState) => void } = {} as any,
  ): Promise<ChatSessionRecord> {
    const existing = this.sessions.get(key)
    if (existing && !existing.disposed) {
      return existing
    }

    const { entryMode, initialContext, onStateChange, ...rest } = options

    const startOptions: StartChatOptions = {
      entryMode,
      initialContext,
      ...(rest as any),
      onStateChange: (nextState) => {
        const current = this.sessions.get(key)
        if (!current || current.disposed) return
        current.state = nextState
        current.lastActiveAt = Date.now()
        this.notify(key, nextState)
        onStateChange?.(nextState)
      },
    }

    const session = await createChatSession(startOptions)
    const now = Date.now()
    const state = session.getState()

    const record: ChatSessionRecord = {
      id: this.genId(),
      key,
      entryMode,
      initialContext,
      session,
      state,
      createdAt: now,
      lastActiveAt: now,
      disposed: false,
    }

    this.sessions.set(key, record)
    // 初始状态也通知一次监听者
    this.notify(key, state)

    return record
  }

  subscribe(key: AiChatSessionKey, listener: SessionListener): () => void {
    let set = this.listeners.get(key)
    if (!set) {
      set = new Set()
      this.listeners.set(key, set)
    }
    set.add(listener)

    const record = this.sessions.get(key)
    if (record && !record.disposed) {
      listener(record.state)
    }

    return () => {
      const currentSet = this.listeners.get(key)
      if (!currentSet) return
      currentSet.delete(listener)
      if (currentSet.size === 0) {
        this.listeners.delete(key)
      }
    }
  }

  updateSessionState(
    key: AiChatSessionKey,
    updater: (prev: ConversationState) => ConversationState,
  ): void {
    const record = this.sessions.get(key)
    if (!record || record.disposed) return
    const next = updater(record.state)
    record.state = next
    record.lastActiveAt = Date.now()
    this.notify(key, next)
  }

  disposeSession(key: AiChatSessionKey): void {
    const record = this.sessions.get(key)
    if (!record || record.disposed) return

    record.disposed = true
    try {
      record.session.dispose()
    } catch (e) {
      console.error('[AiChatSessionService] disposeSession error', e)
    }

    this.sessions.delete(key)
    this.listeners.delete(key)
  }

  disposeAll(): void {
    for (const key of this.sessions.keys()) {
      this.disposeSession(key)
    }
  }

  private notify(key: AiChatSessionKey, state: ConversationState): void {
    const set = this.listeners.get(key)
    if (!set || set.size === 0) return
    for (const listener of set) {
      try {
        listener(state)
      } catch (e) {
        console.error('[AiChatSessionService] listener error', e)
      }
    }
  }
}
