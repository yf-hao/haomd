import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createConversationCompressor,
  type CompressionConfig,
  defaultCompressionConfig,
  loadCompressionConfig,
  createSimpleSummaryProvider,
  createLLMSummaryProvider,
} from './conversationCompression'
import type { DocConversationRecord, DocConversationMessage } from '../domain/docConversations'
import type {
  AiSettingsState,
  IStreamingChatClient,
  StreamingChatRequest,
  StreamingChatResult,
} from '../domain/types'
import { getAiCompressionSettings } from '../../settings/editorSettings'
import { loadAiSettingsState } from '../settings'
import { createStreamingClientFromSettings } from '../streamingClientFactory'

vi.mock('../../settings/editorSettings', () => ({
  getAiCompressionSettings: vi.fn(),
}))

vi.mock('../settings', () => ({
  loadAiSettingsState: vi.fn(),
}))

vi.mock('../streamingClientFactory', () => ({
  createStreamingClientFromSettings: vi.fn(),
}))

const mockedGetAiCompressionSettings = vi.mocked(getAiCompressionSettings)
const mockedLoadAiSettingsState = vi.mocked(loadAiSettingsState)
const mockedCreateStreamingClientFromSettings = vi.mocked(createStreamingClientFromSettings)

const createMsg = (
  id: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  ts: number,
): DocConversationMessage => ({
  id,
  docPath: 'test.md',
  role,
  content,
  timestamp: ts,
})

const createRecord = (messages: DocConversationMessage[]): DocConversationRecord => ({
  docPath: 'test.md',
  sessionId: 's1',
  lastActiveAt: Date.now(),
  messages,
})

const mockConfig: CompressionConfig = {
  minMessagesToCompress: 5,
  keepRecentRounds: 1,
  maxMessagesAfterCompress: 10,
  maxMessagesPerSummaryBatch: 10,
  maxSummaryCharsPerLevel: () => 1000,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createConversationCompressor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
  })

  it('should not compress if messages are below min threshold', async () => {
    const record = createRecord([
      createMsg('1', 'user', 'hi', 100),
      createMsg('2', 'assistant', 'hello', 200),
    ])

    const provider = { summarizeBatch: vi.fn() }
    const compressor = createConversationCompressor(provider)

    const result = await compressor.compress(record, mockConfig)
    expect(result.messages).toHaveLength(2)
    expect(provider.summarizeBatch).not.toHaveBeenCalled()
  })

  it('should compress old messages and keep recent rounds', async () => {
    const record = createRecord([
      createMsg('1', 'user', 'u1', 100),
      createMsg('2', 'assistant', 'a1', 110),
      createMsg('3', 'user', 'u2', 200),
      createMsg('4', 'assistant', 'a2', 210),
      createMsg('5', 'user', 'u3', 1100),
      createMsg('6', 'assistant', 'a3', 1200),
    ])

    const provider = {
      summarizeBatch: vi.fn().mockResolvedValue('Summary of old messages'),
    }
    const compressor = createConversationCompressor(provider)

    const result = await compressor.compress(record, mockConfig)

    expect(result.messages).toHaveLength(3)
    expect(result.messages[0].role).toBe('system')
    expect(result.messages[0].content).toBe('Summary of old messages')
    expect(result.messages[1].id).toBe('5')
    expect(result.messages[2].id).toBe('6')
  })

  it('should generate second level summary if first level exceeds threshold', async () => {
    const configWithSmallLevel1: CompressionConfig = {
      ...mockConfig,
      maxSummaryCharsPerLevel: (l) => (l === 1 ? 5 : 1000),
    }

    const record = createRecord([
      {
        id: 's1',
        docPath: 'test.md',
        role: 'system',
        content: 'LongS1',
        timestamp: 50,
        meta: {
          summaryLevel: 1,
          coversMessageIds: ['old1'],
          coveredTimeRange: { from: 10, to: 40 },
        },
      },
      createMsg('1', 'user', 'u1', 100),
      createMsg('2', 'assistant', 'a1', 110),
      createMsg('3', 'user', 'u2', 200),
      createMsg('4', 'assistant', 'a2', 210),
      createMsg('5', 'user', 'u3', 1100),
      createMsg('6', 'assistant', 'a3', 1200),
    ])

    const provider = {
      summarizeBatch: vi
        .fn()
        .mockResolvedValueOnce('NewS1')
        .mockResolvedValueOnce('FinalS2'),
    }
    const compressor = createConversationCompressor(provider)

    const result = await compressor.compress(record, configWithSmallLevel1)

    expect(result.messages).toHaveLength(3)
    expect(result.messages[0].meta?.summaryLevel).toBe(2)
    expect(result.messages[0].content).toBe('FinalS2')
  })
})

