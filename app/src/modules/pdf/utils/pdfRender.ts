import type { PDFDocumentProxy } from '../hooks/usePdfDocument'

export async function renderPage(options: {
  pdfDocument: PDFDocumentProxy
  pageNumber: number
  scale: number
  canvas: HTMLCanvasElement
}): Promise<{ width: number; height: number }> {
  const { pdfDocument, pageNumber, scale, canvas } = options
  const page = await pdfDocument.getPage(pageNumber)

  // 使用设备像素比进行高分辨率渲染：在 Retina 等高 DPI 屏幕上保持清晰
  const devicePixelRatio = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
  const effectiveScale = scale * devicePixelRatio

  const viewport = page.getViewport({ scale: effectiveScale })

  const context = canvas.getContext('2d')
  if (!context) {
    return { width: 0, height: 0 }
  }

  // 物理像素尺寸：提供足够分辨率
  canvas.width = viewport.width
  canvas.height = viewport.height

  await page.render({ canvasContext: context, viewport }).promise

  // 返回用于布局的 CSS 尺寸（除以像素比，保持视觉大小）
  const cssWidth = viewport.width / devicePixelRatio
  const cssHeight = viewport.height / devicePixelRatio

  return { width: cssWidth, height: cssHeight }
}
