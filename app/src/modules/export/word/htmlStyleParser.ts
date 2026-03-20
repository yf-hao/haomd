export type HtmlTextStyle = {
  bold?: boolean
  italic?: boolean
  code?: boolean
  strike?: boolean
  underline?: boolean
  color?: string
  backgroundColor?: string
  fontSizePt?: number
  fontFamily?: string
}

export type HtmlParagraphStyle = {
  align?: 'left' | 'center' | 'right' | 'justify'
  lineHeight?: number
  spacingAfterPt?: number
  backgroundColor?: string
  borderColor?: string
  borderTopColor?: string
  borderRightColor?: string
  borderBottomColor?: string
  borderLeftColor?: string
}

export type HtmlTableCellStyle = {
  backgroundColor?: string
  align?: 'left' | 'center' | 'right' | 'justify'
  borderColor?: string
  borderTopColor?: string
  borderRightColor?: string
  borderBottomColor?: string
  borderLeftColor?: string
}

export type HtmlTableStyle = {
  align?: 'left' | 'center' | 'right'
  widthPercent?: number
  widthPx?: number
  maxWidthPercent?: number
  layout?: 'fixed' | 'auto'
}

const NAMED_COLORS: Record<string, string> = {
  black: '000000',
  white: 'FFFFFF',
  red: 'FF0000',
  blue: '0000FF',
  green: '008000',
  yellow: 'FFFF00',
  gray: '808080',
  grey: '808080',
  orange: 'FFA500',
  purple: '800080',
}

export function parseHtmlTextStyle(
  tagName: string,
  attrs: Record<string, string>,
): HtmlTextStyle {
  const style: HtmlTextStyle = {}
  const tag = tagName.toLowerCase()

  if (tag === 'strong' || tag === 'b') style.bold = true
  if (tag === 'em' || tag === 'i') style.italic = true
  if (tag === 'del' || tag === 's') style.strike = true
  if (tag === 'u') style.underline = true
  if (tag === 'code') style.code = true

  if (tag === 'font' && attrs.color) {
    const normalized = normalizeWordColor(attrs.color)
    if (normalized) style.color = normalized
  }

  const inlineStyle = attrs.style
  if (!inlineStyle) return style

  const declarations = parseStyleDeclarations(inlineStyle)
  if (declarations['font-weight']) {
    const weight = declarations['font-weight'].toLowerCase()
    if (weight === 'bold' || Number(weight) >= 600) style.bold = true
  }
  if (declarations['font-style']?.toLowerCase() === 'italic') {
    style.italic = true
  }
  if (declarations['text-decoration']) {
    const value = declarations['text-decoration'].toLowerCase()
    if (value.includes('underline')) style.underline = true
    if (value.includes('line-through')) style.strike = true
  }
  if (declarations.color) {
    const normalized = normalizeWordColor(declarations.color)
    if (normalized) style.color = normalized
  }
  if (declarations['background-color']) {
    const normalized = normalizeWordColor(declarations['background-color'])
    if (normalized) style.backgroundColor = normalized
  }
  if (declarations['font-size']) {
    const fontSizePt = parsePtLikeValue(declarations['font-size'])
    if (typeof fontSizePt === 'number' && fontSizePt > 0) {
      style.fontSizePt = fontSizePt
    }
  }
  if (declarations['font-family']) {
    const fontFamily = parseFontFamily(declarations['font-family'])
    if (fontFamily) style.fontFamily = fontFamily
  }

  return style
}

