import { describe, expect, it } from 'vitest'
import { normalizeLatexDelimiters } from './normalizeLatexDelimiters'

describe('normalizeLatexDelimiters', () => {
  it('should normalize standard latex inline and block delimiters', () => {
    const source = [
      'Inline: \\(E = mc^2\\)',
      '',
      '\\[',
      '\\frac{a}{b}',
      '\\]',
    ].join('\n')

    const normalized = normalizeLatexDelimiters(source)

    expect(normalized).toContain('Inline: $E = mc^2$')
    expect(normalized).toContain('$$\n\\frac{a}{b}\n$$')
  })

  it('should not normalize fenced code blocks or inline code', () => {
    const source = [
      'Code: `\\(x + y\\)`',
      '',
      '```tex',
      '\\(',
      'x + y',
      '\\)',
      '```',
    ].join('\n')

    const normalized = normalizeLatexDelimiters(source)

    expect(normalized).toContain('`\\(x + y\\)`')
    expect(normalized).toContain('```tex\n\\(\nx + y\n\\)\n```')
  })
})
