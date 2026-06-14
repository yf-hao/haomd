import hljsCssRaw from 'highlight.js/styles/github.css?raw'

type PrintHtmlDocumentOptions = {
  html: string
  title?: string
}

const PRINT_PORTAL_ID = 'haomd-print-portal'
const PRINT_STYLE_ID = 'haomd-print-override'
const PRINT_HLJS_STYLE_ID = 'haomd-print-hljs-css'
const PRINT_TEMPLATE_STYLE_ID = 'haomd-print-template-css'

function cleanupOld() {
  ;[PRINT_PORTAL_ID, PRINT_STYLE_ID, PRINT_HLJS_STYLE_ID, PRINT_TEMPLATE_STYLE_ID].forEach((id) => {
    const el = document.getElementById(id)
    if (el) el.parentNode?.removeChild(el)
  })
}

function waitForPrintReady(): Promise<void> {
  return new Promise((resolve) => {
    const fontReady = document.fonts?.ready ?? Promise.resolve()
    const images = Array.from(document.querySelectorAll<HTMLImageElement>(`#${PRINT_PORTAL_ID} img`))
    const imageReady = images.length === 0
      ? Promise.resolve()
      : Promise.all(images.map((img) => (
          img.complete
            ? Promise.resolve()
            : new Promise<void>((imageResolve) => {
                const onDone = () => imageResolve()
                img.addEventListener('load', onDone, { once: true })
                img.addEventListener('error', onDone, { once: true })
              })
        ))).then(() => undefined)

    void Promise.all([fontReady, imageReady]).then(() => {
      requestAnimationFrame(() => setTimeout(resolve, 50))
    })
  })
}

export async function printHtmlDocument(options: PrintHtmlDocumentOptions): Promise<void> {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    throw new Error('当前环境不支持打印')
  }

  cleanupOld()

  const originalTitle = document.title
  document.title = options.title ?? 'print-preview'

  const parser = new DOMParser()
  const doc = parser.parseFromString(options.html, 'text/html')
  const bodyContent = doc.body.innerHTML
  const templateCss = Array.from(doc.head.querySelectorAll('style'))
    .map((styleEl) => styleEl.textContent ?? '')
    .join('\n')

  if (templateCss.trim()) {
    const templateStyle = document.createElement('style')
    templateStyle.id = PRINT_TEMPLATE_STYLE_ID
    templateStyle.textContent = templateCss
    document.head.appendChild(templateStyle)
  }

  const portal = document.createElement('div')
  portal.id = PRINT_PORTAL_ID
  portal.innerHTML = `<div class="markdown-body">${bodyContent}</div>`
  document.body.appendChild(portal)

  const style = document.createElement('style')
  style.id = PRINT_STYLE_ID
  style.textContent = `
    #${PRINT_PORTAL_ID} {
      position: fixed !important;
      left: -9999px !important;
      top: 0 !important;
      display: block !important;
      visibility: visible !important;
      width: 1000px !important;
      background: white !important;
    }

    @media print {
      html,
      body {
        height: auto !important;
        min-height: auto !important;
        overflow: visible !important;
        background: white !important;
      }

      #root {
        height: auto !important;
        min-height: auto !important;
        overflow: visible !important;
      }

      body > *:not(#${PRINT_PORTAL_ID}) {
        display: none !important;
      }

      #${PRINT_PORTAL_ID} {
        visibility: visible !important;
        display: block !important;
        position: static !important;
        left: auto !important;
        top: auto !important;
        inset: auto !important;
        width: 100% !important;
        height: auto !important;
        background: white !important;
        z-index: 2147483647 !important;
        color: #1a1a1a !important;
        overflow: visible !important;
        transform: none !important;
      }
      .markdown-body {
        width: 100% !important;
        max-width: calc(210mm - 3cm) !important;
        min-height: auto !important;
        background: white !important;
        color: #1a1a1a !important;
        font-size: 12pt !important;
        line-height: 1.7 !important;
        overflow: visible !important;
      }
      .markdown-body code {
        background-color: rgba(27, 31, 35, 0.05) !important;
        color: #24292e !important;
        text-shadow: none !important;
      }
      .markdown-body pre {
        background-color: #f6f8fa !important;
        border: 1px solid #dfe2e5 !important;
        white-space: pre-wrap !important;
        word-break: break-word !important;
      }
      .markdown-body table {
        width: 100% !important;
        table-layout: fixed !important;
      }
      .mermaid-rendered svg { max-width: 100% !important; height: auto !important; }
      @page { size: A4 portrait; margin: 1.5cm; }
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    }
  `
  document.head.appendChild(style)

  const hljsStyle = document.createElement('style')
  hljsStyle.id = PRINT_HLJS_STYLE_ID
  hljsStyle.textContent = hljsCssRaw
  document.head.appendChild(hljsStyle)

  try {
    console.log('[Print] 内容已注入，等待渲染稳定...')
    await waitForPrintReady()

    console.log('[Print] 准备唤起打印预览...')
    return new Promise((resolve) => {
      const cleanup = () => {
        setTimeout(() => {
          cleanupOld()
          document.title = originalTitle
          resolve()
        }, 3000)
      }

      window.onafterprint = cleanup

      setTimeout(() => {
        try {
          window.print()
        } catch (error) {
          console.error('[Print] 打印指令执行失败:', error)
          cleanup()
        }
      }, 200)
    })
  } catch (error) {
    cleanupOld()
    document.title = originalTitle
    throw error
  }
}
