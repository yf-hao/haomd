import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
    inferTaskType,
    inferScenarioTags,
    buildCurrentContext,
    buildGlobalMemorySystemPrompt
} from './context'
import { loadGlobalMemoryItems } from './repo'
import { loadGlobalMemorySettings } from './settingsRepo'

vi.mock('./repo', () => ({
    loadGlobalMemoryItems: vi.fn(),
}))

vi.mock('./settingsRepo', () => ({
    loadGlobalMemorySettings: vi.fn(),
    emptyGlobalMemorySettings: { enabled: true }
}))

describe('globalMemory context', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(loadGlobalMemorySettings).mockReturnValue({ enabled: true } as any)
    })

    describe('inferTaskType', () => {
        it('should infer file task type', () => {
            expect(inferTaskType({ source: 'chat-pane', entryMode: 'file', userInput: '' })).toBe('file')
            expect(inferTaskType({ source: 'command', sourceCommand: 'ai_ask_file', userInput: '' })).toBe('file')
        })

        it('should infer code task type from keywords', () => {
            expect(inferTaskType({ source: 'chat-pane', userInput: 'fix this bug in typescript' })).toBe('code')
        })

        it('should default to chat', () => {
            expect(inferTaskType({ source: 'chat-pane', userInput: 'hello' })).toBe('chat')
        })
    })

    describe('inferScenarioTags', () => {
        it('should return correct tags for task types', () => {
            expect(inferScenarioTags('file')).toEqual(['file', 'summarize'])
            expect(inferScenarioTags('code')).toEqual(['code'])
            expect(inferScenarioTags('chat')).toEqual(['language', 'style'])
        })
    })

    describe('buildCurrentContext', () => {
        it('should detect language', () => {
            expect(buildCurrentContext({ source: 'chat-pane', userInput: '你好' }).language).toBe('zh-CN')
            expect(buildCurrentContext({ source: 'chat-pane', userInput: 'Hello' }).language).toBe('en')
        })
    })

    describe('buildGlobalMemorySystemPrompt', () => {
        it('should inject memory items into system prompt', () => {
            const mockMemories = [
                { id: '1', content: 'Preference 1', tags: ['code'], weight: 1, createdAt: Date.now() },
                { id: '2', content: 'Preference 2', tags: ['language'], weight: 1, createdAt: Date.now() }
            ]
            vi.mocked(loadGlobalMemoryItems).mockReturnValue(mockMemories as any)

            const prompt = buildGlobalMemorySystemPrompt('Base prompt', {
                source: 'chat-pane',
                userInput: 'code task'
            })

            expect(prompt).toContain('Base prompt')
            expect(prompt).toContain('User preferences (from global memory):')
            expect(prompt).toContain('- Preference 1')
            expect(prompt).toContain('- Preference 2')
        })

        it('should return base prompt if memory is disabled', () => {
            vi.mocked(loadGlobalMemorySettings).mockReturnValue({ enabled: false } as any)
            const prompt = buildGlobalMemorySystemPrompt('Base prompt', {
                source: 'chat-pane',
                userInput: 'test'
            })
            expect(prompt).toBe('Base prompt')
        })
    })
})
