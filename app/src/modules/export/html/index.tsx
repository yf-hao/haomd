// @ts-nocheck
/**
 * HTML 导出主逻辑
 */

import React from 'react'
import { renderToString } from 'react-dom/server'
import { save } from '@tauri-apps/plugin-dialog'
import { dirname } from '@tauri-apps/api/path'
import MindElixir, { SIDE } from 'mind-elixir'
import { writeFile } from '../../files/service'
import { ExportWrapper } from './components/ExportWrapper'
import { generateHTMLTemplate } from './template'
import { convertImagesToBase64 } from './imageHandler'

export interface ExportHtmlOptions {
  title: string
  content: string
  baseDir?: string
}

/**
 * 准备导出的 HTML 内容（供 HTML 和 PDF 导出复用）
 * 包含：思维导图渲染、React 静态渲染、图片转 Base64、模板生成
 */
export async function prepareExportHtmlContents(ctx: any) {
  const rawTitle = ctx.getCurrentFileName() || 'Document'
  const title = rawTitle.replace(/\.md$/i, '')
  const filePath = ctx.getFilePath ? ctx.getFilePath() : null
  const markdown = ctx.getCurrentMarkdown()
  const baseDir = filePath ? await dirname(filePath) : null

  // 1. 并行渲染思维导图
  ctx.setStatusMessage('正在渲染思维导图...')
  const processedMarkdown = await preTreatMindBlocks(markdown)

  // 2. 渲染 React 组件为静态字符串
  ctx.setStatusMessage('正在构建页面结构...')
  const renderedHtml = renderToString(
    <ExportWrapper markdown={processedMarkdown} />
  )

  // 3. 图片转 Base64（离线化）
  ctx.setStatusMessage('正在处理图片资源...')
  const finalHtml = await convertImagesToBase64(renderedHtml, baseDir)

  // 4. 生成最终完整的 HTML 模板
  const hasMind = processedMarkdown.includes('mind-diagram-export')
  const hasMermaid = finalHtml.includes('class="mermaid"')

  const fullHtml = generateHTMLTemplate({
    title,
    body: finalHtml,
    hasMind,
    hasMermaid
  })

  return {
    title,
    fullHtml,
    saveName: `${title}.html`
  }
}

/**
 * 导出为 HTML
 */
export async function exportToHtml(ctx: any) {
  try {
    console.log('[Export] 开始导出 HTML')

    const rawTitle = ctx.getCurrentFileName() || 'Document'
    const title = rawTitle.replace(/\.md$/i, '')

    // 1. 先弹窗获取保存路径
    const savePath = await save({
      defaultPath: `${title}.html`,
      filters: [{ name: 'HTML 文件', extensions: ['html'] }]
    })

    if (!savePath) {
      console.log('[Export] 用户取消导出')
      return false
    }

    // 2. 准备内容
    const { fullHtml } = await prepareExportHtmlContents(ctx)

    // 3. 写入文件
    ctx.setStatusMessage('正在保存到磁盘...')
    const writeResult = await writeFile({ path: savePath, content: fullHtml })
    if (!writeResult.ok) {
      throw new Error(writeResult.error?.message || '文件写入失败')
    }

    console.log('[Export] 导出完成:', savePath)
    ctx.setStatusMessage(`导出成功: ${savePath}`)
    return true
  } catch (error) {
    console.error('[Export] 导出失败:', error)
    ctx.setStatusMessage('导出失败: ' + (error as Error).message)
    return false
  }
}

/**
 * 解析特殊块
 */
function parseSpecialBlocks(markdown: string) {
  const hasMind = /```\s*mind\b/.test(markdown)
  const hasMermaid = /```\s*mermaid\b/.test(markdown)
  return { hasMind, hasMermaid }
}

// ── mind-elixir 解析工具（与 diagrams.tsx 保持一致）──────────────────────────
type MindNode = { title: string; children?: MindNode[] }
type MindElixirData = {
  nodeData: { id: string; topic: string; children?: MindElixirData['nodeData'][] }
  direction?: 0 | 1 | 2
}

