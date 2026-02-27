import { describe, it, expect } from 'vitest'
import {
    createInitialConversationState,
    appendUserInput,
    appendAssistantPlaceholder,
    appendAssistantChunk,
    completeAssistantMessage,
    truncateAssistantMessage
} from './chatSession'

describe('chatSession domain', () => {
    it('should create initial state with system prompt', () => {
        const state = createInitialConversationState('chat', 'System Prompt')
        expect(state.engineHistory).toHaveLength(1)
        expect(state.engineHistory[0]).toEqual({ role: 'system', content: 'System Prompt' })
        expect(state.viewMessages).toHaveLength(0)
    })

    it('should append user input', () => {
        const state1 = createInitialConversationState('chat', 'System')
        const state2 = appendUserInput(state1, 'u1', 'Hello')

        expect(state2.engineHistory).toHaveLength(2)
        expect(state2.engineHistory[1]).toEqual({ role: 'user', content: 'Hello' })
        expect(state2.viewMessages).toHaveLength(1)
        expect(state2.viewMessages[0]).toEqual({
            id: 'u1',
            role: 'user',
            content: 'Hello',
            hidden: false
        })
    })

    it('should append assistant placeholder', () => {
        const state1 = createInitialConversationState('chat')
        const state2 = appendAssistantPlaceholder(state1, 'a1')

        expect(state2.viewMessages).toHaveLength(1)
        expect(state2.viewMessages[0]).toEqual({
            id: 'a1',
            role: 'assistant',
            content: '',
            streaming: true
        })
    })

    it('should append assistant chunk', () => {
        const state1 = appendAssistantPlaceholder(createInitialConversationState('chat'), 'a1')
        const state2 = appendAssistantChunk(state1, 'a1', 'Hello ')
        const state3 = appendAssistantChunk(state2, 'a1', 'world')

        expect(state3.viewMessages[0].content).toBe('Hello world')
    })

    it('should complete assistant message', () => {
        const state1 = appendAssistantPlaceholder(createInitialConversationState('chat'), 'a1')
        const state2 = appendAssistantChunk(state1, 'a1', 'Full response')
        const state3 = completeAssistantMessage(state2, 'a1')

        expect(state3.viewMessages[0].streaming).toBe(false)
        expect(state3.engineHistory).toContainEqual({ role: 'assistant', content: 'Full response' })
    })

    it('should truncate assistant message', () => {
        const state1 = appendAssistantPlaceholder(createInitialConversationState('chat'), 'a1')
        const state2 = appendAssistantChunk(state1, 'a1', 'Long response')
        const state3 = truncateAssistantMessage(state2, 'a1', 4)

        expect(state3.viewMessages[0].content).toBe('Long')
        expect(state3.viewMessages[0].streaming).toBe(false)
        expect(state3.engineHistory).toContainEqual({ role: 'assistant', content: 'Long' })
    })
})
