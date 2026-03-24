import MindElixir, { SIDE } from 'mind-elixir'
import type { WordBlock, WordDocPayload } from './types'
import { renderMermaidToSvg } from '../../visualization/mermaidRenderer'

type MindNode = { title: string; children?: MindNode[] }
type MindElixirData = {
  nodeData: { id: string; topic: string; children?: MindElixirData['nodeData'][] }
  direction?: 0 | 1 | 2
}

export async function renderWordDiagramAssets(options: {
  payload: WordDocPayload
  setStatusMessage?: (msg: string) => void
}): Promise<WordDocPayload> {
  const { payload, setStatusMessage } = options
  let assetCounter = payload.assets.length
  const nextAssets = [...payload.assets]

  const replaceBlocks = async (blocks: WordBlock[]): Promise<WordBlock[]> => {
    const output: WordBlock[] = []
    for (const block of blocks) {
      if (block.type === 'code' && block.language) {
        const lang = block.language.trim().toLowerCase()
        const normalizedContent = block.content.trim()
        if (lang === 'mermaid') {
          setStatusMessage?.('正在渲染 Mermaid 图表...')
          const rendered = await renderMermaidBlockToPng(normalizedContent)
          if (!rendered) throw new Error(`Mermaid 图表渲染失败: ${summarizeDiagramBlock(normalizedContent)}`)

          const assetId = `asset_${assetCounter++}`
          nextAssets.push({
            id: assetId,
            kind: 'embedded-image',
            fileName: `${assetId}.png`,
            mimeType: 'image/png',
            base64Data: rendered.base64Data,
            widthPx: rendered.widthPx,
            heightPx: rendered.heightPx,
          })
          output.push({
            type: 'image',
            assetId,
            alt: 'Mermaid Diagram',
            widthPx: rendered.widthPx,
            heightPx: rendered.heightPx,
          })
          continue
        }
        if (lang === 'mind') {
          setStatusMessage?.('正在渲染思维导图...')
          const rendered = await renderMindBlockToPng(normalizedContent)
          if (!rendered) throw new Error(`思维导图渲染失败: ${summarizeDiagramBlock(normalizedContent)}`)

          const assetId = `asset_${assetCounter++}`
          nextAssets.push({
            id: assetId,
            kind: 'embedded-image',
            fileName: `${assetId}.png`,
            mimeType: 'image/png',
            base64Data: rendered.base64Data,
            widthPx: rendered.widthPx,
            heightPx: rendered.heightPx,
          })
          output.push({
            type: 'image',
            assetId,
            alt: 'Mind Diagram',
            widthPx: rendered.widthPx,
            heightPx: rendered.heightPx,
          })
          continue
        }
      }

      if (block.type === 'blockquote') {
        output.push({
          ...block,
          children: await replaceBlocks(block.children),
        })
        continue
      }

      if (block.type === 'list') {
        output.push({
          ...block,
          items: await Promise.all(block.items.map((item) => replaceBlocks(item))),
        })
        continue
      }

      if (block.type === 'table') {
        output.push({
          ...block,
          rows: await Promise.all(
            block.rows.map(async (row) => ({
              cells: await Promise.all(row.cells.map(async (cell) => ({
                ...cell,
                blocks: await replaceBlocks(cell.blocks),
              }))),
            })),
          ),
        })
        continue
      }

      output.push(block)
    }
    return output
  }

  const blocks = await replaceBlocks(payload.blocks)
  return {
    ...payload,
    blocks,
    assets: nextAssets,
  }
}

function summarizeDiagramBlock(content: string): string {
  const firstLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
  return firstLine ? firstLine.slice(0, 80) : '空图表'
}

async function renderMermaidBlockToPng(code: string): Promise<{ base64Data: string; widthPx: number; heightPx: number } | null> {
  try {
    const svg = await renderMermaidBlockToSvg(code)
    if (!svg) return null
    return await svgToPng(svg)
  } catch (error) {
    console.warn('[WordExport] Mermaid render failed', error)
    throw new Error(`Mermaid 图表渲染失败: ${extractErrorMessage(error)}`)
  }
}

