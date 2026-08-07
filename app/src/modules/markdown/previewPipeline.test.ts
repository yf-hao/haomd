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

  it('keeps source line offsets when front matter is removed from the preview', () => {
    const value = '---\ntitle: Demo\n---\n\n# Heading'
    const result = preparePreviewMarkdown(value)

    expect(result.sourceLineOffset).toBe(3)
  })

  it('keeps content-based chunk identities stable when earlier content moves', () => {
    const stableDocument = [
      '## Stable section',
      '',
      'Stable content '.repeat(100),
      '',
      '## Tail section',
      '',
      'Tail content '.repeat(100),
    ].join('\n')
    const before = preparePreviewMarkdown(stableDocument)
    const after = preparePreviewMarkdown([
      '## Inserted section',
      '',
      'Inserted content '.repeat(100),
      '',
      stableDocument,
    ].join('\n'))

    const beforeStable = before.blockChunks.find(chunk => chunk.markdown.startsWith('## Stable section'))
    const afterStable = after.blockChunks.find(chunk => chunk.markdown.startsWith('## Stable section'))

    expect(beforeStable).toBeDefined()
    expect(afterStable).toBeDefined()
    expect(afterStable?.id).toBe(beforeStable?.id)
    expect(afterStable?.signature).toBe(beforeStable?.signature)
    expect(afterStable?.startLine).toBe((beforeStable?.startLine ?? 0) + 4)
  })
})
