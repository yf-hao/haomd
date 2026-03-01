import { describe, it, expect, vi, beforeEach } from 'vitest'

// 用工厂 mock SimpleChat，拦截 init / setConversationId / askStream / getConversationId
const initMock = vi.fn()
const setConversationIdMock = vi.fn()
const askStreamMock = vi.fn()
const getConversationIdMock = vi.fn(() => 'conv-xyz')

vi.mock('./SimpleChat', () => ({
  SimpleChat: class {
    init = initMock
    setConversationId = setConversationIdMock
    askStream = askStreamMock
    getConversationId = getConversationIdMock
  },
  MessageRole: {
    User: 'user',
    Assistant: 'assistant',
  },
}))

import { createDifyStreamingClient } from './createDifyStreamingClient'

describe('createDifyStreamingClient', () => {
  beforeEach(() => {
    initMock.mockReset()
    setConversationIdMock.mockReset()
    askStreamMock.mockReset()
    getConversationIdMock.mockReset()
    getConversationIdMock.mockReturnValue('conv-xyz')
  })

  it('should init SimpleChat with mapped config and no initial conversation id', () => {
    const client = createDifyStreamingClient({
      apiKey: 'k',
      baseUrl: 'https://api.dify/',
      modelId: 'model-1',
      systemPrompt: 'sys',
      temperature: 0.5,
      maxTokens: 2048,
    })

    expect(client).toBeDefined()
    expect(initMock).toHaveBeenCalledWith({
      apiKey: 'k',
      baseURL: 'https://api.dify/',
      model: 'model-1',
      systemPrompt: 'sys',
      temperature: 0.5,
      maxTokens: 2048,
    })
    expect(setConversationIdMock).not.toHaveBeenCalled()
  })

  it('should set initialConversationId when provided', () => {
    createDifyStreamingClient({
      apiKey: 'k',
      baseUrl: 'https://api.dify/',
      modelId: 'model-1',
      initialConversationId: 'conv-123',
    })

    expect(setConversationIdMock).toHaveBeenCalledWith('conv-123')
  })

  it('askStream should delegate to SimpleChat and map result', async () => {
    askStreamMock.mockResolvedValue({
      content: 'hello',
      tokenCount: 10,
      completed: true,
      error: undefined,
    })
    getConversationIdMock.mockReturnValue('conv-999')

    const client = createDifyStreamingClient({
      apiKey: 'k',
      baseUrl: 'https://api.dify/',
      modelId: 'model-1',
    })

    const handlers = {
      onChunk: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    }

    const result = await client.askStream(
      {
        messages: [
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello' },
        ] as any,
        temperature: 0.9,
        maxTokens: 123,
        signal: new AbortController().signal,
        attachments: [],
      } as any,
      handlers,
    )

    expect(askStreamMock).toHaveBeenCalledTimes(1)
    const [req, streamCfg] = askStreamMock.mock.calls[0]

    expect(req.messages).toEqual([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
    ])
    expect(req.temperature).toBe(0.9)
    expect(req.maxTokens).toBe(123)
    expect(req.attachments).toEqual([])

    expect(streamCfg).toEqual({
      enabled: true,
      onChunk: handlers.onChunk,
      onComplete: handlers.onComplete,
      onError: handlers.onError,
    })

    expect(result).toEqual({
      content: 'hello',
      tokenCount: 10,
      completed: true,
      conversationId: 'conv-999',
      error: undefined,
    })
  })
})
