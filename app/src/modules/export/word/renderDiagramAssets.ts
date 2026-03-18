import mermaid from 'mermaid'
import MindElixir, { SIDE } from 'mind-elixir'
import type { WordBlock, WordDocPayload } from './types'

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
        if (lang === 'mermaid') {
          setStatusMessage?.('正在渲染 Mermaid 图表...')
          const rendered = await renderMermaidBlockToPng(block.content)
          if (!rendered) throw new Error(`Mermaid 图表渲染失败: ${summarizeDiagramBlock(block.content)}`)

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
          const rendered = await renderMindBlockToPng(block.content)
          if (!rendered) throw new Error(`思维导图渲染失败: ${summarizeDiagramBlock(block.content)}`)

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
              cells: await Promise.all(row.cells.map((cell) => replaceBlocks(cell))),
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
    throw new Error(`Mermaid 图表渲染失败: ${(error as Error).message || '未知错误'}`)
  }
}

async function renderMermaidBlockToSvg(code: string): Promise<string | null> {
  const id = `mermaid-export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'loose',
  })

  const container = document.createElement('div')
  container.style.cssText = [
    'position:fixed',
    'left:-9999px',
    'top:-9999px',
    'width:1400px',
    'visibility:hidden',
    'pointer-events:none',
  ].join(';')

  const host = document.createElement('div')
  host.id = id
  host.className = 'mermaid'
  host.textContent = code
  container.appendChild(host)
  document.body.appendChild(container)

  try {
    if (typeof mermaid.render === 'function') {
      const rendered = await mermaid.render(`${id}-render`, code, host)
      if (rendered?.svg) {
        return rendered.svg
      }
    }

    if (typeof mermaid.run === 'function') {
      await mermaid.run({ nodes: [host] })
      const svg = host.querySelector('svg')
      if (svg) return svg.outerHTML
    }

    return null
  } finally {
    container.remove()
  }
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

async function svgToPng(svgMarkup: string): Promise<{ base64Data: string; widthPx: number; heightPx: number }> {
  const svgUrl = svgMarkupToDataUrl(svgMarkup)
  const image = await loadImage(svgUrl)
  const width = Math.max(1, image.naturalWidth || parseSvgWidth(svgMarkup) || 1200)
  const height = Math.max(1, image.naturalHeight || parseSvgHeight(svgMarkup) || 800)
  const scale = 2

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas context unavailable')
  ctx.scale(scale, scale)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(image, 0, 0, width, height)

  const dataUrl = canvas.toDataURL('image/png')
  return {
    base64Data: dataUrl.replace(/^data:image\/png;base64,/, ''),
    widthPx: width,
    heightPx: height,
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = url
  })
}

function svgMarkupToDataUrl(svgMarkup: string): string {
  const normalized = svgMarkup
    .replace(/[\n\r\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(normalized)}`
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
    })
    mind.init(data)
    mind.initSide()
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
