import { describe, expect, it } from 'vitest'
import { inferAttachmentKind, isPreviewableImage } from './attachmentKind'

describe('attachmentKind', () => {
  it('infers image, audio, and document kinds from mime type', () => {
    expect(inferAttachmentKind({ name: 'photo.png', type: 'image/png' })).toBe('image')
    expect(inferAttachmentKind({ name: 'voice.mp3', type: 'audio/mpeg' })).toBe('audio')
    expect(inferAttachmentKind({ name: 'slides.pdf', type: 'application/pdf' })).toBe('document')
  })

  it('falls back to extension for common document files', () => {
    expect(inferAttachmentKind({ name: 'notes.md', type: '' })).toBe('document')
    expect(inferAttachmentKind({ name: 'report.DOCX', type: '' })).toBe('document')
    expect(inferAttachmentKind({ name: 'archive.zip', type: '' })).toBeNull()
  })

  it('recognizes previewable images only', () => {
    expect(isPreviewableImage({ type: 'image/jpeg' })).toBe(true)
    expect(isPreviewableImage({ type: 'application/pdf' })).toBe(false)
    expect(isPreviewableImage(undefined)).toBe(false)
  })
})
