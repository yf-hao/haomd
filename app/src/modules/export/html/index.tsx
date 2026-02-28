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
 * 导出为 HTML
 */
export async function exportToHtml(ctx: any) {
  try {
    console.log('[Export] 开始导出 HTML')

    const markdown = ctx.getCurrentMarkdown()
    const title = ctx.getCurrentFileName() || 'Document'
    const filePath = ctx.getFilePath ? ctx.getFilePath() : null

    console.log('[Export] 文件名:', title)
    console.log('[Export] Markdown 长度:', markdown.length)

    // 1. 获取当前文件的目录作为图片基准路径
    let baseDir = ''
    if (filePath) {
      baseDir = await dirname(filePath)
      console.log('[Export] 基准目录:', baseDir)
    }

    // 2. 解析 Markdown，检测特殊块
    const { hasMind, hasMermaid } = parseSpecialBlocks(markdown)
    console.log('[Export] 包含 Mind:', hasMind, '包含 Mermaid:', hasMermaid)

    // 3. 【预处理】将 mind 代码块替换为内嵌 SVG（在渲染前完成，避免 HTML 匹配问题）
    let processedMarkdown = markdown
    if (hasMind) {
      ctx.setStatusMessage('正在渲染思维导图...')
      processedMarkdown = await preTreatMindBlocks(markdown)
      console.log('[Export] Mind 预处理完成')
    }

    // 4. 渲染 React 组件为 HTML 字符串（使用预处理后的 markdown）
    ctx.setStatusMessage('正在渲染 Markdown...')
    const renderedHtml = renderToString(
      <ExportWrapper markdown={processedMarkdown} />
    )
    console.log('[Export] 渲染完成，HTML 长度:', renderedHtml.length)

    // 5. 处理图片（转换为 base64）
    ctx.setStatusMessage('正在转换图片...')
    const finalHtml = await convertImagesToBase64(renderedHtml, baseDir)
    console.log('[Export] 图片转换完成')

    // 6. 生成完整的 HTML 文档
    ctx.setStatusMessage('正在生成 HTML 文档...')
    const fullHtml = generateHTMLTemplate({
      title,
      body: finalHtml,
      hasMind,
      hasMermaid
    })
    console.log('[Export] HTML 文档生成完成')

    // 7. 选择保存路径并保存
    ctx.setStatusMessage('正在保存文件...')
    const savePath = await save({
      defaultPath: `${title}.html`,
      filters: [{ name: 'HTML', extensions: ['html'] }]
    })

    if (savePath) {
      const writeResult = await writeFile({ path: savePath, content: fullHtml })
      if (!writeResult.ok) {
        throw new Error(writeResult.error?.message || '文件写入失败')
      }
      console.log('[Export] 文件已保存:', savePath)
      ctx.setStatusMessage(`已导出为 HTML: ${savePath}`)
    }
    return true
  } catch (error) {
    console.error('[Export] 导出失败:', error)
    ctx.setStatusMessage('HTML 导出失败: ' + (error as Error).message)
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

function toMindElixirData(root: MindNode): MindElixirData {
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
 * mind-elixir 本身不依赖 Rust，只需要真实 DOM 环境，而
 * preTreatMindBlocks 在 renderToString 之前调用，DOM 完全可用。
 */
async function renderMindBlockToSvg(code: string): Promise<string | null> {
  // 1. 解析 mind 代码为 MindElixirData
  let data: MindElixirData | null = null
  try {
    const parsed = JSON.parse(code) as MindNode
    if (parsed && typeof parsed === 'object' && typeof (parsed as any).title === 'string') {
      data = toMindElixirData(parsed)
    } else {
      throw new Error('not a MindNode JSON')
    }
  } catch {
    const outline = parseOutline(code)
    if (outline) data = toMindElixirData(outline)
  }
  if (!data) {
    console.warn('[Export Mind] 无法解析 mind 代码')
    return null
  }

  // 2. 在当前 DOM 里创建隐藏容器（宽高要足够大，否则 scaleFit 算不准）
  const container = document.createElement('div')
  container.style.cssText =
    'position:fixed;top:-9999px;left:-9999px;width:900px;height:600px;' +
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

    // 4. 等待布局稳定（mind-elixir 内部有异步布局）
    await new Promise(resolve => setTimeout(resolve, 400))

    try { mind.scaleFit(); mind.toCenter() } catch { /* 忽略 */ }

    // 5. 导出 SVG —— exportSvg() 返回 Blob
    const svgBlob: Blob = mind.exportSvg(/* noForeignObject */ true)
    const svgText = await svgBlob.text()
    console.log('[Export Mind] exportSvg 成功，SVG 长度:', svgText.length)
    return svgText
  } catch (e) {
    console.error('[Export Mind] 渲染失败:', e)
    return null
  } finally {
    // 6. 无论成败都清理 DOM
    try { document.body.removeChild(container) } catch { /* 已被移除 */ }
  }
}

/**
 * 预处理：将 ```mind...``` 代码块替换为内嵌 SVG
 * 在调用 renderToString 之前执行，直接在 Markdown 字符串层面替换
 */
async function preTreatMindBlocks(markdown: string): Promise<string> {
  const regex = /```mind\s*([\s\S]*?)```/g
  const matches = [...markdown.matchAll(regex)]
  console.log('[Export Mind] 找到', matches.length, '个 Mind 图表')

  let result = markdown
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    const code = match[1].trim()
    const original = match[0]
    console.log('[Export Mind] 处理图表', i + 1, '代码长度:', code.length)

    const svgText = await renderMindBlockToSvg(code)
    if (svgText) {
      // 替换为内嵌 SVG 的 div（rehype-raw 会原样透传）
      const svgHtml = `\n<div class="mind-diagram-export">\n${svgText}\n</div>\n`
      result = result.replace(original, svgHtml)
      console.log('[Export Mind] 图表', i + 1, '替换成功')
    } else {
      // 渲染失败时保留原始代码块并附加提示
      const fallback = `${original}\n\n> ⚠️ 思维导图渲染失败，请检查代码格式\n`
      result = result.replace(original, fallback)
    }
  }
  return result
}
