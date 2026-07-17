import { describe, expect, it } from 'vitest'
import { buildPdfAiChatDocPathKey } from './aiChatDocPathKey'

describe('buildPdfAiChatDocPathKey', () => {
  it('returns a slash-free stable key for pdf paths', () => {
    expect(buildPdfAiChatDocPathKey('/Users/me/Documents/sample.pdf')).toBe(
      'pdf:%2FUsers%2Fme%2FDocuments%2Fsample.pdf',
    )
  })

  it('returns null for empty pdf paths', () => {
    expect(buildPdfAiChatDocPathKey('')).toBeNull()
    expect(buildPdfAiChatDocPathKey('   ')).toBeNull()
    expect(buildPdfAiChatDocPathKey(null)).toBeNull()
    expect(buildPdfAiChatDocPathKey(undefined)).toBeNull()
  })
})