describe('loadCompressionConfig', () => {
  it('should load config from editor settings when available', async () => {
    mockedGetAiCompressionSettings.mockResolvedValueOnce({
      minMessagesToCompress: 10,
      keepRecentRounds: 3,
      maxMessagesAfterCompress: 100,
      maxMessagesPerSummaryBatch: 50,
    })

    const cfg = await loadCompressionConfig()

    expect(cfg).toMatchObject({
      minMessagesToCompress: 10,
      keepRecentRounds: 3,
      maxMessagesAfterCompress: 100,
      maxMessagesPerSummaryBatch: 50,
    })
    expect(cfg.maxSummaryCharsPerLevel(1)).toBe(defaultCompressionConfig.maxSummaryCharsPerLevel(1))
    expect(cfg.maxSummaryCharsPerLevel(2)).toBe(defaultCompressionConfig.maxSummaryCharsPerLevel(2))
  })

  it('should fallback to defaultCompressionConfig when editor settings load fails', async () => {
    mockedGetAiCompressionSettings.mockRejectedValueOnce(new Error('fail'))

    const cfg = await loadCompressionConfig()

    expect(cfg).toBe(defaultCompressionConfig)
  })
})

describe('createSimpleSummaryProvider', () => {
  it('should produce markdown summary with basic info and snippets', async () => {
    const provider = createSimpleSummaryProvider()
    const messages: DocConversationMessage[] = [
      createMsg('1', 'user', 'hello world', 1_000),
      createMsg('2', 'assistant', 'answer', 2_000),
    ]

    const summary = await provider.summarizeBatch({ docPath: 'doc.md', level: 1, messages })

    expect(summary).toContain('会话摘要（Level 1）')
    expect(summary).toContain('文档：doc.md')
    expect(summary).toContain('覆盖消息数：2')
    expect(summary).toMatch(/User @ /)
    expect(summary).toMatch(/Assistant @ /)
  })
})

