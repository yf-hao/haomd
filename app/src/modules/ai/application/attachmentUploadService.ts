import type { UiProvider, AttachmentKind, UploadedFileRef } from '../domain/types'
import { uploadToDify } from '../dify/DifyFileUploadClient'

export interface AttachmentUploadService {
  uploadAttachment(params: {
    provider: UiProvider
    kind: AttachmentKind
    file: File | Blob
    fileName: string
    userId: string
  }): Promise<UploadedFileRef>
}

export function createAttachmentUploadService(): AttachmentUploadService {
  return {
    async uploadAttachment({ provider, kind, file, fileName, userId }) {
      const providerType = provider.providerType ?? 'dify'

      switch (providerType) {
        case 'dify':
          return uploadToDify({
            apiKey: provider.apiKey,
            baseUrl: provider.baseUrl,
            file,
            fileName,
            kind,
            userId,
          })
        default:
          throw new Error(`Provider type "${providerType}" does not support attachments yet`)
      }
    },
  }
}
