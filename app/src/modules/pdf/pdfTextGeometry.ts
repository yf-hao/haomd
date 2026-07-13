import { Util } from 'pdfjs-dist'
import type { TextContent, TextItem, TextStyle } from 'pdfjs-dist/types/src/display/api'
import type { Rect } from './types/annotation'

export type PageViewportLike = {
  transform: number[]
  width: number
  height: number
}

export type RenderedTextSpan = {
  text: string
  rect: {
    left: number
    top: number
    right: number
    bottom: number
    width: number
    height: number
  }
}

export type TextGeometryToken = {
  text: string
  rect: Rect
  lineIndex: number
  tokenIndex: number
  globalIndex: number
  isWhitespace: boolean
}

export type TextGeometryLine = {
  index: number
  tokens: TextGeometryToken[]
  top: number
  bottom: number
  left: number
  right: number
  centerY: number
  height: number
}

export type TextGeometryIndex = {
  pageWidth: number
  pageHeight: number
  lines: TextGeometryLine[]
  tokens: TextGeometryToken[]
}

export type GeometryHit = {
  lineIndex: number
  tokenIndex: number
  token: TextGeometryToken
}

export type GeometrySelectionRange = {
  start: GeometryHit
  end: GeometryHit
}

type IndexedToken = {
  text: string
  rect: Rect
  lineIndex: number
  tokenIndex: number
  isWhitespace: boolean
}

const WORD_SEGMENTER =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter !== 'undefined'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function isTextItem(item: TextItem | { type: string }): item is TextItem {
  return typeof (item as TextItem).str === 'string'
}

function isWhitespace(text: string) {
  return /^\s+$/u.test(text)
}

function segmentText(text: string) {
  const segments: string[] = []

  if (WORD_SEGMENTER) {
    for (const item of WORD_SEGMENTER.segment(text)) {
      if (item.segment) {
        segments.push(item.segment)
      }
    }
    return segments
  }

  for (const char of Array.from(text)) {
    segments.push(char)
  }
  return segments
}

function getAscentRatio(style: TextStyle | undefined) {
  if (!style) return 0.8
  if (Number.isFinite(style.ascent)) return style.ascent
  if (Number.isFinite(style.descent)) return 1 + style.descent
  return 0.8
}

function toRect(left: number, top: number, right: number, bottom: number): Rect {
  return {
    x1: left,
    y1: top,
    x2: right,
    y2: bottom,
  }
}

function toNormalizedRect(rect: Rect, pageWidth: number, pageHeight: number): Rect {
  if (pageWidth <= 0 || pageHeight <= 0) {
    return rect
  }

  return {
    x1: clamp(rect.x1 / pageWidth, 0, 1),
    y1: clamp(rect.y1 / pageHeight, 0, 1),
    x2: clamp(rect.x2 / pageWidth, 0, 1),
    y2: clamp(rect.y2 / pageHeight, 0, 1),
  }
}

function getItemRect(item: TextItem, viewport: PageViewportLike, style: TextStyle | undefined): Rect | null {
  if (!item.str) return null

  const tx = Util.transform(viewport.transform, item.transform)
  const angle = Math.atan2(tx[1], tx[0])
  const fontHeight = Math.max(0, Math.hypot(tx[2], tx[3]))
  if (fontHeight <= 0 || !Number.isFinite(fontHeight)) return null

  const ascent = getAscentRatio(style)
  const fontAscent = fontHeight * ascent
  const left = angle === 0 ? tx[4] : tx[4] + fontAscent * Math.sin(angle)
  const top = angle === 0 ? tx[5] - fontAscent : tx[5] - fontAscent * Math.cos(angle)
  const width = Math.max(0, item.width)
  const height = fontHeight

  if (width <= 0 || height <= 0) return null

  return toRect(left, top, left + width, top + height)
}

