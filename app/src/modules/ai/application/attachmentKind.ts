import type { AttachmentKind } from '../domain/types'

const DOCUMENT_MIME_PREFIXES = ['text/']
const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/json',
  'application/rtf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/epub+zip',
  'application/xml',
])
const DOCUMENT_EXTENSIONS = new Set([
  'pdf',
  'txt',
  'md',
  'markdown',
  'csv',
  'tsv',
  'json',
  'xml',
  'html',
  'htm',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'rtf',
  'epub',
])

function getExtension(fileName: string): string {
  const parts = fileName.toLowerCase().split('.')
  return parts.length > 1 ? parts.pop() ?? '' : ''
}

export function inferAttachmentKind(file: Pick<File, 'type' | 'name'>): AttachmentKind | null {
  const mime = file.type.toLowerCase()
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (
    DOCUMENT_MIME_TYPES.has(mime) ||
    DOCUMENT_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix)) ||
    DOCUMENT_EXTENSIONS.has(getExtension(file.name))
  ) {
    return 'document'
  }
  return null
}

export function isPreviewableImage(file: { type?: string | null } | null | undefined): boolean {
  return !!file?.type && file.type.toLowerCase().startsWith('image/')
}