export function parseHtmlParagraphStyle(
  attrs: Record<string, string>,
): HtmlParagraphStyle {
  const inlineStyle = attrs.style
  if (!inlineStyle) return {}

  const declarations = parseStyleDeclarations(inlineStyle)
  const style: HtmlParagraphStyle = {}

  if (declarations['text-align']) {
    const align = declarations['text-align'].toLowerCase()
    if (align === 'left' || align === 'center' || align === 'right' || align === 'justify') {
      style.align = align
    }
  }

  if (declarations['line-height']) {
    const lineHeight = parseLineHeight(declarations['line-height'])
    if (lineHeight) style.lineHeight = lineHeight
  }

  if (declarations['margin-bottom']) {
    const spacingAfterPt = parsePtLikeValue(declarations['margin-bottom'])
    if (typeof spacingAfterPt === 'number') style.spacingAfterPt = spacingAfterPt
  }
  if (declarations['background-color']) {
    const normalized = normalizeWordColor(declarations['background-color'])
    if (normalized) style.backgroundColor = normalized
  }
  if (declarations.border) {
    const normalized = parseBorderColor(declarations.border)
    if (normalized) style.borderColor = normalized
  }
  if (declarations['border-top']) {
    const normalized = parseBorderColor(declarations['border-top'])
    if (normalized) style.borderTopColor = normalized
  }
  if (declarations['border-right']) {
    const normalized = parseBorderColor(declarations['border-right'])
    if (normalized) style.borderRightColor = normalized
  }
  if (declarations['border-bottom']) {
    const normalized = parseBorderColor(declarations['border-bottom'])
    if (normalized) style.borderBottomColor = normalized
  }
  if (declarations['border-left']) {
    const normalized = parseBorderColor(declarations['border-left'])
    if (normalized) style.borderLeftColor = normalized
  }
  if (declarations['border-color']) {
    const normalized = normalizeWordColor(declarations['border-color'])
    if (normalized) style.borderColor = normalized
  }
  if (declarations['border-top-color']) {
    const normalized = normalizeWordColor(declarations['border-top-color'])
    if (normalized) style.borderTopColor = normalized
  }
  if (declarations['border-right-color']) {
    const normalized = normalizeWordColor(declarations['border-right-color'])
    if (normalized) style.borderRightColor = normalized
  }
  if (declarations['border-bottom-color']) {
    const normalized = normalizeWordColor(declarations['border-bottom-color'])
    if (normalized) style.borderBottomColor = normalized
  }
  if (declarations['border-left-color']) {
    const normalized = normalizeWordColor(declarations['border-left-color'])
    if (normalized) style.borderLeftColor = normalized
  }

  return style
}

export function parseHtmlTableCellStyle(
  attrs: Record<string, string>,
): HtmlTableCellStyle {
  const style: HtmlTableCellStyle = {}

  if (attrs.bgcolor) {
    const normalized = normalizeWordColor(attrs.bgcolor)
    if (normalized) style.backgroundColor = normalized
  }

  const inlineStyle = attrs.style
  if (!inlineStyle) return style

  const declarations = parseStyleDeclarations(inlineStyle)
  if (declarations['background-color']) {
    const normalized = normalizeWordColor(declarations['background-color'])
    if (normalized) style.backgroundColor = normalized
  }
  if (declarations.border) {
    const normalized = parseBorderColor(declarations.border)
    if (normalized) style.borderColor = normalized
  }
  if (declarations['border-top']) {
    const normalized = parseBorderColor(declarations['border-top'])
    if (normalized) style.borderTopColor = normalized
  }
  if (declarations['border-right']) {
    const normalized = parseBorderColor(declarations['border-right'])
    if (normalized) style.borderRightColor = normalized
  }
  if (declarations['border-bottom']) {
    const normalized = parseBorderColor(declarations['border-bottom'])
    if (normalized) style.borderBottomColor = normalized
  }
  if (declarations['border-left']) {
    const normalized = parseBorderColor(declarations['border-left'])
    if (normalized) style.borderLeftColor = normalized
  }
  if (declarations['border-color']) {
    const normalized = normalizeWordColor(declarations['border-color'])
    if (normalized) style.borderColor = normalized
  }
  if (declarations['border-top-color']) {
    const normalized = normalizeWordColor(declarations['border-top-color'])
    if (normalized) style.borderTopColor = normalized
  }
  if (declarations['border-right-color']) {
    const normalized = normalizeWordColor(declarations['border-right-color'])
    if (normalized) style.borderRightColor = normalized
  }
  if (declarations['border-bottom-color']) {
    const normalized = normalizeWordColor(declarations['border-bottom-color'])
    if (normalized) style.borderBottomColor = normalized
  }
  if (declarations['border-left-color']) {
    const normalized = normalizeWordColor(declarations['border-left-color'])
    if (normalized) style.borderLeftColor = normalized
  }
  if (declarations['text-align']) {
    const align = declarations['text-align'].toLowerCase()
    if (align === 'left' || align === 'center' || align === 'right' || align === 'justify') {
      style.align = align
    }
  }

  return style
}

export function parseHtmlTableStyle(
  attrs: Record<string, string>,
): HtmlTableStyle {
  const style: HtmlTableStyle = {}
  const inlineStyle = attrs.style
  const declarations = inlineStyle ? parseStyleDeclarations(inlineStyle) : {}
  if (declarations['margin-left'] === 'auto' && declarations['margin-right'] === 'auto') {
    style.align = 'center'
  } else if (declarations['margin-left'] === 'auto') {
    style.align = 'right'
  } else if (declarations['margin-right'] === 'auto') {
    style.align = 'left'
  }

  const widthPercent = parsePercentage(declarations.width ?? attrs.width)
  const widthPx = parseImageDimension(declarations.width ?? attrs.width)
  const maxWidthPercent = parsePercentage(declarations['max-width'])

  if (typeof widthPercent === 'number') style.widthPercent = widthPercent
  else if (typeof widthPx === 'number') style.widthPx = widthPx

  if (typeof maxWidthPercent === 'number') style.maxWidthPercent = maxWidthPercent

  if (declarations['table-layout']) {
    const layout = declarations['table-layout'].toLowerCase()
    if (layout === 'fixed' || layout === 'auto') {
      style.layout = layout
    }
  }

  return style
}

