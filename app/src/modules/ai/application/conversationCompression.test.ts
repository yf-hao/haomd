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
  maxPreservedUserMessages: 2,
  maxMessagesAfterCompress: 10,
  maxMessagesPerSummaryBatch: 10,
  maxInputCharsPerSummaryBatch: 1000,
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

    // #3: preservedUserMessages 不再作为完整消息存入，仅通过 meta.preservedUserInputs 保留
    expect(result.messages).toHaveLength(3) // 1 summary + 2 recent
    const summary = result.messages.find((message) => message.role === 'system')
    expect(summary?.content).toBe('Summary of old messages')
    expect(summary?.meta?.preservedUserInputs).toEqual(['u1', 'u2'])
    expect(result.messages.map((message) => message.id)).toEqual([
      summary!.id,
      '5',
      '6',
    ])
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

    // #3: no preserved user messages as full objects, #2: L2 merges all L1s
    expect(result.messages).toHaveLength(3) // 1 L2 summary + 2 recent
    const level2Summary = result.messages.find((message) => (message.meta?.summaryLevel ?? 0) === 2)
    expect(level2Summary?.content).toBe('FinalS2')
    expect(level2Summary?.meta?.preservedUserInputs).toEqual(['u1', 'u2'])
    expect(result.messages.map((message) => message.id)).toEqual([
      level2Summary!.id,
      '5',
      '6',
    ])
  })

  it('should perform incremental compression — skip already covered messages', async () => {
    // Simulate: first compress already produced a L1 summary covering msg 1,2,3,4
    const record = createRecord([
      {
        id: 'prev_summary',
        docPath: 'test.md',
        role: 'system',
        content: 'Previous summary',
        timestamp: 500,
        meta: {
          summaryLevel: 1,
          coversMessageIds: ['1', '2', '3', '4'],
          coveredTimeRange: { from: 100, to: 210 },
          preservedUserInputs: ['u1', 'u2'],
        },
      },
      createMsg('7', 'user', 'u4', 600),
      createMsg('8', 'assistant', 'a4', 610),
      createMsg('9', 'user', 'u5', 700),
      createMsg('10', 'assistant', 'a5', 710),
      createMsg('11', 'user', 'u6', 1100),
      createMsg('12', 'assistant', 'a6', 1200),
    ])

    const provider = {
      summarizeBatch: vi.fn().mockResolvedValue('Incremental summary'),
    }
    const compressor = createConversationCompressor(provider)

    const result = await compressor.compress(record, mockConfig)

    // Should call summarizeBatch only once (for uncovered old messages 7,8,9,10)
    expect(provider.summarizeBatch).toHaveBeenCalledTimes(1)
    const callMessages = provider.summarizeBatch.mock.calls[0][0].messages
    expect(callMessages.map((m: DocConversationMessage) => m.id)).toEqual(['7', '8', '9', '10'])

    // Result: prev_summary + new_summary + recent(11,12)
    expect(result.messages).toHaveLength(4) // 2 summaries + 2 recent
    const summaries = result.messages.filter((m) => (m.meta?.summaryLevel ?? 0) >= 1)
    expect(summaries).toHaveLength(2)
    expect(summaries[0].id).toBe('prev_summary')
    expect(summaries[1].content).toBe('Incremental summary')
  })

  it('should skip compression when all old messages are already covered', async () => {
    const record = createRecord([
      {
        id: 'prev_summary',
        docPath: 'test.md',
        role: 'system',
        content: 'Previous summary',
        timestamp: 500,
        meta: {
          summaryLevel: 1,
          coversMessageIds: ['1', '2'],
          coveredTimeRange: { from: 100, to: 200 },
        },
      },
      createMsg('1', 'user', 'u1', 100),
      createMsg('2', 'assistant', 'a1', 200),
      createMsg('3', 'user', 'u2', 1100),
      createMsg('4', 'assistant', 'a2', 1200),
    ])

    const provider = { summarizeBatch: vi.fn() }
    const compressor = createConversationCompressor(provider)

    const result = await compressor.compress(record, mockConfig)

    // No LLM call needed
    expect(provider.summarizeBatch).not.toHaveBeenCalled()
    // Result: prev_summary + recent(3,4)
    expect(result.messages).toHaveLength(3)
  })

  it('should report batch and level2 progress while compressing', async () => {
    const configWithLevel2: CompressionConfig = {
      ...mockConfig,
      maxMessagesPerSummaryBatch: 10,
      maxInputCharsPerSummaryBatch: 1_600,
      maxSummaryCharsPerLevel: (level) => (level === 1 ? 5 : 1000),
    }
    const record = createRecord([
      createMsg('1', 'user', 'u'.repeat(700), 100),
      createMsg('2', 'assistant', 'a'.repeat(700), 110),
      createMsg('3', 'user', 'u'.repeat(700), 200),
      createMsg('4', 'assistant', 'a'.repeat(700), 210),
      createMsg('5', 'user', 'u'.repeat(700), 300),
      createMsg('6', 'assistant', 'a'.repeat(700), 310),
      createMsg('7', 'user', 'recent', 1100),
      createMsg('8', 'assistant', 'recent reply', 1200),
    ])
    const provider = {
      summarizeBatch: vi
        .fn()
        .mockResolvedValueOnce('S1')
        .mockResolvedValueOnce('S2')
        .mockResolvedValueOnce('S3')
        .mockResolvedValueOnce('L2 summary'),
    }
    const compressor = createConversationCompressor(provider)
    const onProgress = vi.fn()

    await compressor.compress(record, configWithLevel2, { onProgress })

    expect(onProgress.mock.calls.map(([event]) => event)).toEqual([
      { phase: 'summarizing-batch', level: 1, currentBatch: 1, totalBatches: 3 },
      { phase: 'summarizing-batch', level: 1, currentBatch: 2, totalBatches: 3 },
      { phase: 'summarizing-batch', level: 1, currentBatch: 3, totalBatches: 3 },
      { phase: 'summarizing-level2', level: 2, totalBatches: 3 },
    ])
  })

  it('should split uncovered old messages into multiple batches when input chars exceed budget', async () => {
    const record = createRecord([
      createMsg('1', 'user', 'u'.repeat(700), 100),
      createMsg('2', 'assistant', 'a'.repeat(700), 110),
      createMsg('3', 'user', 'u'.repeat(700), 200),
      createMsg('4', 'assistant', 'a'.repeat(700), 210),
      createMsg('5', 'user', 'recent user', 1100),
      createMsg('6', 'assistant', 'recent assistant', 1200),
    ])

    const provider = {
      summarizeBatch: vi
        .fn()
        .mockResolvedValueOnce('Summary batch 1')
        .mockResolvedValueOnce('Summary batch 2'),
    }
    const compressor = createConversationCompressor(provider)

    const result = await compressor.compress(record, {
      ...mockConfig,
      maxMessagesPerSummaryBatch: 20,
      maxInputCharsPerSummaryBatch: 1600,
    })

    expect(provider.summarizeBatch).toHaveBeenCalledTimes(2)
    expect(provider.summarizeBatch.mock.calls[0]?.[0].messages.map((m: DocConversationMessage) => m.id)).toEqual([
      '1',
    ])
    expect(provider.summarizeBatch.mock.calls[1]?.[0].messages.map((m: DocConversationMessage) => m.id)).toEqual([
      '3',
    ])

    const summaries = result.messages.filter((message) => (message.meta?.summaryLevel ?? 0) === 1)
    expect(summaries).toHaveLength(2)
    expect(result.messages.slice(-2).map((message) => message.id)).toEqual(['5', '6'])
  })

  it('should include previous assistant context for level1 when user references it', async () => {
    const record = createRecord([
      createMsg('1', 'assistant', '方案一：全部使用 accelerator。\n方案二：macOS 用 accelerator，Windows 用前端兜底。', 100),
      createMsg('2', 'user', '按第二个方案实现', 110),
      createMsg('3', 'user', 'recent user', 1100),
      createMsg('4', 'assistant', 'recent assistant', 1200),
    ])

    const provider = {
      summarizeBatch: vi.fn().mockResolvedValueOnce('Summary with referenced context'),
    }
    const compressor = createConversationCompressor(provider)

    await compressor.compress(record, {
      ...mockConfig,
      keepRecentRounds: 1,
    })

    expect(provider.summarizeBatch).toHaveBeenCalledTimes(1)
    expect(provider.summarizeBatch.mock.calls[0]?.[0].messages.map((m: DocConversationMessage) => m.id)).toEqual([
      '1',
      '2',
    ])
  })
})

