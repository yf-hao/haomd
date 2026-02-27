import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createChatSession } from './chatSessionService'
import { loadAiSettingsState } from '../settings'
import { loadSystemPromptInfo } from './systemPromptService'
import { createInitialConversationState } from '../domain/chatSession'
import { createStreamingClientFromSettings } from '../streamingClientFactory'
import { appendAssistantChunk } from '../domain/chatSession'

// Mock dependencies
vi.mock('../settings', () => ({
    loadAiSettingsState: vi.fn(),
    emptySettings: { providers: [], defaultProviderId: undefined }
}))

vi.mock('./systemPromptService', () => ({
    loadSystemPromptInfo: vi.fn(),
    getSystemPromptByRoleId: vi.fn((_roles: any, id: string) => ({ activeRoleId: id, systemPrompt: 'mock-prompt' }))
}))

vi.mock('../domain/chatSession', () => ({
    createInitialConversationState: vi.fn(() => ({
        engineHistory: [],
        viewMessages: [],
        activeRoleId: 'default'
    })),
    appendUserInput: vi.fn((state, id, content) => ({
        ...state,
        engineHistory: [...state.engineHistory, { id, role: 'user', content }]
    })),
    appendAssistantPlaceholder: vi.fn((state, id) => ({
        ...state,
        engineHistory: [...state.engineHistory, { id, role: 'assistant', content: '', streaming: true }]
    })),
    completeAssistantMessage: vi.fn((state, id) => ({
        ...state,
        engineHistory: state.engineHistory.map((m: any) => m.id === id ? { ...m, streaming: false } : m)
    })),
    appendAssistantChunk: vi.fn((state) => state),
    truncateAssistantMessage: vi.fn((state) => state)
}))

vi.mock('../streamingClientFactory', () => ({
    createStreamingClientFromSettings: vi.fn(() => ({
        askStream: vi.fn().mockResolvedValue({ content: 'response', tokenCount: 10, completed: true })
    }))
}))

vi.mock('./attachmentUploadService', () => ({
    createAttachmentUploadService: vi.fn(() => ({
        uploadAttachment: vi.fn()
    }))
}))

vi.mock('./docConversationService', () => ({
    docConversationService: {
        upsertFromState: vi.fn().mockResolvedValue(undefined)
    }
}))

vi.mock('../vision/visionClientFactory', () => ({
    createVisionClientFromProvider: vi.fn()
}))

vi.mock('../globalMemory/context', () => ({
    buildGlobalMemorySystemPrompt: vi.fn((prompt) => prompt)
}))

describe('ChatSessionService', () => {
    const mockAiState = {
        providers: [
            {
                id: 'p1',
                name: 'OpenAI',
                baseUrl: 'https://api.openai.com',
                apiKey: 'sk-123',
                models: [{ id: 'gpt-4', maxTokens: 4096 }],
                defaultModelId: 'gpt-4',
                providerType: 'openai'
            }
        ],
        defaultProviderId: 'p1'
    }

    const mockSystemInfo = {
        roles: [{ id: 'default', name: 'Default', prompt: 'test prompt' }],
        activeRoleId: 'default',
        systemPrompt: 'test prompt'
    }

    beforeEach(() => {
        vi.clearAllMocks()
            ; (loadAiSettingsState as any).mockResolvedValue(mockAiState)
            ; (loadSystemPromptInfo as any).mockResolvedValue(mockSystemInfo)
    })

    it('should create a chat session with default settings', async () => {
        const session = await createChatSession({ entryMode: 'chat' })

        expect(session).toBeDefined()
        expect(loadAiSettingsState).toHaveBeenCalled()
        expect(loadSystemPromptInfo).toHaveBeenCalled()
        expect(createInitialConversationState).toHaveBeenCalledWith(
            'chat',
            mockSystemInfo.systemPrompt,
            undefined,
            mockSystemInfo.activeRoleId
        )

        expect(session.getProviderType()).toBe('openai')
        expect(session.getActiveModelId()).toBe('gpt-4')
    })

    it('should handle sendUserMessage correctly', async () => {
        const session = await createChatSession({ entryMode: 'chat' })
        await session.sendUserMessage('Hello AI')

        expect(session.getState().engineHistory).toContainEqual(
            expect.objectContaining({ role: 'user', content: 'Hello AI' })
        )
    })

    it('should change active role', async () => {
        const session = await createChatSession({ entryMode: 'chat' })
        await session.setActiveRole('expert')

        expect(session.getSystemPromptInfo().activeRoleId).toBe('expert')
        // Should recreate client
        expect(createStreamingClientFromSettings).toHaveBeenCalledTimes(2)
    })

    it('should change active model', async () => {
        const session = await createChatSession({ entryMode: 'chat' })

        // Simulate finding a new provider for the new model
        const newAiState = {
            ...mockAiState,
            providers: [
                ...mockAiState.providers,
                {
                    id: 'p2',
                    name: 'Claude',
                    baseUrl: 'https://api.anthropic.com',
                    apiKey: 'sk-456',
                    models: [{ id: 'claude-3', maxTokens: 8192 }],
                    providerType: 'openai' // for simplicity in mock
                }
            ]
        }
            ; (loadAiSettingsState as any).mockResolvedValue(newAiState)

        await session.setActiveModel('claude-3')

        expect(session.getActiveModelId()).toBe('claude-3')
    })

    it('should abort stream on dispose', async () => {
        const session = await createChatSession({ entryMode: 'chat' })
        session.dispose()

        // Internal state should be updated to disposed, although we can't check it directly easily
        // we can check that it doesn't throw or behaves as expected.
        await expect(session.sendUserMessage('test')).resolves.toBeUndefined()
    })

    it('should handle streaming errors', async () => {
        const mockClient = {
            askStream: vi.fn().mockImplementation((_req, handlers) => {
                handlers.onChunk({ content: 'Part 1' })
                return Promise.resolve({ error: new Error('Stream failed') })
            })
        }
        vi.mocked(createStreamingClientFromSettings).mockReturnValue(mockClient as any)

        const session = await createChatSession({ entryMode: 'chat' })
        await session.sendUserMessage('Hello')

        // Should have the error message appended
        expect(vi.mocked(appendAssistantChunk)).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            '当前模型连接失败，请检查 Base URL / 网关配置。'
        )
    })

    it('should throw error if no providers configured', async () => {
        vi.mocked(loadAiSettingsState).mockResolvedValue({ providers: [], defaultProviderId: undefined })
        await expect(createChatSession({ entryMode: 'chat' })).rejects.toThrow('AI Chat 未配置')
    })

    it('should support initialDifyConversationId for Dify provider', async () => {
        const difyAiState = {
            ...mockAiState,
            providers: [{ ...mockAiState.providers[0], providerType: 'dify' }]
        }
        vi.mocked(loadAiSettingsState).mockResolvedValue(difyAiState as any)

        await createChatSession({
            entryMode: 'chat',
            initialDifyConversationId: 'dify-123'
        })

        expect(createStreamingClientFromSettings).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            expect.anything(),
            'dify-123'
        )
    })

    it('should support stopAndTruncate', async () => {
        const session = await createChatSession({ entryMode: 'chat' })
        session.stopAndTruncate('m1', 5)

        const { truncateAssistantMessage } = await import('../domain/chatSession')
        expect(truncateAssistantMessage).toHaveBeenCalledWith(expect.anything(), 'm1', 5)
    })
})

