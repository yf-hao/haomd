import { describe, expect, it } from 'vitest'
import { preparePreviewMarkdown } from './previewPipeline'

describe('preparePreviewMarkdown', () => {
  it('caches prepared results for repeated document values', () => {
    const value = '# Cached document\n\nThis document is rendered more than once.'

    expect(preparePreviewMarkdown(value)).toBe(preparePreviewMarkdown(value))
  })

  it('uses block chunks for a long document even when it has fewer than 60 lines', () => {
    const value = Array.from({ length: 12 }, (_, index) => (
      `## Section ${index + 1}\n\n${'Content '.repeat(30)}`
    )).join('\n\n')

    const result = preparePreviewMarkdown(value)

    expect(result.lineCount).toBeLessThan(60)
    expect(result.blockChunks.length).toBeGreaterThan(1)
  })

  it('keeps TOC documents on the full-document rendering path', () => {
    const value = ['[toc]', '', 'Content '.repeat(500)].join('\n')

    expect(preparePreviewMarkdown(value).blockChunks).toHaveLength(0)
  })
})
