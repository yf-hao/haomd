import { describe, expect, it } from 'vitest'
import { markdownToWordModel } from './markdownToWordModel'

describe('export/word - markdownToWordModel', () => {
  it('should map core markdown structures into a word payload', () => {
    const markdown = [
      '# Title',
      '',
      'Paragraph with [link](https://example.com), `code`, **bold**, *italic*, and ~~strike~~.',
      '',
      '- item one',
      '- item two',
      '',
      '| Column | Value |',
      '| --- | --- |',
      '| Text | 中文 English |',
      '',
      '```mermaid',
      'flowchart LR',
      '  A --> B',
      '```',
      '',
      '![Diagram](docs/images/katex.png)',
    ].join('\n')

    const payload = markdownToWordModel(markdown, 'Sample')

    expect(payload.title).toBe('Sample')
    expect(payload.assets).toEqual([
      expect.objectContaining({
        id: 'asset_0',
        kind: 'image',
        sourcePath: 'docs/images/katex.png',
      }),
    ])

    expect(payload.blocks[0]).toEqual({
      type: 'heading',
      level: 1,
      text: [{ type: 'text', value: 'Title' }],
    })

    expect(payload.blocks[1]).toEqual(
      expect.objectContaining({
        type: 'paragraph',
        text: expect.arrayContaining([
          expect.objectContaining({ type: 'link', value: 'link', href: 'https://example.com' }),
          expect.objectContaining({ type: 'text', value: 'code', code: true }),
          expect.objectContaining({ type: 'text', value: 'bold', bold: true }),
          expect.objectContaining({ type: 'text', value: 'italic', italic: true }),
          expect.objectContaining({ type: 'text', value: 'strike', strike: true }),
        ]),
      }),
    )

    expect(payload.blocks[2]).toEqual({
      type: 'list',
      ordered: false,
      items: [
        [{ type: 'paragraph', text: [{ type: 'text', value: 'item one' }] }],
        [{ type: 'paragraph', text: [{ type: 'text', value: 'item two' }] }],
      ],
    })

    expect(payload.blocks[3]).toEqual({
      type: 'table',
      rows: [
        {
          cells: [
            [{ type: 'paragraph', text: [{ type: 'text', value: 'Column' }] }],
            [{ type: 'paragraph', text: [{ type: 'text', value: 'Value' }] }],
          ],
        },
        {
          cells: [
            [{ type: 'paragraph', text: [{ type: 'text', value: 'Text' }] }],
            [{ type: 'paragraph', text: [{ type: 'text', value: '中文 English' }] }],
          ],
        },
      ],
    })

    expect(payload.blocks[4]).toEqual({
      type: 'code',
      language: 'mermaid',
      content: 'flowchart LR\n  A --> B',
    })

    expect(payload.blocks[5]).toEqual({
      type: 'image',
      assetId: 'asset_0',
      alt: 'Diagram',
    })
  })

  it('should resolve reference links and keep inline line breaks', () => {
    const markdown = [
      'Line one  ',
      'Line two with [ref][docs].',
      '',
      '[docs]: https://example.com/docs',
    ].join('\n')

    const payload = markdownToWordModel(markdown, 'Refs')
    const paragraph = payload.blocks[0]

    expect(paragraph).toEqual({
      type: 'paragraph',
      text: [
        { type: 'text', value: 'Line one\nLine two with ' },
        { type: 'link', value: 'ref', href: 'https://example.com/docs' },
        { type: 'text', value: '.' },
      ],
    })
  })
})
