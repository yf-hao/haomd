import { describe, expect, it } from 'vitest'
import { matchRemoveBlankLinesScope, shouldRemoveBlankLines } from './blankLineIntentMatcher'

describe('shouldRemoveBlankLines', () => {
  it.each([
    '去除空行',
    '删除当前文档空行',
    '去除当前文档中的空行。',
    'remove blank lines',
  ])('matches explicit command: %s', (input) => {
    expect(shouldRemoveBlankLines(input)).toBe(true)
  })

  it.each([
    '删除表格与代码块之间的空行',
    '删除 table 与 code 之间的空行',
    'remove blank lines between table and code',
  ])('matches table/code gap command: %s', (input) => {
    expect(matchRemoveBlankLinesScope(input)).toBe('table_code_gap')
  })

  it.each([
    '如何去除空行',
    '怎么删除空行',
    '去除空行的方法',
    '请解释空行是什么',
  ])('does not match a question: %s', (input) => {
    expect(shouldRemoveBlankLines(input)).toBe(false)
  })
})
