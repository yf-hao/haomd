import { describe, it, expect, vi } from 'vitest'
import { createAttachmentUploadService } from './attachmentUploadService'
import { uploadToDify } from '../dify/DifyFileUploadClient'

vi.mock('../dify/DifyFileUploadClient', () => ({
    uploadToDify: vi.fn(),
}))

describe('attachmentUploadService', () => {
    const service = createAttachmentUploadService()

    it('should call uploadToDify when providerType is dify', async () => {
        const mockProvider = {
            id: 'p1',
            name: 'Dify',
            baseUrl: 'http://base',
            apiKey: 'key',
            providerType: 'dify'
        } as any

        vi.mocked(uploadToDify).mockResolvedValue({ id: 'f1' } as any)

        const result = await service.uploadAttachment({
            provider: mockProvider,
            kind: 'image',
            file: new Blob([]),
            fileName: 'test.png',
            userId: 'u1'
        })

        expect(uploadToDify).toHaveBeenCalled()
        expect(result.id).toBe('f1')
    })

    it('should use dify as default if providerType is missing', async () => {
        const mockProvider = {
            baseUrl: 'http://base',
            apiKey: 'key'
        } as any

        vi.mocked(uploadToDify).mockResolvedValue({ id: 'f1' } as any)

        await service.uploadAttachment({
            provider: mockProvider,
            kind: 'image',
            file: new Blob([]),
            fileName: 'test.png',
            userId: 'u1'
        })

        expect(uploadToDify).toHaveBeenCalled()
    })

    it('should throw error for unsupported provider types', async () => {
        const mockProvider = {
            providerType: 'openai'
        } as any

        await expect(service.uploadAttachment({
            provider: mockProvider,
            kind: 'image',
            file: new Blob([]),
            fileName: 'test.png',
            userId: 'u1'
        })).rejects.toThrow('Provider type "openai" does not support attachments yet')
    })
})
