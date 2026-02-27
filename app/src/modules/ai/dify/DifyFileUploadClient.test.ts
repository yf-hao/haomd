import { describe, it, expect, vi, beforeEach } from 'vitest'
import { uploadToDify } from './DifyFileUploadClient'

describe('DifyFileUploadClient', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('should upload file successfully', async () => {
        const mockResponse = {
            id: 'file-123',
            name: 'test.png',
            size: 1024,
            mime_type: 'image/png',
            source_url: 'http://example.com/test.png'
        }

        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(mockResponse)
        } as Response)

        const result = await uploadToDify({
            apiKey: 'key',
            baseUrl: 'http://base.com',
            file: new Blob(['content'], { type: 'image/png' }),
            fileName: 'test.png',
            kind: 'image',
            userId: 'user-1'
        })

        expect(fetchSpy).toHaveBeenCalledWith('http://base.com/files/upload', expect.objectContaining({
            method: 'POST',
            headers: {
                Authorization: 'Bearer key'
            }
        }))

        expect(result.id).toBe('file-123')
        expect(result.sourceUrl).toBe('http://example.com/test.png')
    })

    it('should throw error on failed upload', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: false,
            status: 400,
            text: () => Promise.resolve('Bad Request')
        } as Response)

        await expect(uploadToDify({
            apiKey: 'key',
            baseUrl: 'http://base.com',
            file: new Blob([]),
            fileName: 'test.png',
            kind: 'image',
            userId: 'user-1'
        })).rejects.toThrow('Dify upload failed (400): Bad Request')
    })
})
