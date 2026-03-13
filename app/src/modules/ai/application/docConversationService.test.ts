import { describe, it, expect, vi, beforeEach } from 'vitest'
import { docConversationService } from './docConversationService'
import { mockInvoke } from '../../../../vitest.setup'
import * as filesService from '../../files/service'

// Mock filesService. Use vi.mock for total replacement
vi.mock('../../files/service', () => ({
    readFile: vi.fn(),
    writeFile: vi.fn()
}))

describe('docConversationService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
            ; (filesService.writeFile as any).mockResolvedValue({ ok: true, data: { path: '', mtimeMs: 0, hash: '', code: 'OK' } })
    })

    it('getIndex should call load_doc_conversations and return entries', async () => {
        const mockData = [
            { docPath: 'p1', sessionId: 's1', lastActiveAt: 100, messages: [{}, {}] },
            { docPath: 'p2', sessionId: 's2', lastActiveAt: 200, messages: [] }
        ]
            ; (mockInvoke as any).mockResolvedValue({ Ok: { data: mockData } })

        const index = await docConversationService.getIndex()

        expect(mockInvoke).toHaveBeenCalledWith('load_doc_conversations')
        expect(index).toHaveLength(2)
        expect(index[0].docPath).toBe('p1')
        expect(index[0].messageCount).toBe(2)
    })

    it('upsertFromState should persist new messages into workspace file', async () => {
        // Mock workspace config lookup to return NOT_FOUND so a new workspace is created
        ; (filesService.readFile as any).mockResolvedValue({ ok: false, error: { code: 'NOT_FOUND' } })
            ; (mockInvoke as any).mockResolvedValue({ Ok: { data: [] } })

        const mockState = {
            viewMessages: [
                { id: 'm1', role: 'user', content: 'hello' }
            ]
        }

        await docConversationService.upsertFromState({
            docPath: '/test/file.md',
            state: mockState as any,
            providerType: 'openai',
            modelName: 'gpt-4'
        })

        const writeCalls = (filesService.writeFile as any).mock.calls as any[]
        const convoCall = writeCalls.find(([arg]: any[]) => typeof arg?.path === 'string' && arg.path.includes('doc_conversations.json'))
        expect(convoCall).toBeDefined()
        const payload = JSON.parse(convoCall[0].content)
        expect(Array.isArray(payload)).toBe(true)
        expect(payload[0].messages[0].content).toBe('hello')
    })

    it('clearByDocPath should clear messages for a path in workspace file', async () => {
        ; (mockInvoke as any).mockResolvedValue({ Ok: { data: [] } })
            ; (filesService.readFile as any).mockResolvedValue({ ok: false, error: { code: 'NOT_FOUND' } })

        await docConversationService.clearByDocPath('/test/file.md')

        const writeCalls = (filesService.writeFile as any).mock.calls as any[]
        const convoCall = writeCalls.find(([arg]: any[]) => typeof arg?.path === 'string' && arg.path.includes('doc_conversations.json'))
        expect(convoCall).toBeDefined()
        const payload = JSON.parse(convoCall[0].content)
        expect(Array.isArray(payload)).toBe(true)
        expect(payload[0].messages).toEqual([])
    })

    it('should use workspace ID if .haomd-workspace.json exists', async () => {
        // Mock load_doc_conversations
        ; (mockInvoke as any).mockResolvedValue({ Ok: { data: [] } })

            // Mock reading workspace config
            ; (filesService.readFile as any).mockImplementation((path: string) => {
                if (path.endsWith('.haomd-workspace.json')) {
                    return Promise.resolve({ ok: true, data: { content: JSON.stringify({ id: 'ws-123' }) } })
                }
                return Promise.resolve({ ok: false, error: { code: 'NOT_FOUND' } })
            })

        const mockState = { viewMessages: [{ id: 'm1', role: 'user', content: 'hi' }] }

        await docConversationService.upsertFromState({
            docPath: '/my-project/subdir/doc.md',
            state: mockState as any,
            providerType: 'openai',
            modelName: 'gpt-4'
        })

        const writeCalls = (filesService.writeFile as any).mock.calls as any[]
        const convoCall = writeCalls.find(([arg]: any[]) => typeof arg?.path === 'string' && arg.path.includes('doc_conversations.json'))
        expect(convoCall).toBeDefined()
        const payload = JSON.parse(convoCall[0].content)
        expect(Array.isArray(payload)).toBe(true)
        expect(payload[0].docPath).toBe('ws-123')
    })

    it('should create workspace ID if not exists and valid directory', async () => {
        ; (mockInvoke as any).mockResolvedValue({ Ok: { data: [] } })

            // First read fails with NOT_FOUND
            ; (filesService.readFile as any).mockResolvedValue({ ok: false, error: { code: 'NOT_FOUND' } })

        // Mock writeFile for workspace config
        const writeSpy = vi.mocked(filesService.writeFile).mockResolvedValue({ ok: true, data: { path: '', mtimeMs: 0, hash: '', code: 'OK' } })

        const mockState = { viewMessages: [{ id: 'm1', role: 'user', content: 'hi' }] }

        await docConversationService.upsertFromState({
            docPath: '/new-project/doc.md',
            state: mockState as any,
            providerType: 'openai',
            modelName: 'gpt-4'
        })

        expect(writeSpy).toHaveBeenCalledWith(expect.objectContaining({
            path: expect.stringContaining('.haomd/workspace.json')
        }))
    })
})

