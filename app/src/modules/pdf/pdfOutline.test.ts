import { describe, expect, it, vi } from 'vitest'
import { loadPdfOutline } from './pdfOutline'

describe('loadPdfOutline', () => {
  it('converts a PDF outline tree to outline items with page numbers', async () => {
    const pdfDocument = {
      getOutline: vi.fn(async () => [
        { title: 'Chapter 1', dest: 'chapter-1', items: [
          { title: 'Section 1.1', dest: [42] },
        ] },
        { title: 'Chapter 2', dest: [7] },
      ]),
      getDestination: vi.fn(async (dest: string) => {
        if (dest === 'chapter-1') return [11]
        return null
      }),
      getPageIndex: vi.fn(async () => 11),
    }

    const items = await loadPdfOutline(pdfDocument)

    expect(items).toHaveLength(2)
    expect(items[0]?.text).toBe('Chapter 1')
    expect(items[0]?.page).toBe(12)
    expect(items[0]?.children?.[0]?.text).toBe('Section 1.1')
    expect(items[0]?.children?.[0]?.page).toBe(43)
    expect(items[1]?.text).toBe('Chapter 2')
    expect(items[1]?.page).toBe(8)
  })
})
