import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createOpenAIStreamingClient } from './createOpenAIStreamingClient'

describe('createOpenAIStreamingClient', () => {
    const config = {
        apiKey: 'test-key',
        baseUrl: 'https://api.openai.com/v1',
        modelId: 'gpt-4'
    }

    beforeEach(() => {
        vi.clearAllMocks()
        globalThis.fetch = vi.fn()
    })

    it('should build the correct completion URL', async () => {
        const client = createOpenAIStreamingClient(config)

        vi.mocked(fetch).mockResolvedValueOnce({
            ok: true,
            body: {
                getReader: () => ({
                    read: vi.fn().mockResolvedValueOnce({ done: true })
                })
            }
        } as any)

        await client.askStream({ messages: [] }, {})

        expect(fetch).toHaveBeenCalledWith(
            'https://api.openai.com/v1/chat/completions',
            expect.any(Object)
        )
    })

    it('should handle successful stream chunks', async () => {
        const client = createOpenAIStreamingClient(config)
        const onChunk = vi.fn()
        const onComplete = vi.fn()

        const mockChunks = [
            'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":" World"}}]}\n\n',
            'data: [DONE]\n\n'
        ]

        let chunkIndex = 0
        const mockReader = {
            read: vi.fn().mockImplementation(async () => {
                if (chunkIndex < mockChunks.length) {
                    const value = new TextEncoder().encode(mockChunks[chunkIndex++])
                    return { done: false, value }
                }
                return { done: true }
            })
        }

        vi.mocked(fetch).mockResolvedValueOnce({
            ok: true,
            body: {
                getReader: () => mockReader
            }
        } as any)

        const result = await client.askStream(
            { messages: [{ role: 'user', content: 'hi' }] },
            { onChunk, onComplete }
        )

        expect(result.content).toBe('Hello World')
        expect(onChunk).toHaveBeenCalledTimes(2)
        expect(onChunk).toHaveBeenCalledWith({ content: 'Hello' })
        expect(onChunk).toHaveBeenCalledWith({ content: ' World' })
        expect(onComplete).toHaveBeenCalledWith('Hello World', 11)
    })

    it('should handle API errors', async () => {
        const client = createOpenAIStreamingClient(config)
        const onError = vi.fn()

        vi.mocked(fetch).mockResolvedValueOnce({
            ok: false,
            status: 401,
            text: async () => 'Unauthorized'
        } as any)

        const result = await client.askStream({ messages: [] }, { onError })

        expect(result.error).toBeDefined()
        expect(result.error?.message).toContain('401')
        expect(onError).toHaveBeenCalled()
    })
})