describe('loadCompressionConfig', () => {
  it('should load config from editor settings when available', async () => {
    mockedGetAiCompressionSettings.mockResolvedValueOnce({
      minMessagesToCompress: 10,
      keepRecentRounds: 3,
      maxMessagesAfterCompress: 100,
      maxMessagesPerSummaryBatch: 50,
      maxInputCharsPerSummaryBatch: 9000,
    })

    const cfg = await loadCompressionConfig()

    expect(cfg).toMatchObject({
      minMessagesToCompress: 10,
      keepRecentRounds: 3,
      maxPreservedUserMessages: 50,
      maxMessagesAfterCompress: 100,
      maxMessagesPerSummaryBatch: 50,
      maxInputCharsPerSummaryBatch: 9000,
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
    expect(summary).toContain('用户输入分类整理')
    expect(summary).toContain('hello world')
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
    expect(systemPrompt).toContain('用户输入分类整理')
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

  it('should not abort long-running summary requests at compression layer', async () => {
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

    const streamControls: { resolve?: (value: StreamingChatResult) => void } = {}
    const askStream = vi.fn(
      (_request: StreamingChatRequest) =>
        new Promise<StreamingChatResult>((resolve) => {
          streamControls.resolve = resolve
        }),
    )

    const client: IStreamingChatClient = { askStream }
    mockedCreateStreamingClientFromSettings.mockReturnValue(client)

    const llmProvider = createLLMSummaryProvider()
    const pending = llmProvider.summarizeBatch({ docPath: 'doc.md', level: 1, messages })

    await vi.waitFor(() => expect(askStream).toHaveBeenCalled())
    expect(askStream.mock.calls[0][0]).not.toHaveProperty('signal')

    streamControls.resolve?.({
      content: 'late summary',
      tokenCount: 2,
      completed: true,
    })

    await expect(pending).resolves.toBe('late summary')
  })
})
