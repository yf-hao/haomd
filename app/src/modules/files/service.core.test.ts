import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFile, writeFile, listFolder } from './service'
import { mockInvoke } from '../../../vitest.setup'

// Mock isTauriEnv to return true
vi.mock('../platform/runtime', () => ({
    isTauriEnv: vi.fn(() => true)
}))

describe('Files Service Core', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('readFile should call invoke and return successful result', async () => {
        const mockFileResponse = {
            Ok: {
                data: {
                    path: '/test.md',
                    content: 'hello world',
                    encoding: 'utf8',
                    mtime_ms: 123456789,
                    hash: 'abc'
                },
                trace_id: 't1'
            }
        }
            ; (mockInvoke as any).mockResolvedValue(mockFileResponse)

        const result = await readFile('/test.md', 't1')

        expect(mockInvoke).toHaveBeenCalledWith('read_file', { path: '/test.md', trace_id: 't1' })
        expect(result.ok).toBe(true)
        if (result.ok) {
            expect(result.data.content).toBe('hello world')
            expect(result.data.path).toBe('/test.md')
        }
    })

    it('readFile should handle backend errors', async () => {
        const mockErrorResponse = {
            Err: {
                error: {
                    code: 'NotFound',
                    message: 'File not found',
                    trace_id: 't2'
                }
            }
        }
            ; (mockInvoke as any).mockResolvedValue(mockErrorResponse)

        const result = await readFile('/missing.md', 't2')

        expect(result.ok).toBe(false)
        if (!result.ok) {
            expect(result.error.code).toBe('NOT_FOUND')
            expect(result.error.message).toBe('File not found')
        }
    })

    it('writeFile should call invoke with correct parameters', async () => {
        const mockWriteResponse = {
            Ok: {
                data: {
                    path: '/save.md',
                    mtime_ms: 987654321,
                    hash: 'def',
                    code: 'OK'
                },
                trace_id: 't3'
            }
        }
            ; (mockInvoke as any).mockResolvedValue(mockWriteResponse)

        const result = await writeFile({
            path: '/save.md',
            content: 'new content',
            traceId: 't3'
        })

        expect(mockInvoke).toHaveBeenCalledWith('write_file', expect.objectContaining({
            path: '/save.md',
            content: 'new content',
            trace_id: 't3'
        }))
        expect(result.ok).toBe(true)
    })

    it('listFolder should map filesystem entries correctly', async () => {
        const mockFolderResponse = {
            Ok: {
                data: [
                    { path: '/dir/a.md', name: 'a.md', kind: 'file' },
                    { path: '/dir/sub', name: 'sub', kind: 'dir' }
                ],
                trace_id: 't4'
            }
        }
            ; (mockInvoke as any).mockResolvedValue(mockFolderResponse)

        const result = await listFolder('/dir', 't4')

        expect(result.ok).toBe(true)
        if (result.ok) {
            expect(result.data).toHaveLength(2)
            expect(result.data[0].kind).toBe('file')
            expect(result.data[1].kind).toBe('dir')
        }
    })
})
