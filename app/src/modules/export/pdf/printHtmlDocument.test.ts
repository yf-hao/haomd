import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { printHtmlDocument } from './printHtmlDocument'

describe('printHtmlDocument', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.head.querySelectorAll('style, div').forEach((el) => el.remove())
    document.title = 'original'
    window.onafterprint = null
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { ready: Promise.resolve() },
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 0
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('injects template css before printing', async () => {
    const html = `<!doctype html>
      <html>
        <head>
          <style>.sample { color: red; }</style>
        </head>
        <body>
          <div class="markdown-body"><p class="sample">Hello</p></div>
        </body>
      </html>`

    const printSpy = vi.fn(() => {
      expect(document.head.querySelector('#haomd-print-template-css')).not.toBeNull()
      expect(document.body.querySelector('#haomd-print-portal')).not.toBeNull()
      const printStyle = document.head.querySelector('#haomd-print-override')?.textContent ?? ''
      expect(printStyle).toContain('#root')
      expect(printStyle).toContain('overflow: visible !important')
      window.onafterprint?.(new Event('afterprint'))
    })

    const originalPrint = window.print
    window.print = printSpy as typeof window.print

    const promise = printHtmlDocument({ html, title: 'Doc' })
    await promise

    expect(printSpy).toHaveBeenCalledOnce()
    expect(document.title).toBe('original')

    window.print = originalPrint
  })
})
