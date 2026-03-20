import { describe, expect, it } from 'vitest'
import { normalizeWordColor, parseHtmlImageSize, parseHtmlParagraphStyle, parseHtmlTableCellStyle, parseHtmlTableStyle, parseHtmlTextStyle } from './htmlStyleParser'

describe('export/word - htmlStyleParser', () => {
  it('should normalize named, hex, and rgb colors', () => {
    expect(normalizeWordColor('red')).toBe('FF0000')
    expect(normalizeWordColor('#1d4ed8')).toBe('1D4ED8')
    expect(normalizeWordColor('#f00')).toBe('FF0000')
    expect(normalizeWordColor('rgb(29, 78, 216)')).toBe('1D4ED8')
  })

  it('should parse supported html text styles', () => {
    expect(
      parseHtmlTextStyle('span', {
        style: 'color: #1d4ed8; background-color: rgb(255, 255, 0); text-decoration: underline line-through; font-style: italic; font-size: 18px; font-family: "Microsoft YaHei", sans-serif;',
      }),
    ).toEqual({
      color: '1D4ED8',
      backgroundColor: 'FFFF00',
      underline: true,
      strike: true,
      italic: true,
      fontSizePt: 13.5,
      fontFamily: 'Microsoft YaHei',
    })
  })

  it('should parse supported paragraph styles', () => {
    expect(
      parseHtmlParagraphStyle({
        style: 'text-align: center; line-height: 1.5; margin-bottom: 12pt; background-color: #fff59d; border-left: 1px solid #ef4444; border-top-color: #111827;',
      }),
    ).toEqual({
      align: 'center',
      lineHeight: 1.5,
      spacingAfterPt: 12,
      backgroundColor: 'FFF59D',
      borderLeftColor: 'EF4444',
      borderTopColor: '111827',
    })
  })

  it('should parse image dimensions and table cell background styles', () => {
    expect(
      parseHtmlImageSize({
        style: 'width: 50%; max-width: 320px; height: 180px;',
      }),
    ).toEqual({
      widthPercent: 50,
      heightPx: 180,
    })

    expect(
      parseHtmlTableCellStyle({
        style: 'background-color: #e0f2fe; text-align: center; border-top: 1px solid #d1d5db; border-right-color: #111827; border-bottom: 1px solid #9ca3af; border-left-color: #2563eb;',
      }),
    ).toEqual({
      backgroundColor: 'E0F2FE',
      align: 'center',
      borderTopColor: 'D1D5DB',
      borderRightColor: '111827',
      borderBottomColor: '9CA3AF',
      borderLeftColor: '2563EB',
    })

    expect(
      parseHtmlTableStyle({
        style: 'margin-left: auto; margin-right: auto; width: 80%; max-width: 90%; table-layout: fixed;',
      }),
    ).toEqual({
      align: 'center',
      widthPercent: 80,
      maxWidthPercent: 90,
      layout: 'fixed',
    })

    expect(
      parseHtmlTableStyle({
        style: 'table-layout: auto;',
      }),
    ).toEqual({
      layout: 'auto',
    })
  })
})
