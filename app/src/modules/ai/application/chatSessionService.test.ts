import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createChatSession } from './chatSessionService'
import { loadAiSettingsState } from '../settings'
import { loadSystemPromptInfo } from './systemPromptService'
import { createInitialConversationState } from '../domain/chatSession'
import { createStreamingClientFromSettings } from '../streamingClientFactory'
import { appendAssistantChunk } from '../domain/chatSession'
import { loadAgentSettingsState } from '../config/agentSettingsRepo'
import {
    executeCreateDirectoryUnderSelection,
    executeDeleteCurrentDocument,
    executeDeleteCurrentFolder,
    executeRenameCurrentDocument,
    executeSaveOrExportCurrentDocument,
} from '../../document/documentBuiltinTool'

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
    upsertAssistantToolExecution: vi.fn((state) => state),
    appendAssistantChunk: vi.fn((state) => state),
    truncateAssistantMessage: vi.fn((state) => state)
}))

vi.mock('../streamingClientFactory', () => ({
    createStreamingClientFromSettings: vi.fn(() => ({
        askStream: vi.fn().mockResolvedValue({ content: 'response', tokenCount: 10, completed: true })
    }))
}))

vi.mock('../config/agentSettingsRepo', () => ({
    loadAgentSettingsState: vi.fn(),
}))

vi.mock('../../skills/storage/skillsRepo', () => ({
    listSkills: vi.fn().mockResolvedValue([]),
    readSkill: vi.fn().mockResolvedValue(null),
}))

