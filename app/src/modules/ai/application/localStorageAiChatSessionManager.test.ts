import { describe, it, expect, beforeEach } from 'vitest'
import { LocalStorageAiChatSessionManager } from './localStorageAiChatSessionManager'
import type { PersistedAiChatSession } from '../domain/aiChatSessionManager'
import type { ConversationState } from '../domain/chatSession'

function createMockState(): ConversationState {
  return {
    engineHistory: [],
    viewMessages: [],
    entryMode: 'chat',
    activeRoleId: undefined,
  }
}

describe('LocalStorageAiChatSessionManager', () => {
  let manager: LocalStorageAiChatSessionManager

  beforeEach(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.clear()
    }
    manager = new LocalStorageAiChatSessionManager()
  })

  it('should save and retrieve session', () => {
    const tabId = 'tab-1'
    const state: ConversationState = createMockState()

    manager.saveSession(tabId, {
      state,
      systemPromptInfo: null,
      providerType: 'openai',
      entryMode: 'chat',
    })

    const retrieved = manager.getOrCreateSession(tabId)
    expect(retrieved).not.toBeNull()
    const session = retrieved as PersistedAiChatSession

    expect(session.tabId).toBe(tabId)
    expect(session.state.entryMode).toBe('chat')
    expect(session.providerType).toBe('openai')
    expect(session.systemPromptInfo).toBeNull()
    expect(session.createdAt).toBeTypeOf('number')
    expect(session.updatedAt).toBeTypeOf('number')
  })

  it('should delete session', () => {
    const tabId = 'tab-1'
    manager.saveSession(tabId, {
      state: createMockState(),
      systemPromptInfo: null,
      providerType: 'openai',
      entryMode: 'chat',
    })

    expect(manager.hasSession(tabId)).toBe(true)

    manager.deleteSession(tabId)

    expect(manager.hasSession(tabId)).toBe(false)
    expect(manager.getOrCreateSession(tabId)).toBeNull()
  })

  it('should clear all sessions', () => {
    manager.saveSession('tab-1', {
      state: createMockState(),
      systemPromptInfo: null,
      providerType: 'openai',
      entryMode: 'chat',
    })
    manager.saveSession('tab-2', {
      state: createMockState(),
      systemPromptInfo: null,
      providerType: 'dify',
      entryMode: 'chat',
    })

    expect(manager.hasSession('tab-1')).toBe(true)
    expect(manager.hasSession('tab-2')).toBe(true)

    manager.clearAllSessions()

    expect(manager.hasSession('tab-1')).toBe(false)
    expect(manager.hasSession('tab-2')).toBe(false)
  })
})
