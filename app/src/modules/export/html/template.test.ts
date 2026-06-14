import { describe, expect, it } from 'vitest'
import { generateHTMLTemplate } from './template'

describe('generateHTMLTemplate', () => {
  it('includes print hardening rules for pdf export', () => {
    const html = generateHTMLTemplate({
      title: 'Demo',
      body: '<div class="markdown-body">Hello</div>',
      hasMind: false,
      hasMermaid: false,
      inlineCss: true,
    })

    expect(html).toContain('@page')
    expect(html).toContain('size: A4 portrait')
    expect(html).toContain('#root')
    expect(html).toContain('overflow: visible !important')
    expect(html).toContain('max-width: calc(210mm - 3cm)')
    expect(html).toContain('white-space: pre-wrap !important')
    expect(html).toContain('page-break-before: always')
    expect(html).toContain('print-color-adjust: exact')
  })
})
