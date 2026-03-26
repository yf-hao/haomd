/**
 * PDF 导出逻辑
 * 技术路径：预渲染所有动态内容 + Portal 渲染方案
 */

import { prepareExportHtmlContents } from '../html'
// HLJS CSS 仅含 .hljs-* 语法高亮颜色规则，不影响排版，安全注入
import hljsCssRaw from 'highlight.js/styles/github.css?raw'

/**
 * 导出为 PDF
 */
export async function exportToPdf(ctx: any) {
    const tr = (key: string, fallback: string, params?: Record<string, string | number>) =>
        ctx.t?.(key, params) ?? fallback
    try {
        console.log('[Export PDF] 开始准备 PDF 内容')
        ctx.setStatusMessage(tr('export.pdfPreparing', '正在准备 PDF 数据...'))

        // 1. 复用公共 HTML 渲染逻辑，启用预渲染和内联 CSS
        const { fullHtml, title } = await prepareExportHtmlContents(ctx, {
            preRenderMermaid: true,
            inlineCss: true,
        })

        // 2. 使用主窗口 Portal 方案唤起打印
        ctx.setStatusMessage(tr('export.pdfPrinting', '正在唤起系统打印对话框...'))
        await printViaMainPortal(fullHtml, title)

        ctx.setStatusMessage(tr('export.pdfCompleted', 'PDF 导出任务已完成'))
        return true
    } catch (error) {
        console.error('[Export PDF] 导出失败:', error)
        ctx.setStatusMessage(tr('export.pdfFailed', 'PDF 导出失败: ' + (error as Error).message, { message: (error as Error).message }))
        return false
    }
}

/**
 * 通过主窗口 Portal 唤起打印
 * Mermaid/Mind/KaTeX 已在 prepareExportHtmlContents 阶段预渲染为静态内容，
 * 无需加载外部 JS，直接注入 DOM 并打印。
 *
 * 设计原则（避免预览布局闪变）：
 * - 不将模板排版 CSS（body/markdown-body 规则）注入 <head>，防止全局样式重算
 * - app 已通过 MarkdownViewer 懒加载 KaTeX CSS，portal 天然继承，无需重复注入
 * - 仅注入 HLJS CSS（纯 .hljs-* 颜色规则，不影响排版）用于代码高亮
 * - 打印 CSS 用 body{visibility:hidden} 而非 display:none，保持布局稳定
 */
async function printViaMainPortal(html: string, title: string): Promise<void> {
    // 1. 清理旧环境
    const cleanupOld = () => {
        const ids = ['haomd-print-portal', 'haomd-print-override', 'haomd-print-hljs-css']
        ids.forEach(id => {
            const el = document.getElementById(id)
            if (el) el.parentNode?.removeChild(el)
        })
    }
    cleanupOld()

    const originalTitle = document.title
    document.title = title

    // 2. 解析 HTML，只取 body 内容（head 样式不注入，避免破坏主应用布局）
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const bodyContent = doc.body.innerHTML

    // 3. 注入 Portal（离屏，保持可见以正确计算 SVG 尺寸）
    const portal = document.createElement('div')
    portal.id = 'haomd-print-portal'
    portal.innerHTML = `<div class="markdown-body">${bodyContent}</div>`
    document.body.appendChild(portal)

    // 4. 注入 HLJS 语法高亮 CSS（仅含 .hljs-* 规则，不影响主应用排版）
    //    KaTeX CSS 已由 MarkdownViewer 懒加载，无需重复注入
    const hljsStyle = document.createElement('style')
    hljsStyle.id = 'haomd-print-hljs-css'
    hljsStyle.textContent = hljsCssRaw
    document.head.appendChild(hljsStyle)

    // 5. 注入打印控制样式（仅包含 portal 定位和打印规则，不含全局排版规则）
    const style = document.createElement('style')
    style.id = 'haomd-print-override'
    style.innerHTML = `
        /* 离屏渲染：保持可见以正确计算 SVG 尺寸 */
        #haomd-print-portal {
            position: fixed !important;
            left: -9999px !important;
            top: 0 !important;
            display: block !important;
            visibility: visible !important;
            width: 1000px !important;
            background: white !important;
        }

        @media print {
            /*
             * visibility:hidden 而非 display:none：
             * 保持布局不变（元素仍占空间），避免触发 reflow 导致视觉抖动
             */
            body { visibility: hidden !important; }
            html { background: white !important; }

            #haomd-print-portal {
                visibility: visible !important;
                display: block !important;
                position: absolute !important;
                left: 0 !important;
                top: 0 !important;
                width: 100% !important;
                height: auto !important;
                background: white !important;
                z-index: 2147483647 !important;
                color: #1a1a1a !important;
            }
            .markdown-body {
                max-width: none !important;
                background: white !important;
                color: #1a1a1a !important;
                font-size: 12pt !important;
                line-height: 1.7 !important;
            }
            .markdown-body code { background-color: rgba(27, 31, 35, 0.05) !important; color: #24292e !important; text-shadow: none !important; }
            .markdown-body pre { background-color: #f6f8fa !important; border: 1px solid #dfe2e5 !important; white-space: pre-wrap !important; }
            .mermaid-rendered svg { max-width: 100% !important; height: auto !important; }
            @page { margin: 1.5cm; }
            * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
    `
    document.head.appendChild(style)

    // 6. 等待一帧让浏览器完成 DOM 渲染（内容已预渲染，无需长时间等待）
    console.log('[Print] 内容已注入，等待渲染稳定...')
    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 50)))

    // 7. 唤起打印
    console.log('[Print] 准备唤起打印预览...')
    return new Promise((resolve) => {
        const cleanup = () => {
            setTimeout(() => {
                cleanupOld()
                document.title = originalTitle
                resolve()
            }, 3000)
        }
        window.onafterprint = cleanup

        setTimeout(() => {
            try {
                window.print()
            } catch (e) {
                console.error('[Print] 打印指令执行失败:', e)
                cleanup()
            }
        }, 200)
    })
}
