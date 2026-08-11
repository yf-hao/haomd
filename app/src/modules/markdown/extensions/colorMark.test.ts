import { describe, expect, it } from 'vitest'
import {
  applyBackgroundColorSyntax,
  clearBackgroundColorSyntax,
  replaceTextColorSyntaxWithHtml,
} from './colorMark'

describe('background color syntax', () => {
  it('applies and clears background color syntax', () => {
    const colored = applyBackgroundColorSyntax('selected text', '#fef3c7')

    expect(colored).toBe('{background:#fef3c7}selected text{/background}')
    expect(clearBackgroundColorSyntax(colored!)).toBe('selected text')
  })

  it('renders nested text and background colors without escaping the nested mark', () => {
    const html = replaceTextColorSyntaxWithHtml(
      '{background:#fef3c7}{color:#3b82f6}styled{/color}{/background}',
    )

    expect(html).toBe(
      '<span data-background-color="#fef3c7" style="background-color:#fef3c7"><span data-text-color="#3b82f6" style="color:#3b82f6">styled</span></span>',
    )
  })

  it('preserves fenced code contents while rendering colors outside code blocks', () => {
    const markdown = [
      '{color:#3b82f6}styled{/color}',
      '',
      '```text',
      '苹果 -> [0.5, 0.5]',
      '{color:#fef3c7}not styled{/color}',
      '```',
    ].join('\n')

    expect(replaceTextColorSyntaxWithHtml(markdown)).toBe([
      '<span data-text-color="#3b82f6" style="color:#3b82f6">styled</span>',
      '',
      '```text',
      '苹果 -> [0.5, 0.5]',
      '{color:#fef3c7}not styled{/color}',
      '```',
    ].join('\n'))
  })
})