export function parseHtmlImageSize(attrs: Record<string, string>): {
  widthPx?: number
  heightPx?: number
  widthPercent?: number
  maxWidthPercent?: number
} {
  const size: {
    widthPx?: number
    heightPx?: number
    widthPercent?: number
    maxWidthPercent?: number
  } = {}

  const style = attrs.style ? parseStyleDeclarations(attrs.style) : {}
  const width = parseImageDimension(style.width ?? attrs.width)
  const height = parseImageDimension(style.height ?? attrs.height)
  const widthPercent = parsePercentage(style.width ?? attrs.width)
  const maxWidthPercent = parsePercentage(style['max-width'])

  if (typeof width === 'number') size.widthPx = width
  if (typeof height === 'number') size.heightPx = height
  if (typeof widthPercent === 'number') size.widthPercent = widthPercent
  if (typeof maxWidthPercent === 'number') size.maxWidthPercent = maxWidthPercent

  return size
}

export function normalizeWordColor(input: string): string | undefined {
  const value = input.trim().toLowerCase()
  if (!value) return undefined

  if (/^#[0-9a-f]{6}$/.test(value)) {
    return value.slice(1).toUpperCase()
  }
  if (/^#[0-9a-f]{3}$/.test(value)) {
    return value
      .slice(1)
      .split('')
      .map((char) => char + char)
      .join('')
      .toUpperCase()
  }

  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(value)
  if (rgb) {
    const [r, g, b] = rgb.slice(1).map((part) => clampColorValue(Number(part)))
    return [r, g, b]
      .map((part) => part.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  }

  return NAMED_COLORS[value]
}

function parseStyleDeclarations(style: string): Record<string, string> {
  const declarations: Record<string, string> = {}
  for (const rawDeclaration of style.split(';')) {
    const separatorIndex = rawDeclaration.indexOf(':')
    if (separatorIndex <= 0) continue
    const property = rawDeclaration.slice(0, separatorIndex).trim().toLowerCase()
    const value = rawDeclaration.slice(separatorIndex + 1).trim()
    if (!property || !value) continue
    declarations[property] = value
  }
  return declarations
}

function parseLineHeight(value: string): number | undefined {
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return undefined
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
  }
  return undefined
}

function parsePtLikeValue(value: string): number | undefined {
  const trimmed = value.trim().toLowerCase()
  const ptMatch = /^(\d+(\.\d+)?)pt$/.exec(trimmed)
  if (ptMatch) return Number(ptMatch[1])

  const pxMatch = /^(\d+(\.\d+)?)px$/.exec(trimmed)
  if (pxMatch) {
    return Number(pxMatch[1]) * 0.75
  }

  return undefined
}

function parseImageDimension(value: string | undefined): number | undefined {
  if (!value) return undefined
  const trimmed = value.trim().toLowerCase()
  if (!trimmed || trimmed === 'auto') return undefined

  const plainMatch = /^(\d+(\.\d+)?)$/.exec(trimmed)
  if (plainMatch) return Math.max(1, Math.round(Number(plainMatch[1])))

  const pxMatch = /^(\d+(\.\d+)?)px$/.exec(trimmed)
  if (pxMatch) return Math.max(1, Math.round(Number(pxMatch[1])))

  const ptMatch = /^(\d+(\.\d+)?)pt$/.exec(trimmed)
  if (ptMatch) return Math.max(1, Math.round(Number(ptMatch[1]) * (96 / 72)))

  return undefined
}

function parsePercentage(value: string | undefined): number | undefined {
  if (!value) return undefined
  const trimmed = value.trim().toLowerCase()
  const match = /^(\d+(\.\d+)?)%$/.exec(trimmed)
  if (!match) return undefined
  const percent = Number(match[1])
  if (!Number.isFinite(percent) || percent <= 0) return undefined
  return Math.min(100, percent)
}

function parseBorderColor(value: string): string | undefined {
  const tokens = value
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)

  for (const token of tokens) {
    const normalized = normalizeWordColor(token)
    if (normalized) return normalized
  }

  return undefined
}

function clampColorValue(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(255, Math.round(value)))
}

function parseFontFamily(value: string): string | undefined {
  const first = value
    .split(',')
    .map((part) => part.trim())
    .find(Boolean)

  if (!first) return undefined

  return first.replace(/^['"]|['"]$/g, '').trim() || undefined
}