async function renderMermaidBlockToSvg(code: string): Promise<string | null> {
  return await renderMermaidToSvg(
    code,
    `mermaid-export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    { profile: 'export' },
  )
}

async function renderMindBlockToPng(code: string): Promise<{ base64Data: string; widthPx: number; heightPx: number } | null> {
  try {
    const svg = await renderMindBlockToSvg(code)
    if (!svg) return null
    return await svgToPng(svg)
  } catch (error) {
    console.warn('[WordExport] Mind render failed', error)
    return null
  }
}

function extractErrorMessage(error: unknown): string {
  if (!error) return '未知错误'
  if (typeof error === 'string') return error
  if (error instanceof Error && error.message) return error.message

  if (typeof error === 'object') {
    const record = error as Record<string, unknown>

    const directMessage = firstNonEmptyString(
      record.message,
      record.error,
      record.str,
      record.details,
    )
    if (directMessage) return directMessage

    const hash = record.hash
    if (hash && typeof hash === 'object') {
      const hashRecord = hash as Record<string, unknown>
      const hashMessage = firstNonEmptyString(
        hashRecord.message,
        hashRecord.text,
        hashRecord.str,
      )
      if (hashMessage) return hashMessage
    }

    try {
      const serialized = JSON.stringify(error)
      if (serialized && serialized !== '{}') return serialized
    } catch {
      // ignore and fall through to String(error)
    }
  }

  const fallback = String(error)
  return fallback && fallback !== '[object Object]' ? fallback : '未知错误'
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

async function svgToPng(svgMarkup: string): Promise<{ base64Data: string; widthPx: number; heightPx: number }> {
  // Strip foreignObject (which taints canvas) and replace with SVG <text>
  const cleanSvg = replaceForeignObjectWithText(svgMarkup)
  const normalized = normalizeSvgForRasterization(cleanSvg)

  const width = Math.round(parseSvgWidth(normalized) ?? 1200)
  const height = Math.round(parseSvgHeight(normalized) ?? 800)
  const scale = 6

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas context unavailable')
  ctx.scale(scale, scale)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  const blob = new Blob([normalized], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('SVG 光栅化失败'))
      img.src = url
    })
    ctx.drawImage(image, 0, 0, width, height)
  } finally {
    URL.revokeObjectURL(url)
  }

  const dataUrl = canvas.toDataURL('image/png')
  return {
    base64Data: dataUrl.replace(/^data:image\/png;base64,/, ''),
    widthPx: width,
    heightPx: height,
  }
}

/**
 * Replace <foreignObject> blocks with SVG <text> using regex.
 * DOMParser can't reliably handle mixed HTML-in-SVG, so we use regex instead.
 */
export function replaceForeignObjectWithText(svgMarkup: string): string {
  return svgMarkup.replace(
    /<foreignObject([^>]*)>([\s\S]*?)<\/foreignObject>/gi,
    (_match, attrs: string, innerHtml: string) => {
      const x = parseFloat(attrs.match(/\bx="([^"]*)"/)?.[1] || '0')
      const y = parseFloat(attrs.match(/\by="([^"]*)"/)?.[1] || '0')
      const w = parseFloat(attrs.match(/\bwidth="([^"]*)"/)?.[1] || '100')
      const h = parseFloat(attrs.match(/\bheight="([^"]*)"/)?.[1] || '20')

      const fontSize = 15
      const lines = wrapForeignObjectLines(extractForeignObjectLines(innerHtml), w, fontSize)
      if (!lines.length) return ''

      const lineHeight = fontSize * 1.2

      const cx = x + w / 2
      const cy = y + h / 2 + (fontSize * 0.35)

      if (lines.length === 1) {
        return `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="${fontSize}px" font-weight="700" fill="#000000" font-family="SimSun, &quot;Times New Roman&quot;, serif">${escapeXml(lines[0])}</text>`
      }

      const startY = cy - ((lines.length - 1) * lineHeight) / 2
      const tspans = lines
        .map((line, index) => {
          const dy = index === 0 ? '0' : `${lineHeight}`
          return `<tspan x="${cx}" dy="${dy}">${escapeXml(line)}</tspan>`
        })
        .join('')

      return `<text x="${cx}" y="${startY}" text-anchor="middle" font-size="${fontSize}px" font-weight="700" fill="#000000" font-family="SimSun, &quot;Times New Roman&quot;, serif">${tspans}</text>`
    },
  )
}

function extractForeignObjectLines(innerHtml: string): string[] {
  const normalized = innerHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
    .replace(/<\/div>\s*<div[^>]*>/gi, '\n')
    .replace(/<\/span>\s*<span[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')

  return normalized
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function wrapForeignObjectLines(lines: string[], width: number, fontSize: number): string[] {
  const maxTextWidth = Math.max(20, width - 12)
  const wrapped: string[] = []
  for (const line of lines) {
    wrapped.push(...wrapLineByWidth(line, maxTextWidth, fontSize))
  }
  return wrapped
}

function wrapLineByWidth(line: string, maxTextWidth: number, fontSize: number): string[] {
  if (!line) return []
  const tokens = line.split(/(\s+|\/)/).filter(Boolean)
  const lines: string[] = []
  let current = ''

  const pushCurrent = () => {
    const normalized = current.trim()
    if (normalized) lines.push(normalized)
    current = ''
  }

  for (const token of tokens) {
    const candidate = current ? `${current}${token}` : token
    if (current && estimateTextWidth(candidate, fontSize) > maxTextWidth) {
      pushCurrent()
      current = token.trimStart()
      continue
    }
    current = candidate
  }
  pushCurrent()

  if (lines.length === 0) return [line]
  return lines
}

function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0
  for (const char of text) {
    if (/\s/.test(char)) {
      width += fontSize * 0.3
    } else if (/[\u4e00-\u9fff]/.test(char)) {
      width += fontSize * 1
    } else if (/[A-Z]/.test(char)) {
      width += fontSize * 0.68
    } else if (/[a-z0-9]/.test(char)) {
      width += fontSize * 0.56
    } else {
      width += fontSize * 0.45
    }
  }
  return width
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function normalizeSvgForRasterization(svgMarkup: string): string {
  let normalized = svgMarkup
    .replace(/[\n\r\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  const width = parseSvgWidth(normalized) ?? 1200
  const height = parseSvgHeight(normalized) ?? 800

  if (!/\bxmlns=/.test(normalized)) {
    normalized = normalized.replace(
      /<svg\b/i,
      '<svg xmlns="http://www.w3.org/2000/svg"',
    )
  }

  if (!/\bxmlns:xlink=/.test(normalized)) {
    normalized = normalized.replace(
      /<svg\b/i,
      '<svg xmlns:xlink="http://www.w3.org/1999/xlink"',
    )
  }

  if (/\bwidth="[^"]*%"/i.test(normalized) || !/\bwidth="/i.test(normalized)) {
    normalized = normalized.replace(/\bwidth="[^"]*"/i, '')
    normalized = normalized.replace(/<svg\b/i, `<svg width="${width}"`)
  }

  if (/\bheight="[^"]*%"/i.test(normalized) || !/\bheight="/i.test(normalized)) {
    normalized = normalized.replace(/\bheight="[^"]*"/i, '')
    normalized = normalized.replace(/<svg\b/i, `<svg height="${height}"`)
  }

  if (!/\bviewBox="/i.test(normalized)) {
    normalized = normalized.replace(/<svg\b/i, `<svg viewBox="0 0 ${width} ${height}"`)
  }

  return normalized
}

function parseSvgWidth(svg: string): number | null {
  const widthMatch = svg.match(/\bwidth="([\d.]+)(px)?"/i)
  if (widthMatch) return Number(widthMatch[1]) || null
  const viewBoxMatch = svg.match(/\bviewBox="[\d.\-]+\s+[\d.\-]+\s+([\d.]+)\s+([\d.]+)"/i)
  if (viewBoxMatch) return Number(viewBoxMatch[1]) || null
  return null
}

function parseSvgHeight(svg: string): number | null {
  const heightMatch = svg.match(/\bheight="([\d.]+)(px)?"/i)
  if (heightMatch) return Number(heightMatch[1]) || null
  const viewBoxMatch = svg.match(/\bviewBox="[\d.\-]+\s+[\d.\-]+\s+([\d.]+)\s+([\d.]+)"/i)
  if (viewBoxMatch) return Number(viewBoxMatch[2]) || null
  return null
}

function toMindElixirData(root: MindNode): MindElixirData {
  let counter = 0
  const genId = () => `m-${Date.now().toString(36)}-${counter++}`
  const walk = (node: MindNode): MindElixirData['nodeData'] => ({
    id: genId(),
    topic: node.title,
    children: node.children?.map(walk),
  })
  return { nodeData: walk(root), direction: SIDE as 0 | 1 | 2 }
}

function parseOutline(text: string): MindNode | null {
  const lines = text.split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim().length > 0)
  if (!lines.length) return null

  const rootTitle = lines[0].replace(/^[-*+\s]+/, '').trim()
  if (!rootTitle) return null

  const root: MindNode = { title: rootTitle, children: [] }
  const stack: Array<{ depth: number; node: MindNode }> = [{ depth: 0, node: root }]

  const getDepth = (line: string) => {
    const tabs = line.match(/^\t+/)?.[0].length ?? 0
    const spaces = line.match(/^ +/)?.[0].length ?? 0
    return tabs + Math.floor(spaces / 2)
  }

  for (let index = 1; index < lines.length; index += 1) {
    const raw = lines[index]
    const depth = getDepth(raw)
    const title = raw.replace(/^[-*+\s]+/, '').trim()
    if (!title) continue
    const node: MindNode = { title, children: [] }
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop()
    const parent = stack[stack.length - 1]?.node
    if (!parent) return null
    parent.children = parent.children || []
    parent.children.push(node)
    stack.push({ depth, node })
  }

  return root
}

async function renderMindBlockToSvg(code: string): Promise<string | null> {
  let data: MindElixirData | null = null
  try {
    const parsed = JSON.parse(code) as MindNode
    if (parsed && typeof parsed === 'object' && typeof parsed.title === 'string') {
      data = toMindElixirData(parsed)
    }
  } catch {
    const outline = parseOutline(code)
    if (outline) data = toMindElixirData(outline)
  }

  if (!data) return null

  const container = document.createElement('div')
  container.style.cssText = [
    'position:fixed',
    'left:-9999px',
    'top:-9999px',
    'width:1400px',
    'height:1000px',
    'visibility:hidden',
    'pointer-events:none',
    'overflow:hidden',
  ].join(';')
  document.body.appendChild(container)

  try {
    const mind = new MindElixir({
      el: container,
      direction: data.direction ?? SIDE,
      editable: false,
      contextMenu: false,
      toolBar: false,
      keypress: false,
      allowUndo: false,
      theme: MindElixir.THEME,
    })
    mind.init(data)
    mind.initSide()
    container.style.setProperty('--bgcolor', 'transparent')
    container.style.setProperty('--map-padding', '6px 8px')
    await new Promise((resolve) => setTimeout(resolve, 300))
    try {
      mind.scaleFit()
      mind.toCenter()
    } catch {
      // noop
    }
    const svgBlob: Blob = mind.exportSvg(true)
    return await svgBlob.text()
  } finally {
    container.remove()
  }
}