function splitItemIntoTokens(
  item: TextItem,
  rect: Rect,
  lineIndex: number,
  pageWidth: number,
  pageHeight: number,
): IndexedToken[] {
  const segments = segmentText(item.str)
  if (segments.length === 0) return []

  const totalLength = Math.max(segments.reduce((total, segment) => total + Math.max(segment.length, 1), 0), 1)
  const width = rect.x2 - rect.x1
  const tokenRects: IndexedToken[] = []

  let consumed = 0
  for (let index = 0; index < segments.length; index += 1) {
    const text = segments[index]
    const segmentLength = Math.max(text.length, 1)
    const nextConsumed = consumed + segmentLength
    const startRatio = consumed / totalLength
    const endRatio = nextConsumed / totalLength

    const startX = item.dir === 'rtl'
      ? rect.x2 - width * endRatio
      : rect.x1 + width * startRatio
    const endX = item.dir === 'rtl'
      ? rect.x2 - width * startRatio
      : rect.x1 + width * endRatio

    tokenRects.push({
      text,
      rect: toNormalizedRect(toRect(Math.min(startX, endX), rect.y1, Math.max(startX, endX), rect.y2), pageWidth, pageHeight),
      lineIndex,
      tokenIndex: index,
      isWhitespace: isWhitespace(text),
    })

    consumed = nextConsumed
  }

  return tokenRects
}

function buildLines(tokens: IndexedToken[]) {
  if (tokens.length === 0) return []

  const sorted = [...tokens].sort((left, right) => {
    if (Math.abs(left.rect.y1 - right.rect.y1) > 0.004) return left.rect.y1 - right.rect.y1
    return left.rect.x1 - right.rect.x1
  })

  const lines: { tokens: IndexedToken[]; top: number; bottom: number; left: number; right: number; height: number; centerY: number }[] = []

  for (const token of sorted) {
    const height = Math.max(token.rect.y2 - token.rect.y1, 0.0001)
    const centerY = (token.rect.y1 + token.rect.y2) / 2
    const lastLine = lines.at(-1)

    if (!lastLine) {
      lines.push({
        tokens: [token],
        top: token.rect.y1,
        bottom: token.rect.y2,
        left: token.rect.x1,
        right: token.rect.x2,
        height,
        centerY,
      })
      continue
    }

    const lineHeight = Math.max(lastLine.height, height)
    const lineGap = Math.abs(centerY - lastLine.centerY)
    if (lineGap > Math.max(0.012, lineHeight * 0.7)) {
      lines.push({
        tokens: [token],
        top: token.rect.y1,
        bottom: token.rect.y2,
        left: token.rect.x1,
        right: token.rect.x2,
        height,
        centerY,
      })
      continue
    }

    lastLine.tokens.push(token)
    lastLine.top = Math.min(lastLine.top, token.rect.y1)
    lastLine.bottom = Math.max(lastLine.bottom, token.rect.y2)
    lastLine.left = Math.min(lastLine.left, token.rect.x1)
    lastLine.right = Math.max(lastLine.right, token.rect.x2)
    lastLine.height = (lastLine.height * (lastLine.tokens.length - 1) + height) / lastLine.tokens.length
    lastLine.centerY = (lastLine.top + lastLine.bottom) / 2
  }

  return lines.map((line, index) => ({
    ...line,
    index,
    tokens: [...line.tokens].sort((left, right) => left.rect.x1 - right.rect.x1),
  }))
}

function findLineAtPoint(lines: TextGeometryLine[], point: { x: number; y: number }) {
  const containing = lines.find((line) => point.y >= line.top && point.y <= line.bottom)
  if (containing) return containing

  return lines.reduce<TextGeometryLine | null>((closest, line) => {
    if (!closest) return line
    const currentDistance = Math.abs(point.y - line.centerY)
    const closestDistance = Math.abs(point.y - closest.centerY)
    return currentDistance < closestDistance ? line : closest
  }, null)
}

