import { describe, expect, it } from 'vitest'
import { removeBlankLines } from './removeBlankLinesService'

describe('removeBlankLines', () => {
  it('removes empty and whitespace-only lines while preserving content', () => {
    const result = removeBlankLines('# Title\n\n  \nParagraph\n')

    expect(result.content).toBe('# Title\nParagraph\n')
    expect(result.removedCount).toBe(2)
  })

  it('handles CRLF line endings', () => {
    const result = removeBlankLines('First\r\n\r\n  \r\nLast')

    expect(result.content).toBe('First\r\nLast')
    expect(result.removedCount).toBe(2)
  })

  it('does not change a document without blank lines', () => {
    const markdown = '# Title\nParagraph'

    expect(removeBlankLines(markdown)).toEqual({
      content: markdown,
      removedCount: 0,
    })
  })
})