describe('createLLMSummaryProvider', () => {
  const messages: DocConversationMessage[] = [
    createMsg('1', 'user', 'x'.repeat(3000), 1_000),
    createMsg('2', 'assistant', 'ok', 2_000),
  ]

  it('should fallback to simple provider when no provider is configured', async () => {
    const emptyState: AiSettingsState = { providers: [], defaultProviderId: undefined }
    mockedLoadAiSettingsState.mockResolvedValueOnce(emptyState)

    const llmProvider = createLLMSummaryProvider()
    const simpleProvider = createSimpleSummaryProvider()

    const [llm, simple] = await Promise.all([
      llmProvider.summarizeBatch({ docPath: 'doc.md', level: 1, messages }),
      simpleProvider.summarizeBatch({ docPath: 'doc.md', level: 1, messages }),
    ])

    expect(llm).toBe(simple)
    expect(mockedCreateStreamingClientFromSettings).not.toHaveBeenCalled()
  })

  it('should fallback when provider has no modelId', async () => {
    const state: AiSettingsState = {
      providers: [
        {
          id: 'p1',
          name: 'P1',
          baseUrl: 'https://api',
          apiKey: 'sk',
          models: [],
          defaultModelId: undefined,
        },
      ],
      defaultProviderId: 'p1',
    }
    mockedLoadAiSettingsState.mockResolvedValueOnce(state)

    const llmProvider = createLLMSummaryProvider()
    const simpleProvider = createSimpleSummaryProvider()

    const [llm, simple] = await Promise.all([
      llmProvider.summarizeBatch({ docPath: 'doc.md', level: 1, messages }),
      simpleProvider.summarizeBatch({ docPath: 'doc.md', level: 1, messages }),
    ])

    expect(llm).toBe(simple)
    expect(mockedCreateStreamingClientFromSettings).not.toHaveBeenCalled()
  })

  it('should call streaming client with built messages and return streamed content', async () => {
    const state: AiSettingsState = {
      providers: [
        {
          id: 'p1',
          name: 'P1',
          baseUrl: 'https://api',
          apiKey: 'sk',
          models: [{ id: 'm1' }],
          defaultModelId: 'm1',
        },
      ],
      defaultProviderId: 'p1',
    }
    mockedLoadAiSettingsState.mockResolvedValueOnce(state)

    const askStream = vi.fn(
      async (
        _req: StreamingChatRequest,
        handlers: {
          onChunk?: (chunk: { content?: string }) => void
          onComplete?: (content: string, tokenCount: number) => void
        },
      ): Promise<StreamingChatResult> => {
        handlers.onChunk?.({ content: 'Hello ' })
        handlers.onChunk?.({ content: 'World' })
        handlers.onComplete?.('ignored', 42)
        return {
          content: '',
          tokenCount: 42,
          completed: true,
        }
      },
    )

    const client: IStreamingChatClient = {
      askStream,
    }

    mockedCreateStreamingClientFromSettings.mockReturnValue(client)

    const llmProvider = createLLMSummaryProvider()
    const summary = await llmProvider.summarizeBatch({ docPath: 'doc.md', level: 1, messages })

    expect(mockedCreateStreamingClientFromSettings).toHaveBeenCalledTimes(1)
    const [, systemPrompt, modelId] = mockedCreateStreamingClientFromSettings.mock.calls[0]
    expect(systemPrompt).toContain('会话压缩助手')
    expect(modelId).toBe('m1')

    expect(askStream).toHaveBeenCalledTimes(1)
    const [req] = askStream.mock.calls[0]
    expect(req.messages).toHaveLength(1)
    const content = req.messages[0].content
    expect(content).toContain('文档路径：doc.md')
    expect(content.length).toBeLessThan(6000) // 截断后长度不会无限增长

    expect(summary).toBe('Hello World')
  })

  it('should fallback when LLM returns empty content', async () => {
    const state: AiSettingsState = {
      providers: [
        {
          id: 'p1',
          name: 'P1',
          baseUrl: 'https://api',
          apiKey: 'sk',
          models: [{ id: 'm1' }],
          defaultModelId: 'm1',
        },
      ],
      defaultProviderId: 'p1',
    }
    mockedLoadAiSettingsState.mockResolvedValueOnce(state)

    const askStream = vi.fn(async (): Promise<StreamingChatResult> => ({
      content: '',
      tokenCount: 0,
      completed: true,
    }))

    const client: IStreamingChatClient = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      askStream: askStream as any,
    }

    mockedCreateStreamingClientFromSettings.mockReturnValue(client)

    const llmProvider = createLLMSummaryProvider()
    const simpleProvider = createSimpleSummaryProvider()

    const [llm, simple] = await Promise.all([
      llmProvider.summarizeBatch({ docPath: 'doc.md', level: 1, messages }),
      simpleProvider.summarizeBatch({ docPath: 'doc.md', level: 1, messages }),
    ])

    expect(llm).toBe(simple)
  })

  it('should fallback when streaming client throws', async () => {
    const state: AiSettingsState = {
      providers: [
        {
          id: 'p1',
          name: 'P1',
          baseUrl: 'https://api',
          apiKey: 'sk',
          models: [{ id: 'm1' }],
          defaultModelId: 'm1',
        },
      ],
      defaultProviderId: 'p1',
    }
    mockedLoadAiSettingsState.mockResolvedValueOnce(state)

    const askStream = vi.fn(async () => {
      throw new Error('network')
    })

    const client: IStreamingChatClient = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      askStream: askStream as any,
    }

    mockedCreateStreamingClientFromSettings.mockReturnValue(client)

    const llmProvider = createLLMSummaryProvider()
    const simpleProvider = createSimpleSummaryProvider()

    const [llm, simple] = await Promise.all([
      llmProvider.summarizeBatch({ docPath: 'doc.md', level: 2, messages }),
      simpleProvider.summarizeBatch({ docPath: 'doc.md', level: 2, messages }),
    ])

    expect(llm).toBe(simple)
  })
})
