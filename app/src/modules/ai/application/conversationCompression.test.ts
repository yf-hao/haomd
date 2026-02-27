import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createConversationCompressor, type CompressionConfig } from './conversationCompression'
import type { DocConversationRecord, DocConversationMessage } from '../domain/docConversations'

describe('conversationCompression', () => {
    const mockConfig: CompressionConfig = {
        minMessagesToCompress: 5,
        keepRecentRounds: 1,
        maxMessagesAfterCompress: 10,
        maxMessagesPerSummaryBatch: 10,
        maxSummaryCharsPerLevel: () => 1000,
    }

    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(1000) // "Now" is 1000
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    const createMsg = (id: string, role: 'user' | 'assistant' | 'system', content: string, ts: number): DocConversationMessage => ({
        id, docPath: 'test.md', role, content, timestamp: ts
    })

    const createRecord = (messages: DocConversationMessage[]): DocConversationRecord => ({
        docPath: 'test.md',
        sessionId: 's1',
        lastActiveAt: Date.now(),
        messages
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
            summarizeBatch: vi.fn().mockResolvedValue('Summary of old messages')
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
            maxSummaryCharsPerLevel: (l) => l === 1 ? 5 : 1000
        }

        const record = createRecord([
            {
                id: 's1', docPath: 'test.md', role: 'system', content: 'LongS1', timestamp: 50,
                meta: { summaryLevel: 1, coversMessageIds: ['old1'], coveredTimeRange: { from: 10, to: 40 } }
            },
            createMsg('1', 'user', 'u1', 100),
            createMsg('2', 'assistant', 'a1', 110),
            createMsg('3', 'user', 'u2', 200),
            createMsg('4', 'assistant', 'a2', 210),
            createMsg('5', 'user', 'u3', 1100),
            createMsg('6', 'assistant', 'a3', 1200),
        ])

        const provider = {
            summarizeBatch: vi.fn()
                .mockResolvedValueOnce('NewS1')
                .mockResolvedValueOnce('FinalS2')
        }
        const compressor = createConversationCompressor(provider)

        const result = await compressor.compress(record, configWithSmallLevel1)

        expect(result.messages).toHaveLength(3)
        expect(result.messages[0].meta?.summaryLevel).toBe(2)
        expect(result.messages[0].content).toBe('FinalS2')
    })
})