vi.mock('../../workflows/storage/workflowsRepo', () => ({
    listWorkflows: vi.fn().mockResolvedValue([]),
    readWorkflow: vi.fn().mockResolvedValue(null),
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

vi.mock('../../document/documentBuiltinTool', () => ({
    SAVE_OR_EXPORT_CURRENT_DOCUMENT_TOOL_NAME: 'save_or_export_current_document',
    DELETE_CURRENT_DOCUMENT_TOOL_NAME: 'delete_current_document',
    DELETE_CURRENT_FOLDER_TOOL_NAME: 'delete_current_folder',
    DELETE_WORKSPACE_ENTRY_TOOL_NAME: 'delete_workspace_entry',
    RENAME_CURRENT_DOCUMENT_TOOL_NAME: 'rename_current_document',
    RENAME_WORKSPACE_ENTRY_TOOL_NAME: 'rename_workspace_entry',
    CREATE_DIRECTORY_UNDER_SELECTION_TOOL_NAME: 'create_directory_under_selection',
    CREATE_DIRECTORY_IN_WORKSPACE_TOOL_NAME: 'create_directory_in_workspace',
    saveOrExportCurrentDocumentToolSchema: {
        type: 'function',
        function: { name: 'save_or_export_current_document', parameters: { type: 'object', properties: {}, required: [] } }
    },
    deleteCurrentDocumentToolSchema: {
        type: 'function',
        function: { name: 'delete_current_document', parameters: { type: 'object', properties: {}, required: [] } }
    },
    deleteCurrentFolderToolSchema: {
        type: 'function',
        function: { name: 'delete_current_folder', parameters: { type: 'object', properties: {}, required: [] } }
    },
    deleteWorkspaceEntryToolSchema: {
        type: 'function',
        function: { name: 'delete_workspace_entry', parameters: { type: 'object', properties: {}, required: [] } }
    },
    renameCurrentDocumentToolSchema: {
        type: 'function',
        function: { name: 'rename_current_document', parameters: { type: 'object', properties: {}, required: [] } }
    },
    renameWorkspaceEntryToolSchema: {
        type: 'function',
        function: { name: 'rename_workspace_entry', parameters: { type: 'object', properties: {}, required: [] } }
    },
    createDirectoryUnderSelectionToolSchema: {
        type: 'function',
        function: { name: 'create_directory_under_selection', parameters: { type: 'object', properties: {}, required: [] } }
    },
    createDirectoryInWorkspaceToolSchema: {
        type: 'function',
        function: { name: 'create_directory_in_workspace', parameters: { type: 'object', properties: {}, required: [] } }
    },
    executeSaveOrExportCurrentDocument: vi.fn(),
    executeDeleteCurrentDocument: vi.fn(),
    executeDeleteCurrentFolder: vi.fn(),
    executeDeleteWorkspaceEntry: vi.fn(),
    executeRenameCurrentDocument: vi.fn(),
    executeRenameWorkspaceEntry: vi.fn(),
    executeCreateDirectoryUnderSelection: vi.fn(),
    executeCreateDirectoryInWorkspace: vi.fn(),
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
            ; (loadAgentSettingsState as any).mockResolvedValue({ providers: [], defaultProviderId: undefined })
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

    it('should execute save_or_export_current_document built-in tool with document context', async () => {
        const askStream = vi.fn()
            .mockResolvedValueOnce({
                toolCalls: [
                    {
                        id: 'tool-1',
                        type: 'function',
                        function: {
                            name: 'save_or_export_current_document',
                            arguments: JSON.stringify({
                                format: 'word',
                                target: 'current_file_dir',
                            }),
                        },
                    },
                ],
            })
            .mockResolvedValueOnce({ content: 'done', completed: true })

        vi.mocked(createStreamingClientFromSettings).mockReturnValue({
            askStream,
        } as any)
        vi.mocked(executeSaveOrExportCurrentDocument).mockResolvedValue('✅ 已保存：/root/doc.docx')

        const session = await createChatSession({
            entryMode: 'chat',
            getCurrentMarkdown: () => '# Doc',
            getCurrentFileName: () => 'doc.md',
            getCurrentFilePath: () => '/root/doc.md',
        })

        await session.sendUserMessage('保存为word')

        expect(executeSaveOrExportCurrentDocument).toHaveBeenCalledWith(
            { format: 'word', target: 'current_file_dir' },
            expect.objectContaining({
                getCurrentMarkdown: expect.any(Function),
                getCurrentFileName: expect.any(Function),
                getCurrentFilePath: expect.any(Function),
            }),
        )
    })

    it('should stop openai tool loop before starting the next round', async () => {
        const askStream = vi.fn()
            .mockResolvedValueOnce({
                toolCalls: [
                    {
                        id: 'tool-1',
                        type: 'function',
                        function: {
                            name: 'save_or_export_current_document',
                            arguments: JSON.stringify({
                                format: 'word',
                                target: 'current_file_dir',
                            }),
                        },
                    },
                ],
            })
            .mockResolvedValueOnce({ content: 'should-not-run', completed: true })

        vi.mocked(createStreamingClientFromSettings).mockReturnValue({
            askStream,
        } as any)
        let finishToolExecution: (() => void) | null = null
        vi.mocked(executeSaveOrExportCurrentDocument).mockImplementation(
            () =>
                new Promise((resolve) => {
                    finishToolExecution = () => resolve('✅ 已保存：/root/doc.docx')
                }),
        )

        const session = await createChatSession({
            entryMode: 'chat',
            getCurrentMarkdown: () => '# Doc',
            getCurrentFileName: () => 'doc.md',
            getCurrentFilePath: () => '/root/doc.md',
        })

        const sendPromise = session.sendUserMessage('保存为word')
        await vi.waitFor(() => {
            expect(executeSaveOrExportCurrentDocument).toHaveBeenCalledTimes(1)
        })
        const completeTool = finishToolExecution as (() => void) | null
        if (typeof completeTool !== 'function') {
            throw new Error('tool execution did not start')
        }
        session.stopRunningStream()
        completeTool()
        await sendPromise

        expect(executeSaveOrExportCurrentDocument).toHaveBeenCalledTimes(1)
        expect(askStream).toHaveBeenCalledTimes(1)
    })

    it('should execute delete_current_document built-in tool with file context', async () => {
        const askStream = vi.fn()
            .mockResolvedValueOnce({
                toolCalls: [
                    {
                        id: 'tool-1',
                        type: 'function',
                        function: {
                            name: 'delete_current_document',
                            arguments: JSON.stringify({}),
                        },
                    },
                ],
            })
            .mockResolvedValueOnce({ content: 'done', completed: true })

        vi.mocked(createStreamingClientFromSettings).mockReturnValue({
            askStream,
        } as any)
        vi.mocked(executeDeleteCurrentDocument).mockResolvedValue('✅ 已删除：/root/doc.md')

        const onRequestDeleteCurrentDocument = vi.fn().mockResolvedValue({
            ok: true,
            message: '已删除：/root/doc.md',
        })

        const session = await createChatSession({
            entryMode: 'chat',
            getCurrentFilePath: () => '/root/doc.md',
            onRequestDeleteCurrentDocument,
        })

        await session.sendUserMessage('删除当前文档')

        expect(executeDeleteCurrentDocument).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                getCurrentFilePath: expect.any(Function),
                onRequestDeleteCurrentDocument,
            }),
        )
    })

    it('should execute rename_current_document built-in tool with file context', async () => {
        const askStream = vi.fn()
            .mockResolvedValueOnce({
                toolCalls: [
                    {
                        id: 'tool-1',
                        type: 'function',
                        function: {
                            name: 'rename_current_document',
                            arguments: JSON.stringify({ fileName: 'demo' }),
                        },
                    },
                ],
            })
            .mockResolvedValueOnce({ content: 'done', completed: true })

        vi.mocked(createStreamingClientFromSettings).mockReturnValue({
            askStream,
        } as any)
        vi.mocked(executeRenameCurrentDocument).mockResolvedValue('✅ 已将当前文档重命名为 demo.md')

        const onRenameCurrentDocument = vi.fn().mockResolvedValue({
            ok: true,
            message: '已将当前文档重命名为 demo.md',
        })

        const session = await createChatSession({
            entryMode: 'chat',
            getCurrentFilePath: () => '/root/doc.md',
            onRenameCurrentDocument,
        })

        await session.sendUserMessage('重命名为 demo')

        expect(executeRenameCurrentDocument).toHaveBeenCalledWith(
            { fileName: 'demo' },
            expect.objectContaining({
                getCurrentFilePath: expect.any(Function),
                onRenameCurrentDocument,
            }),
        )
    })

    it('should execute delete_current_folder built-in tool with folder context', async () => {
        const askStream = vi.fn()
            .mockResolvedValueOnce({
                toolCalls: [
                    {
                        id: 'tool-1',
                        type: 'function',
                        function: {
                            name: 'delete_current_folder',
                            arguments: JSON.stringify({}),
                        },
                    },
                ],
            })
            .mockResolvedValueOnce({ content: 'done', completed: true })

        vi.mocked(createStreamingClientFromSettings).mockReturnValue({
            askStream,
        } as any)
        vi.mocked(executeDeleteCurrentFolder).mockResolvedValue('✅ 已删除：/root/notes')

        const onRequestDeleteCurrentFolder = vi.fn().mockResolvedValue({
            ok: true,
            message: '已删除：/root/notes',
        })

        const session = await createChatSession({
            entryMode: 'chat',
            getCurrentFolderPath: () => '/root/notes',
            onRequestDeleteCurrentFolder,
        })

        await session.sendUserMessage('删除文件夹')

        expect(executeDeleteCurrentFolder).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                getCurrentFolderPath: expect.any(Function),
                onRequestDeleteCurrentFolder,
            }),
        )
    })

    it('should execute create_directory_under_selection built-in tool with selection callback', async () => {
        const askStream = vi.fn()
            .mockResolvedValueOnce({
                toolCalls: [
                    {
                        id: 'tool-1',
                        type: 'function',
                        function: {
                            name: 'create_directory_under_selection',
                            arguments: JSON.stringify({ directoryName: 'demo' }),
                        },
                    },
                ],
            })
            .mockResolvedValueOnce({ content: 'done', completed: true })

        vi.mocked(createStreamingClientFromSettings).mockReturnValue({
            askStream,
        } as any)
        vi.mocked(executeCreateDirectoryUnderSelection).mockResolvedValue('✅ 已创建目录：demo')

        const onCreateDirectoryUnderSelection = vi.fn().mockResolvedValue({
            ok: true,
            message: '已创建目录：demo',
        })

        const session = await createChatSession({
            entryMode: 'chat',
            onCreateDirectoryUnderSelection,
        })

        await session.sendUserMessage('创建 demo 目录')

        expect(executeCreateDirectoryUnderSelection).toHaveBeenCalledWith(
            { directoryName: 'demo' },
            expect.objectContaining({
                onCreateDirectoryUnderSelection,
            }),
        )
    })
})
