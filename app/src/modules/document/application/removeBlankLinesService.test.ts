import { describe, expect, it } from 'vitest'
import { removeBlankLines, removeTableCodeGapBlankLines } from './removeBlankLinesService'

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

  it('removes only the blank lines between a table and a fenced code block', () => {
    const markdown = '| A | B |\n| --- | --- |\n| 1 | 2 |\n\n\n```ts\nconst value = 1\n```\n'

    expect(removeTableCodeGapBlankLines(markdown)).toEqual({
      content: '| A | B |\n| --- | --- |\n| 1 | 2 |\n```ts\nconst value = 1\n```\n',
      removedCount: 2,
    })
  })

  it('does not remove blank lines inside a fenced code block', () => {
    const markdown = '| A |\n| --- |\n| 1 |\n\n```ts\nconst first = 1\n\nconst second = 2\n```\n'

    expect(removeTableCodeGapBlankLines(markdown)).toEqual({
      content: '| A |\n| --- |\n| 1 |\n```ts\nconst first = 1\n\nconst second = 2\n```\n',
      removedCount: 1,
    })
  })
})
