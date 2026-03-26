/**
 * PDF 导出逻辑
 * 技术路径：预渲染所有动态内容 + Portal 渲染方案
 */

import { prepareExportHtmlContents } from '../html'

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
 */
async function printViaMainPortal(html: string, title: string): Promise<void> {
    // 1. 清理旧环境
    const cleanupOld = () => {
        const ids = ['haomd-print-portal', 'haomd-print-override', 'haomd-print-assets']
        ids.forEach(id => {
            const el = document.getElementById(id)
            if (el) el.parentNode?.removeChild(el)
        })
    }
    cleanupOld()

    const originalTitle = document.title
    document.title = title

    // 2. 解析 HTML
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const bodyContent = doc.body.innerHTML

    // 3. 注入 Portal 和样式
    const portal = document.createElement('div')
    portal.id = 'haomd-print-portal'
    portal.innerHTML = `<div class="markdown-body">${bodyContent}</div>`
    document.body.appendChild(portal)

    // 注入样式时，排版规则（id="haomd-tpl-typography"）使用 @scope 限定到 portal，
    // 避免其 body/markdown-body 等全局规则影响主应用的预览布局。
    // KaTeX / HLJS 等库 CSS 正常全局注入（只定义 .katex/.hljs-* 类，不干扰应用排版）。
    const assetContainer = document.createElement('div')
    assetContainer.id = 'haomd-print-assets'
    for (const el of Array.from(doc.head.querySelectorAll('style, link'))) {
        if (el.tagName.toLowerCase() === 'style') {
            const srcStyle = el as HTMLStyleElement
            const newStyle = document.createElement('style')
            if (srcStyle.id === 'haomd-tpl-typography') {
                // 限定到 portal 范围，防止 .markdown-body { line-height: 1.7 } 等规则
                // 泄漏并改变主应用预览的段间距和行高
                newStyle.textContent = `@scope (#haomd-print-portal) {\n${srcStyle.textContent}\n}`
            } else {
                newStyle.textContent = srcStyle.textContent
            }
            assetContainer.appendChild(newStyle)
        } else {
            assetContainer.appendChild(el.cloneNode(true))
        }
    }
    document.head.appendChild(assetContainer)

    const style = document.createElement('style')
    style.id = 'haomd-print-override'
    style.innerHTML = `
        /*
         * 防止模板 body 样式（padding/color/font-family）泄漏到主应用。
         * 模板的 <style> 包含 body { padding: 20px } 等全局规则，
         * 注入到主文档后会给 body 加上 padding，在深色主题下形成黑边。
         */
        html, body {
            padding: 0 !important;
        }

        /*
         * Fallback（针对不支持 @scope 的旧版 WebKit）：
         * 抵消模板 .markdown-body 排版规则对主应用预览的影响。
         * 支持 @scope 时，这些规则会被 @scope 的更高优先级覆盖。
         */
        .markdown-body:not(#haomd-print-portal .markdown-body) {
            line-height: inherit !important;
            max-width: none !important;
            margin-left: 0 !important;
            margin-right: 0 !important;
        }

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
            html, body { 
                background: white !important; 
                margin: 0 !important;
                padding: 0 !important;
            }
            body > *:not(#haomd-print-portal) {
                display: none !important;
            }
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
            }
            .markdown-body code { background-color: rgba(27, 31, 35, 0.05) !important; color: #24292e !important; text-shadow: none !important; }
            .markdown-body pre { background-color: #f6f8fa !important; border: 1px solid #dfe2e5 !important; white-space: pre-wrap !important; }
            .mermaid-rendered svg { max-width: 100% !important; height: auto !important; }
            @page { margin: 1.5cm; }
            * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
    `
    document.head.appendChild(style)

    // 4. 等待 SVG/图片资源完成渲染（短延时即可，无需加载外部 JS）
    console.log('[Print] 内容已注入，等待渲染稳定...')
    await new Promise(resolve => setTimeout(resolve, 300))

    // 5. 唤起打印
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
