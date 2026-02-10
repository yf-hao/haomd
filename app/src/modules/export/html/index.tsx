// @ts-nocheck
/**
 * HTML 导出主逻辑
 */

import React from 'react'
import { renderToString } from 'react-dom/server'
import { writeTextFile, save } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import { dirname } from '@tauri-apps/api/path'
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

    // 3. 渲染 React 组件为 HTML 字符串
    ctx.setStatusMessage('正在渲染 Markdown...')
    const renderedHtml = renderToString(
      <ExportWrapper markdown={markdown} />
    )
    console.log('[Export] 渲染完成，HTML 长度:', renderedHtml.length)

    // 4. 处理 Mind 图表（转换为 SVG）
    let finalHtml = renderedHtml
    if (hasMind) {
      ctx.setStatusMessage('正在处理思维导图...')
      finalHtml = await processMindDiagrams(markdown, finalHtml)
      console.log('[Export] Mind 图表处理完成')
    }

    // 5. 处理图片（转换为 base64）
    ctx.setStatusMessage('正在转换图片...')
    finalHtml = await convertImagesToBase64(finalHtml, baseDir)
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

    await writeTextFile(savePath, fullHtml)
    console.log('[Export] 文件已保存:', savePath)

    ctx.setStatusMessage(`已导出为 HTML: ${savePath}`)
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

/**
 * 处理 Mind 图表渲染
 */
async function processMindDiagrams(markdown: string, html: string): Promise<string> {
  let result = html

  // 匹配所有的 Mind 代码块
  const mindBlockRegex = /```mind\s*([\s\S]*?)```/g
  const matches = [...markdown.matchAll(mindBlockRegex)]

  // 匹配 HTML 中的占位符
  const placeholderRegex = /<div class="diagram-placeholder"[^>]*data-diagram-type="mind"[^>]*>[\s\S]*?<\/div>/g
  const placeholders = [...result.matchAll(placeholderRegex)]

  console.log('[Export Mind] 找到', matches.length, '个 Mind 图表')
  console.log('[Export Mind] 找到', placeholders.length, '个占位符')

  for (let i = 0; i < matches.length && i < placeholders.length; i++) {
    const match = matches[i]
    const placeholder = placeholders[i]

    try {
      const code = match[1].trim()
      console.log('[Export Mind] 处理图表', i + 1, '代码长度:', code.length)

      // 调用 Rust 后端渲染 Mind 图表
      const response: any = await invoke('render_xmind', {
        input: code,
        limits: { width: 800, height: 600 },
        trace_id: null
      })

      if (response.ok && response.format === 'svg') {
        // 直接嵌入 SVG
        const svgContent = response.data
        const wrappedSvg = `<div class="mind-diagram">${svgContent}</div>`
        result = result.replace(placeholder[0], wrappedSvg)
        console.log('[Export Mind] 图表', i + 1, '渲染成功')
      } else {
        console.warn('[Export Mind] 渲染失败:', response.error)
        const errorHtml = `<div class="diagram-error">思维导图渲染失败: ${response.error?.message || '未知错误'}</div>`
        result = result.replace(placeholder[0], errorHtml)
      }
    } catch (e) {
      console.warn('[Export Mind] 渲染异常:', e)
      const errorHtml = `<div class="diagram-error">思维导图渲染异常</div>`
      result = result.replace(placeholder[0], errorHtml)
    }
  }

  return result
}
