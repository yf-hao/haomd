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

  it('initializes the exported TOC collapsed to level one', () => {
    const html = generateHTMLTemplate({
      title: 'Demo',
      body: '<div class="markdown-body">Hello</div>',
      hasMind: false,
      hasMermaid: false,
    })

    expect(html).toContain("var expanded = false;")
    expect(html).toContain("item.hidden = !expand && !isLevelOne;")
    expect(html).toContain("item.classList.contains('md-toc-level-1')")
    expect(html).toContain("toggleTocSections(expanded);")
    expect(html).toContain("折叠到一级目录")
    expect(html).toContain("展开全部目录")
  })
})
