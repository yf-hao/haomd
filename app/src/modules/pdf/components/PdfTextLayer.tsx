import { useEffect, useRef } from 'react'
import type { PDFDocumentProxy } from '../hooks/usePdfDocument'
import * as pdfjsLib from 'pdfjs-dist'

export interface PdfTextLayerProps {
  pdfDocument: PDFDocumentProxy
  pageNumber: number
  scale: number
}

/**
 * 文本层：叠加在 canvas 之上的真实 DOM 文本，用于选择/复制/后续批注。
 *
 * 不使用 pdf.js 自带的 textLayerBuilder，而是：
 * 1）getTextContent() 拿到每个文字片段；
 * 2）用 Util.transform 计算在页面坐标系中的位置；
 * 3）按“行”合并片段，每行只生成一个 span，避免选区叠成很多条纹。
 */
export function PdfTextLayer({ pdfDocument, pageNumber, scale }: PdfTextLayerProps) {
  const layerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const container = layerRef.current
    if (!container || !pdfDocument) return

    let cancelled = false
    container.innerHTML = ''

    const render = async () => {
      try {
        const page = await pdfDocument.getPage(pageNumber)
        if (cancelled) return

        const viewport = page.getViewport({ scale })
        const textContent = await page.getTextContent()
        if (cancelled) return

        const Util = (pdfjsLib as any).Util
        const items: any[] = (textContent.items || []) as any[]

        type Fragment = { text: string; x: number; yTop: number; fontSize: number }
        const fragments: Fragment[] = []

        for (const item of items) {
          const str: string = item.str || ''
          if (!str) continue

          let x = 0
          let yTop = 0
          let fontSize = 1

          try {
            if (Util && item.transform) {
              const tx = Util.transform(viewport.transform, item.transform)
              const c = tx[2]
              const d = tx[3]
              const e = tx[4]
              const f = tx[5]
              const fontHeight = Math.hypot(c, d) || Math.abs(d) || 1

              x = e
              yTop = f - fontHeight
              fontSize = fontHeight
            }
          } catch (e) {
            console.warn('[PdfTextLayer] failed to compute transform for text item', e)
          }

          fragments.push({ text: str, x, yTop, fontSize })
        }

        if (fragments.length === 0) return

        // 按行聚合：同一行的 yTop 足够接近就认为是一行
        type Line = { yTop: number; fontSize: number; frags: Fragment[] }
        const lines: Line[] = []

        const lineThreshold = 1 // 垂直合并阈值（像素）

        for (const frag of fragments) {
          let line = lines.find((l) => Math.abs(l.yTop - frag.yTop) <= lineThreshold)
          if (!line) {
            line = { yTop: frag.yTop, fontSize: frag.fontSize, frags: [] }
            lines.push(line)
          }
          line.frags.push(frag)
        }

        // 生成 DOM：每行一个 span，按 x 从左到右拼接文本
        for (const line of lines) {
          line.frags.sort((a, b) => a.x - b.x)

          const span = document.createElement('span')
          span.textContent = line.frags.map((f) => f.text).join('')
          span.style.position = 'absolute'
          span.style.whiteSpace = 'pre'

          const minX = line.frags[0]?.x ?? 0
          span.style.left = `${minX}px`
          span.style.top = `${line.yTop}px`
          span.style.fontSize = `${line.fontSize}px`

          // 文字本身几乎透明，只依赖 selection 背景
          span.style.color = 'rgba(0, 0, 0, 0.02)'

          container.appendChild(span)
        }
      } catch (e) {
        if (!cancelled) {
          console.error('[PdfTextLayer] failed to render text layer', e)
        }
      }
    }

    void render()

    return () => {
      cancelled = true
      if (container) {
        container.innerHTML = ''
      }
    }
  }, [pdfDocument, pageNumber, scale])

  return <div ref={layerRef} className="pdf-text-layer" />
}
