import { describe, expect, it, vi } from 'vitest'
import {
  appendAnnotation,
  createEmptyDocumentAnnotations,
  createHighlightAnnotation,
  normalizeDocumentAnnotations,
  selectionBlocksToAnnotationRects,
} from './annotationUtils'

describe('pdf/annotationUtils', () => {
  it('normalizes selection blocks into relative annotation rects', () => {
    expect(
      selectionBlocksToAnnotationRects(
        [{ left: 20, top: 40, width: 60, height: 20 }],
        200,
        100,
      ),
    ).toEqual([
      {
        x1: 0.1,
        y1: 0.4,
        x2: 0.4,
        y2: 0.6,
      },
    ])
  })

  it('fills missing annotation document metadata when loading stored data', () => {
    expect(normalizeDocumentAnnotations(null, 'hash-1', 'demo.pdf', 3)).toMatchObject({
      pdfHash: 'hash-1',
      fileName: 'demo.pdf',
      pageCount: 3,
      annotations: [],
      version: 1,
    })
  })

  it('creates and appends highlight annotations', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-0000-0000-000000000001')

    const annotation = createHighlightAnnotation({
      page: 2,
      text: 'sample',
      rects: [{ x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.3 }],
    }, '#4da3ff')
    const nextDocument = appendAnnotation(
      createEmptyDocumentAnnotations('hash-1', 'demo.pdf', 3),
      annotation,
    )

    expect(annotation).toMatchObject({
      id: '00000000-0000-0000-0000-000000000001',
      page: 2,
      type: 'highlight',
      color: '#4da3ff',
      opacity: 0.36,
      content: 'sample',
    })
    expect(nextDocument.annotations).toHaveLength(1)
  })
})
