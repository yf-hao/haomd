import type { OutlineItem } from '../outline/parser'

export type PdfOutlineEntry = {
  title?: string
  dest?: unknown
  items?: PdfOutlineEntry[]
}

export type PdfOutlineDocument = {
  getOutline?: () => Promise<PdfOutlineEntry[] | null>
  getDestination?: (dest: string) => Promise<unknown>
  getPageIndex?: (ref: unknown) => Promise<number>
}

async function resolveOutlinePageNumber(pdfDocument: PdfOutlineDocument, dest: unknown): Promise<number | null> {
  if (!dest) return null

  if (Array.isArray(dest)) {
    const first = dest[0]
    if (typeof first === 'number' && Number.isFinite(first)) {
      return first + 1
    }
    if (first != null && typeof pdfDocument.getPageIndex === 'function') {
      try {
        const pageIndex = await pdfDocument.getPageIndex(first)
        if (Number.isFinite(pageIndex) && pageIndex >= 0) {
          return pageIndex + 1
        }
      } catch {
        return null
      }
    }
    return null
  }

  if (typeof dest === 'string' && typeof pdfDocument.getDestination === 'function') {
    try {
      const resolved = await pdfDocument.getDestination(dest)
      return resolveOutlinePageNumber(pdfDocument, resolved)
    } catch {
      return null
    }
  }

  return null
}

async function buildPdfOutlineItems(
  pdfDocument: PdfOutlineDocument,
  entries: PdfOutlineEntry[],
  ancestors: number[] = [],
): Promise<OutlineItem[]> {
  const items: OutlineItem[] = []

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    const title = entry.title?.trim() ?? ''
    const children = await buildPdfOutlineItems(pdfDocument, entry.items ?? [], [...ancestors, index + 1])
    if (!title && children.length === 0) {
      continue
    }

    const page = await resolveOutlinePageNumber(pdfDocument, entry.dest)
    const depth = Math.min(ancestors.length + 1, 6) as 1 | 2 | 3 | 4 | 5 | 6
    const nodeId = `pdf-outline-${[...ancestors, index + 1].join('-')}`

    items.push({
      id: nodeId,
      level: depth,
      text: title || `Untitled ${index + 1}`,
      line: page ?? 1,
      page: page ?? undefined,
      searchText: title || `Untitled ${index + 1}`,
      source: 'pdf',
      children,
    })
  }

  return items
}

export async function loadPdfOutline(pdfDocument: PdfOutlineDocument): Promise<OutlineItem[]> {
  if (!pdfDocument.getOutline) return []
  try {
    const outline = await pdfDocument.getOutline()
    if (!outline || outline.length === 0) return []
    return buildPdfOutlineItems(pdfDocument, outline)
  } catch {
    return []
  }
}
