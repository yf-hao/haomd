import type { PDFDocumentProxy } from '../hooks/usePdfDocument'

export async function renderPage(options: {
  pdfDocument: PDFDocumentProxy
  pageNumber: number
  scale: number
  canvas: HTMLCanvasElement
}): Promise<{ width: number; height: number }> {
  const { pdfDocument, pageNumber, scale, canvas } = options
  const page = await pdfDocument.getPage(pageNumber)
  const viewport = page.getViewport({ scale })

  const context = canvas.getContext('2d')
  if (!context) {
    return { width: 0, height: 0 }
  }

  canvas.width = viewport.width
  canvas.height = viewport.height

  await page.render({ canvasContext: context, viewport }).promise

  return { width: viewport.width, height: viewport.height }
}
