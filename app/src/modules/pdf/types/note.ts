export interface PdfNote {
  id: string
  pdfHash: string
  fileName: string
  page: number | null
  quote: string | null
  text: string
  color: string
  createdAt: number
  updatedAt: number
}