function toMindElixirData(root: MindNode, SIDE: any): MindElixirData {
  let counter = 0
  const genId = () => `m-${Date.now().toString(36)}-${counter++}`
  const walk = (node: MindNode): MindElixirData['nodeData'] => ({
    id: genId(),
    topic: node.title,
    children: node.children?.map(walk),
  })
  return { nodeData: walk(root), direction: SIDE }
}

function parseOutline(text: string): MindNode | null {
  const lines = text.split(/\r?\n/).map(l => l.trimEnd()).filter(l => l.trim().length > 0)
  if (!lines.length) return null
  const rootTitle = lines[0].replace(/^[-*+\s]+/, '').trim()
  if (!rootTitle) return null
  const root: MindNode = { title: rootTitle, children: [] }
  type SI = { depth: number; node: MindNode }
  const stack: SI[] = [{ depth: 0, node: root }]
  const getDepth = (line: string) => {
    const tabs = line.match(/^\t+/)?.[0].length ?? 0
    const spaces = line.match(/^ +/)?.[0].length ?? 0
    const hyphens = line.match(/^(-|--|\*|\+)+/)?.[0] ?? ''
    return tabs + Math.floor(spaces / 2) + (hyphens ? hyphens.replace(/[^-]/g, '').length : 0)
  }
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]
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

/**
 * 用当前 WebView DOM 渲染单个 mind 代码块，导出 SVG 字符串
 */
async function renderMindBlockToSvg(code: string, MindElixir: any, SIDE: any): Promise<string | null> {
  // 1. 解析 mind 代码为 MindElixirData
  let data: MindElixirData | null = null
  try {
    const parsed = JSON.parse(code) as MindNode
    if (parsed && typeof parsed === 'object' && typeof (parsed as any).title === 'string') {
      data = toMindElixirData(parsed, SIDE)
    } else {
      throw new Error('not a MindNode JSON')
    }
  } catch {
    const outline = parseOutline(code)
    if (outline) data = toMindElixirData(outline, SIDE)
  }
  if (!data) {
    console.warn('[Export Mind] 无法解析 mind 代码')
    return null
  }

  // 2. 在当前 DOM 里创建隐藏容器
  const container = document.createElement('div')
  container.style.cssText =
    'position:fixed;top:-9999px;left:-9999px;width:1200px;height:800px;' +
    'visibility:hidden;pointer-events:none;overflow:hidden;'
  document.body.appendChild(container)

  try {
    // 3. 初始化 mind-elixir 并渲染
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

    // 4. 等待布局稳定（并行处理时略缩短为 300ms）
    await new Promise(resolve => setTimeout(resolve, 300))

    try { mind.scaleFit(); mind.toCenter() } catch { /* 忽略 */ }

    // 5. 导出 SVG
    const svgBlob: Blob = mind.exportSvg(/* noForeignObject */ true)
    const svgText = await svgBlob.text()
    return svgText
  } catch (e) {
    console.error('[Export Mind] 渲染失败:', e)
    return null
  } finally {
    try { document.body.removeChild(container) } catch { /* ... */ }
  }
}

/**
 * 预处理：将 ```mind...``` 代码块并行替换为内嵌 SVG
 */
async function preTreatMindBlocks(markdown: string): Promise<string> {
  const regex = /```mind\s*([\s\S]*?)```/g
  const matches = [...markdown.matchAll(regex)]
  if (matches.length === 0) return markdown

  console.log('[Export Mind] 开始并行处理', matches.length, '个图表')

  // 直接复用静态导入的 MindElixir，避免动态 import 在某些打包环境下失败
  const MindElixirLib: any = MindElixir
  const SIDELib: any = SIDE

  // 并行启动所有渲染任务
  const renderTasks = matches.map(async (match) => {
    const code = match[1].trim()
    const svgText = await renderMindBlockToSvg(code, MindElixirLib, SIDELib)
    return {
      original: match[0],
      replacement: svgText
        ? `\n<div class="mind-diagram-export">\n${svgText}\n</div>\n`
        : `${match[0]}\n\n> ⚠️ 思维导图渲染失败\n`
    }
  })

  const results = await Promise.all(renderTasks)

  // 统一替换内容
  let result = markdown
  for (const item of results) {
    result = result.replace(item.original, item.replacement)
  }

  return result
}