export function buildTextGeometryIndex(
  textContent: TextContent,
  viewport: PageViewportLike,
): TextGeometryIndex {
  const indexedTokens: IndexedToken[] = []

  for (const item of textContent.items) {
    if (!isTextItem(item) || item.str.length === 0) {
      continue
    }
    const style = textContent.styles[item.fontName]
    const rect = getItemRect(item, viewport, style)
    if (!rect) continue
    const itemTokens = splitItemIntoTokens(item, rect, indexedTokens.length, viewport.width, viewport.height)
    indexedTokens.push(...itemTokens)
  }

  const rawLines = buildLines(indexedTokens)
  const tokens: TextGeometryToken[] = []
  const lines: TextGeometryLine[] = []

  for (const line of rawLines) {
    const lineTokens: TextGeometryToken[] = []
    for (const token of line.tokens) {
      const nextToken: TextGeometryToken = {
        ...token,
        lineIndex: line.index,
        tokenIndex: lineTokens.length,
        globalIndex: tokens.length,
      }
      lineTokens.push(nextToken)
      tokens.push(nextToken)
    }

    lines.push({
      index: line.index,
      tokens: lineTokens,
      top: line.top,
      bottom: line.bottom,
      left: line.left,
      right: line.right,
      centerY: line.centerY,
      height: line.height,
    })
  }

  return {
    pageWidth: viewport.width,
    pageHeight: viewport.height,
    lines,
    tokens,
  }
}

export function buildTextGeometryIndexFromSpans(
  spans: readonly RenderedTextSpan[],
  pageWidth: number,
  pageHeight: number,
): TextGeometryIndex {
  const indexedTokens: IndexedToken[] = []

  for (const span of spans) {
    if (!span.text || span.rect.width <= 0 || span.rect.height <= 0) continue
    const segments = segmentText(span.text)
    if (segments.length === 0) continue

    const totalLength = Math.max(
      segments.reduce((total, segment) => total + Math.max(segment.length, 1), 0),
      1,
    )
    let consumed = 0
    for (const [index, text] of segments.entries()) {
      const segmentLength = Math.max(text.length, 1)
      const nextConsumed = consumed + segmentLength
      const startRatio = consumed / totalLength
      const endRatio = nextConsumed / totalLength
      const startX = span.rect.left + span.rect.width * startRatio
      const endX = span.rect.left + span.rect.width * endRatio
      indexedTokens.push({
        text,
        rect: toNormalizedRect(
          toRect(Math.min(startX, endX), span.rect.top, Math.max(startX, endX), span.rect.bottom),
          pageWidth,
          pageHeight,
        ),
        lineIndex: indexedTokens.length,
        tokenIndex: index,
        isWhitespace: isWhitespace(text),
      })
      consumed = nextConsumed
    }
  }

  const rawLines = buildLines(indexedTokens)
  const tokens: TextGeometryToken[] = []
  const lines: TextGeometryLine[] = []

  for (const line of rawLines) {
    const lineTokens: TextGeometryToken[] = []
    for (const token of line.tokens) {
      const nextToken: TextGeometryToken = {
        ...token,
        lineIndex: line.index,
        tokenIndex: lineTokens.length,
        globalIndex: tokens.length,
      }
      lineTokens.push(nextToken)
      tokens.push(nextToken)
    }
    lines.push({
      index: line.index,
      tokens: lineTokens,
      top: line.top,
      bottom: line.bottom,
      left: line.left,
      right: line.right,
      centerY: line.centerY,
      height: line.height,
    })
  }

  return {
    pageWidth,
    pageHeight,
    lines,
    tokens,
  }
}

export function findGeometryHit(
  index: TextGeometryIndex,
  point: { x: number; y: number },
): GeometryHit | null {
  if (index.lines.length === 0) return null

  const line = findLineAtPoint(index.lines, point)
  if (!line) return null

  const selectableTokens = line.tokens.filter((token) => !token.isWhitespace)
  if (selectableTokens.length === 0) return null

  const insideToken = selectableTokens.find(
    (token) =>
      point.x >= token.rect.x1 &&
      point.x <= token.rect.x2 &&
      point.y >= token.rect.y1 &&
      point.y <= token.rect.y2,
  )
  if (insideToken) {
    return {
      lineIndex: line.index,
      tokenIndex: insideToken.tokenIndex,
      token: insideToken,
    }
  }

  const leftOfPoint = [...selectableTokens]
    .reverse()
    .find((token) => token.rect.x1 <= point.x || token.rect.x2 <= point.x)
  const token = leftOfPoint ?? selectableTokens[0]

  return {
    lineIndex: line.index,
    tokenIndex: token.tokenIndex,
    token,
  }
}

