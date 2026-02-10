import type { AttachmentKind, UploadedFileRef } from '../domain/types'

export type DifyUploadParams = {
  apiKey: string
  baseUrl: string
  file: File | Blob
  fileName: string
  kind: AttachmentKind // 当前实际使用 image，未来可扩展 audio
  userId: string
}

export type DifyUploadResult = UploadedFileRef

export async function uploadToDify(params: DifyUploadParams): Promise<DifyUploadResult> {
  const base = params.baseUrl.replace(/\/+$/, '')
  const url = `${base}/files/upload`

  const form = new FormData()
  form.append('file', params.file, params.fileName)
  form.append('user', params.userId)

  console.warn('[DifyUpload] Starting upload to:', url, { fileName: params.fileName, userId: params.userId })

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      // 不要显式设置 Content-Type，浏览器会为 FormData 自动带上 boundary
    },
    body: form,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.warn('[DifyUpload] Upload failed:', res.status, text)
    throw new Error(`Dify upload failed (${res.status}): ${text}`)
  }

  const json = (await res.json()) as {
    id: string
    name: string
    size: number
    mime_type: string
    extension?: string
    source_url?: string
  }

  console.warn('[DifyUpload] Upload success:', json)

  return {
    id: json.id,
    name: json.name,
    size: json.size,
    mimeType: json.mime_type,
    kind: params.kind,
    sourceUrl: json.source_url,
  }
}
