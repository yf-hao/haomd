import { describe, expect, it } from 'vitest'
import { markdownToWordModel, plainTextToWordModel } from './markdownToWordModel'

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
            { blocks: [{ type: 'paragraph', text: [{ type: 'text', value: 'Column' }] }] },
            { blocks: [{ type: 'paragraph', text: [{ type: 'text', value: 'Value' }] }] },
          ],
        },
        {
          cells: [
            { blocks: [{ type: 'paragraph', text: [{ type: 'text', value: 'Text' }] }] },
            { blocks: [{ type: 'paragraph', text: [{ type: 'text', value: '中文 English' }] }] },
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

  it('should preserve blank lines for plain text export', () => {
    const payload = plainTextToWordModel('first\n\nthird\n', 'Plain')

    expect(payload.blocks).toEqual([
      { type: 'paragraph', text: [{ type: 'text', value: 'first' }] },
      { type: 'paragraph', text: [] },
      { type: 'paragraph', text: [{ type: 'text', value: 'third' }] },
      { type: 'paragraph', text: [] },
    ])
  })

  it('should parse block math and inline math nodes', () => {
    const markdown = [
      'Inline math $E = mc^2$ in a sentence.',
      '',
      '$$',
      '\\frac{a}{b}',
      '$$',
    ].join('\n')

    const payload = markdownToWordModel(markdown, 'Math')

    expect(payload.blocks[0]).toEqual({
      type: 'paragraph',
      text: [
        { type: 'text', value: 'Inline math ' },
        expect.objectContaining({ type: 'math', value: 'E = mc^2', mathMl: expect.stringContaining('<math') }),
        { type: 'text', value: ' in a sentence.' },
      ],
    })
    expect(payload.blocks[1]).toEqual(
      expect.objectContaining({
        type: 'math',
        content: '\\frac{a}{b}',
        mathMl: expect.stringContaining('<mfrac>'),
      }),
    )
  })

  it('should support standard latex delimiters for inline and block math', () => {
    const payload = markdownToWordModel([
      'Inline \\(E = mc^2\\) example.',
      '',
      '\\[',
      '\\sum_{i=1}^n x^i',
      '\\]',
    ].join('\n'), 'latex-delimiters.md')

    expect(payload.blocks[0]).toEqual({
      type: 'paragraph',
      text: [
        { type: 'text', value: 'Inline ' },
        expect.objectContaining({ type: 'math', value: 'E = mc^2', mathMl: expect.stringContaining('<math') }),
        { type: 'text', value: ' example.' },
      ],
    })

    expect(payload.blocks[1]).toEqual(expect.objectContaining({
      type: 'math',
      content: '\\sum_{i=1}^n x^i',
      mathMl: expect.stringContaining('<munderover>'),
    }))
  })

  it('should map raw html blocks into word structures', () => {
    const markdown = [
      '<h2>HTML Title</h2>',
      '<p>Paragraph with <strong>bold</strong> and <a href="https://example.com/html">link</a>.</p>',
      '<ul><li>First</li><li>Second</li></ul>',
      '<table><tr><th colspan="2">Name</th></tr><tr><td>HTML</td><td>42</td></tr></table>',
      '<img src="docs/images/katex.png" alt="HTML Diagram" />',
    ].join('\n')

    const payload = markdownToWordModel(markdown, 'HTML')

    expect(payload.blocks[0]).toEqual({
      type: 'heading',
      level: 2,
      text: [{ type: 'text', value: 'HTML Title' }],
    })
    expect(payload.blocks[1]).toEqual({
      type: 'paragraph',
      text: [
        { type: 'text', value: 'Paragraph with ' },
        { type: 'text', value: 'bold', bold: true },
        { type: 'text', value: ' and ' },
        { type: 'link', value: 'link', href: 'https://example.com/html' },
        { type: 'text', value: '.' },
      ],
    })
    expect(payload.blocks[2]).toEqual({
      type: 'list',
      ordered: false,
      items: [
        [{ type: 'paragraph', text: [{ type: 'text', value: 'First' }] }],
        [{ type: 'paragraph', text: [{ type: 'text', value: 'Second' }] }],
      ],
    })
    expect(payload.blocks[3]).toEqual({
      type: 'table',
      rows: [
        {
          cells: [
            { blocks: [{ type: 'paragraph', text: [{ type: 'text', value: 'Name' }] }], colSpan: 2 },
          ],
        },
        {
          cells: [
            { blocks: [{ type: 'paragraph', text: [{ type: 'text', value: 'HTML' }] }] },
            { blocks: [{ type: 'paragraph', text: [{ type: 'text', value: '42' }] }] },
          ],
        },
      ],
    })
    expect(payload.blocks[4]).toEqual({
      type: 'image',
      assetId: 'asset_0',
      alt: 'HTML Diagram',
    })
  })

  it('should map html rowspan into continuation cells', () => {
    const payload = markdownToWordModel(
      '<table><tr><td rowspan="2">Merged</td><td>Top</td></tr><tr><td>Bottom</td></tr></table>',
      'RowSpan HTML',
    )

    expect(payload.blocks[0]).toEqual({
      type: 'table',
      rows: [
        {
          cells: [
            { blocks: [{ type: 'paragraph', text: [{ type: 'text', value: 'Merged' }] }], rowSpan: 2 },
            { blocks: [{ type: 'paragraph', text: [{ type: 'text', value: 'Top' }] }] },
          ],
        },
        {
          cells: [
            { blocks: [], mergeContinue: true },
            { blocks: [{ type: 'paragraph', text: [{ type: 'text', value: 'Bottom' }] }] },
          ],
        },
      ],
    })
  })

  it('should map combined colspan and rowspan into a normalized table grid', () => {
    const payload = markdownToWordModel(
      '<table><tr><td rowspan="2" colspan="2">A</td><td>B</td></tr><tr><td>C</td></tr></table>',
      'Cross Span HTML',
    )

    expect(payload.blocks[0]).toEqual({
      type: 'table',
      rows: [
        {
          cells: [
            { blocks: [{ type: 'paragraph', text: [{ type: 'text', value: 'A' }] }], colSpan: 2, rowSpan: 2 },
            { blocks: [{ type: 'paragraph', text: [{ type: 'text', value: 'B' }] }] },
          ],
        },
        {
          cells: [
            { blocks: [], colSpan: 2, mergeContinue: true },
            { blocks: [{ type: 'paragraph', text: [{ type: 'text', value: 'C' }] }] },
          ],
        },
      ],
    })
  })

  it('should map raw html inside markdown paragraphs', () => {
    const payload = markdownToWordModel(
      'Text before <strong>HTML bold</strong> and <a href="https://example.com">HTML link</a> after.',
      'Inline HTML',
    )

    expect(payload.blocks[0]).toEqual({
      type: 'paragraph',
      text: [
        { type: 'text', value: 'Text before ' },
        { type: 'text', value: 'HTML bold', bold: true },
        { type: 'text', value: ' and ' },
        { type: 'link', value: 'HTML link', href: 'https://example.com' },
        { type: 'text', value: ' after.' },
      ],
    })
  })

  it('should map supported inline html styles into text runs', () => {
    const payload = markdownToWordModel(
      '<p><span style="color: #1d4ed8; text-decoration: underline;">Blue underlined</span> and <u>plain underline</u></p>',
      'Styled HTML',
    )

    expect(payload.blocks[0]).toEqual({
      type: 'paragraph',
      text: [
        { type: 'text', value: 'Blue underlined', underline: true, color: '1D4ED8' },
        { type: 'text', value: ' and ' },
        { type: 'text', value: 'plain underline', underline: true },
      ],
    })
  })

  it('should map font and background html styles into text runs', () => {
    const payload = markdownToWordModel(
      '<p><span style="font-size: 18px; font-family: &quot;Microsoft YaHei&quot;, sans-serif; background-color: #fff59d;">Styled font</span></p>',
      'Styled Font HTML',
    )

    expect(payload.blocks[0]).toEqual({
      type: 'paragraph',
      text: [{
        type: 'text',
        value: 'Styled font',
        fontSizePt: 13.5,
        fontFamily: 'Microsoft YaHei',
        backgroundColor: 'FFF59D',
      }],
    })
  })

  it('should map supported paragraph html styles into block style', () => {
    const payload = markdownToWordModel(
      '<p style="text-align: center; line-height: 1.5; margin-bottom: 12pt; background-color: #fff59d; border-left: 1px solid #ef4444; border-top-color: #111827;">Styled paragraph</p>',
      'Styled Paragraph',
    )

    expect(payload.blocks[0]).toEqual({
      type: 'paragraph',
      text: [{ type: 'text', value: 'Styled paragraph' }],
      style: {
        align: 'center',
        lineHeight: 1.5,
        spacingAfterPt: 12,
        backgroundColor: 'FFF59D',
        borderLeftColor: 'EF4444',
        borderTopColor: '111827',
      },
    })
  })

  it('should inherit text color from block html elements', () => {
    const payload = markdownToWordModel(
      '<p style="color:red">段落</p>',
      'Paragraph Color',
    )

    expect(payload.blocks[0]).toEqual({
      type: 'paragraph',
      text: [{ type: 'text', value: '段落', color: 'FF0000' }],
    })
  })

  it('should preserve paragraph background without forcing run background', () => {
    const payload = markdownToWordModel(
      '<p style="background-color: #e0f2fe">段落背景</p>',
      'Paragraph Background',
    )

    expect(payload.blocks[0]).toEqual({
      type: 'paragraph',
      text: [{ type: 'text', value: '段落背景' }],
      style: { backgroundColor: 'E0F2FE' },
    })
  })

  it('should map html image dimensions and table cell background styles', () => {
    const payload = markdownToWordModel(
      [
        '<table style="margin-left: auto; margin-right: auto; width: 80%; max-width: 90%; table-layout: fixed;"><colgroup><col style="width: 30%" /><col style="width: 70%" /></colgroup><tr><td style="background-color: #e0f2fe; text-align: center; border-top: 1px solid #d1d5db; border-right-color: #111827; border-bottom: 1px solid #9ca3af; border-left-color: #2563eb;">Blue Cell</td></tr></table>',
        '<img src="docs/images/katex.png" alt="Sized Diagram" style="width: 50%; max-width: 80%; height: 180px;" />',
      ].join('\n'),
      'Styled HTML Blocks',
    )

    expect(payload.blocks[0]).toEqual({
      type: 'table',
      style: {
        align: 'center',
        widthPercent: 80,
        maxWidthPercent: 90,
        layout: 'fixed',
        columnWidths: [
          { widthPercent: 30 },
          { widthPercent: 70 },
        ],
      },
      rows: [
        {
          cells: [
            {
              blocks: [{ type: 'paragraph', text: [{ type: 'text', value: 'Blue Cell' }] }],
              style: {
                backgroundColor: 'E0F2FE',
                align: 'center',
                borderTopColor: 'D1D5DB',
                borderRightColor: '111827',
                borderBottomColor: '9CA3AF',
                borderLeftColor: '2563EB',
              },
            },
          ],
        },
      ],
    })

    expect(payload.blocks[1]).toEqual({
      type: 'image',
      assetId: 'asset_0',
      alt: 'Sized Diagram',
      widthPercent: 50,
      maxWidthPercent: 80,
      heightPx: 180,
    })
  })
})