export function expandHitToWord(index: TextGeometryIndex, hit: GeometryHit): GeometrySelectionRange | null {
  const line = index.lines[hit.lineIndex]
  if (!line) return null
  const tokens = line.tokens
  if (tokens.length === 0) return null

  let start = hit.tokenIndex
  let end = hit.tokenIndex

  while (start > 0 && !tokens[start - 1].isWhitespace) start -= 1
  while (end < tokens.length - 1 && !tokens[end + 1].isWhitespace) end += 1

  return {
    start: {
      lineIndex: line.index,
      tokenIndex: start,
      token: tokens[start],
    },
    end: {
      lineIndex: line.index,
      tokenIndex: end,
      token: tokens[end],
    },
  }
}

function canJoinLines(previous: TextGeometryLine, next: TextGeometryLine) {
  const verticalGap = next.top - previous.bottom
  const lineHeight = Math.max(previous.height, next.height)
  const beginsIndentedBlock = next.left - previous.left > Math.max(0.01, lineHeight * 0.75)
  return verticalGap <= Math.max(0.01, lineHeight * 0.9) && !beginsIndentedBlock
}

export function expandHitToParagraph(index: TextGeometryIndex, hit: GeometryHit): GeometrySelectionRange | null {
  const line = index.lines[hit.lineIndex]
  if (!line) return null

  let firstIndex = line.index
  let lastIndex = line.index

  while (firstIndex > 0 && canJoinLines(index.lines[firstIndex - 1], index.lines[firstIndex])) {
    firstIndex -= 1
  }
  while (lastIndex < index.lines.length - 1 && canJoinLines(index.lines[lastIndex], index.lines[lastIndex + 1])) {
    lastIndex += 1
  }

  const firstLine = index.lines[firstIndex]
  const lastLine = index.lines[lastIndex]
  const firstToken = firstLine.tokens.find((token) => !token.isWhitespace) ?? firstLine.tokens[0]
  const lastToken = [...lastLine.tokens].reverse().find((token) => !token.isWhitespace) ?? lastLine.tokens.at(-1)

  if (!firstToken || !lastToken) return null

  return {
    start: {
      lineIndex: firstLine.index,
      tokenIndex: firstToken.tokenIndex,
      token: firstToken,
    },
    end: {
      lineIndex: lastLine.index,
      tokenIndex: lastToken.tokenIndex,
      token: lastToken,
    },
  }
}

export function expandSelectionRange(
  _index: TextGeometryIndex,
  startHit: GeometryHit,
  endHit: GeometryHit,
): GeometrySelectionRange | null {
  const startOrder = startHit.token.globalIndex
  const endOrder = endHit.token.globalIndex

  if (startOrder <= endOrder) {
    return { start: startHit, end: endHit }
  }

  return { start: endHit, end: startHit }
}

export function getSelectedTokens(index: TextGeometryIndex, range: GeometrySelectionRange) {
  const startOrder = range.start.token.globalIndex
  const endOrder = range.end.token.globalIndex
  return index.tokens.slice(startOrder, endOrder + 1)
}

export function rangeToText(index: TextGeometryIndex, range: GeometrySelectionRange) {
  const selectedTokens = getSelectedTokens(index, range)
  if (selectedTokens.length === 0) return ''

  let text = ''
  let previousLineIndex = selectedTokens[0].lineIndex
  for (const token of selectedTokens) {
    if (token.lineIndex !== previousLineIndex) {
      if (text && !/\s$/u.test(text)) {
        text += '\n'
      }
      previousLineIndex = token.lineIndex
    }
    text += token.text
  }

  return text.trim()
}

export function rangeToRects(index: TextGeometryIndex, range: GeometrySelectionRange): Rect[] {
  const selectedTokens = getSelectedTokens(index, range)
  return selectedTokens
    .filter((token) => !token.isWhitespace)
    .map((token) => token.rect)
}

export function pointInTextGeometry(index: TextGeometryIndex, point: { x: number; y: number }) {
  return findGeometryHit(index, point)
}
