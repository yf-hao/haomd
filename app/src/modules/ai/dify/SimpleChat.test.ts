import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SimpleChat, MessageRole } from './SimpleChat'
import { BrowserLogger } from './BrowserLogger'

const createConfig = () => ({
  apiKey: 'sk-test',
  baseURL: 'https://api.dify.test/',
  model: 'gpt-dify',
  systemPrompt: 'you are dify',
})

const createMessages = (lastContent: string) => [
  { role: MessageRole.User, content: 'hello' },
  { role: MessageRole.User, content: lastContent },
]

describe('SimpleChat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('init should store config and reset conversation id', () => {
    const infoSpy = vi.spyOn(BrowserLogger.prototype, 'info')
    const chat = new SimpleChat()
    chat.init(createConfig())

    expect(chat.getConfig()).toEqual(createConfig())
    expect(chat.getConversationId()).toBeNull()
    expect(infoSpy).toHaveBeenCalledWith('Initializing chat', {
      model: 'gpt-dify',
      baseURL: 'https://api.dify.test/',
    })
  })

  it('getConversationId / setConversationId / clearHistory should work together', () => {
    const infoSpy = vi.spyOn(BrowserLogger.prototype, 'info')
    const chat = new SimpleChat()
    chat.init(createConfig())

    chat.setConversationId('conv-1')
    expect(chat.getConversationId()).toBe('conv-1')

    chat.clearHistory()
    expect(chat.getConversationId()).toBeNull()
    expect(infoSpy).toHaveBeenCalledWith('History cleared')
  })

  it('askStream should return error result when last message is not from user', async () => {
    const errorSpy = vi.spyOn(BrowserLogger.prototype, 'error')
    const chat = new SimpleChat()
    chat.init(createConfig())

    const messages = [
      { role: MessageRole.User, content: 'hello' },
      { role: MessageRole.Assistant, content: 'not allowed' },
    ]

    const onError = vi.fn()
    const result = await chat.askStream(
      { messages } as any,
      { enabled: true, onError } as any,
    )

    expect(result.completed).toBe(false)
    expect(result.error).toBeInstanceOf(Error)
    expect(onError).toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith('Stream request failed', expect.any(Object))
  })

  it('askStream should stream chunks and complete successfully', async () => {
    const chat = new SimpleChat()
    chat.init(createConfig())

    const ssePayload = [
      // text chunk 1
      'data: ' + JSON.stringify({ event: 'text_chunk', data: { text: 'Hello ' } }),
      // text chunk 2
      'data: ' + JSON.stringify({ event: 'text_chunk', data: { text: 'World' } }),
      // end
      'data: ' + JSON.stringify({ event: 'message_end' }),
    ].join('\n') + '\n'

    const encoder = new TextEncoder()
    const chunks = [encoder.encode(ssePayload)]

    const reader = {
      read: vi.fn().mockImplementation(() => {
        if (chunks.length === 0) {
          return Promise.resolve({ done: true, value: undefined })
        }
        return Promise.resolve({ done: false, value: chunks.shift() })
      }),
    }

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      body: { getReader: () => reader },
      text: () => Promise.resolve(''),
    } as any)

    const onChunk = vi.fn()
    const onComplete = vi.fn()

    const result = await chat.askStream(
      { messages: createMessages('Hello World') } as any,
      { enabled: true, onChunk, onComplete } as any,
    )

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.dify.test/chat-messages',
      expect.objectContaining({ method: 'POST' }),
    )

    expect(onChunk).toHaveBeenCalledTimes(2)
    expect(onComplete).toHaveBeenCalledWith('Hello World', 'Hello World'.length)

    expect(result).toEqual({
      content: 'Hello World',
      tokenCount: 'Hello World'.length,
      completed: true,
      error: undefined,
    })
  })

  it('askStream should handle non-ok HTTP response as error', async () => {
    const chat = new SimpleChat()
    chat.init(createConfig())

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      body: null,
      text: () => Promise.resolve('server error'),
    } as any)

    const onError = vi.fn()
    const result = await chat.askStream(
      { messages: createMessages('boom') } as any,
      { enabled: true, onError } as any,
    )

    expect(result.completed).toBe(false)
    expect(result.error).toBeInstanceOf(Error)
    expect(String(result.error?.message)).toContain('Dify API error')
    expect(onError).toHaveBeenCalled()
  })

  it('stopStream should POST to stop endpoint', async () => {
    const chat = new SimpleChat()
    chat.init(createConfig())

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as any)

    await chat.stopStream('task-123')

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.dify.test/chat-messages/task-123/stop',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer sk-test',
          'Content-Type': 'application/json',
        },
      }),
    )
  })

  it('buildRequestBody should include system, model, conversation and attachments', () => {
    const chat = new SimpleChat()
    chat.init(createConfig())

    const attachments: any[] = [
      {
        kind: 'image',
        source: { kind: 'uploaded', fileId: 'file-1' },
      },
      {
        kind: 'image',
        source: { kind: 'url', url: 'http://example.com/img.png' },
      },
    ]

    const body = (chat as any).buildRequestBody(
      'hello',
      'streaming',
      'conv-1',
      0.7,
      1024,
      attachments,
    )

    expect(body.inputs.system).toBe('you are dify')
    expect(body.inputs.model).toBe('gpt-dify')
    expect(body.conversation_id).toBe('conv-1')
    expect(body.temperature).toBe(0.7)
    expect(body.max_tokens).toBe(1024)
    expect(body.files).toHaveLength(2)
    expect(body.files[0]).toMatchObject({
      type: 'image',
      transfer_method: 'local_file',
      upload_file_id: 'file-1',
    })
    expect(body.files[1]).toMatchObject({
      type: 'image',
      transfer_method: 'local_file',
      url: 'http://example.com/img.png',
    })
  })

  it('convertToChunk should map different Dify event types correctly', () => {
    const chat = new SimpleChat()

    const asAny = chat as any

    const messageChunk = asAny.convertToChunk({
      event: 'message',
      answer: 'final',
      data: { answer: 'ignored' },
    })
    expect(messageChunk).toEqual({ content: 'final' })

    const textChunk = asAny.convertToChunk({
      event: 'text_chunk',
      data: { text: 'partial' },
    })
    expect(textChunk).toEqual({ content: 'partial' })

    const endChunk = asAny.convertToChunk({
      event: 'message_end',
    })
    expect(endChunk).toEqual({ content: '', finish_reason: 'stop' })

    const workflowEndChunk = asAny.convertToChunk({
      event: 'workflow_finished',
    })
    expect(workflowEndChunk).toEqual({ content: '', finish_reason: 'stop' })

    const unknownChunk = asAny.convertToChunk({ event: 'something_else' })
    expect(unknownChunk).toBeNull()
  })
})
