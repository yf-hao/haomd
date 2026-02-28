/**
 * PDF 导出逻辑
 * 技术路径：Portal 渲染方案（绕过 WebKit iframe 打印拦截）
 */

import { prepareExportHtmlContents } from '../html'

/**
 * 导出为 PDF
 */
export async function exportToPdf(ctx: any) {
    try {
        console.log('[Export PDF] 开始准备 PDF 内容')
        ctx.setStatusMessage('正在准备 PDF 数据...')

        // 1. 复用公共 HTML 渲染逻辑
        const { fullHtml, title } = await prepareExportHtmlContents(ctx)

        // 2. 使用主窗口 Portal 方案唤起打印
        ctx.setStatusMessage('正在唤起系统打印对话框...')
        await printViaMainPortal(fullHtml, title)

        ctx.setStatusMessage('PDF 导出任务已完成')
        return true
    } catch (error) {
        console.error('[Export PDF] 导出失败:', error)
        ctx.setStatusMessage('PDF 导出失败: ' + (error as Error).message)
        return false
    }
}

/**
 * 通过主窗口 Portal 唤起打印，这种方式在 macOS/Tauri 下稳定性最高
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
    const styleAssets = Array.from(doc.head.querySelectorAll('style, link')).map(el => el.outerHTML).join('\n')
    const scriptTags = Array.from(doc.head.querySelectorAll('script'))

    // 3. 注入 Portal 和 样式
    const portal = document.createElement('div')
    portal.id = 'haomd-print-portal'
    portal.innerHTML = `<div class="markdown-body">${bodyContent}</div>`
    document.body.appendChild(portal)

    const assetContainer = document.createElement('div')
    assetContainer.id = 'haomd-print-assets'
    assetContainer.innerHTML = styleAssets
    document.head.appendChild(assetContainer)

    const style = document.createElement('style')
    style.id = 'haomd-print-override'
    style.innerHTML = `
        /* 离屏渲染策略：保持显示以便 Mermaid 计算尺寸，但移出用户视线 */
        #haomd-print-portal { 
            position: fixed !important;
            left: -9999px !important;
            top: 0 !important;
            display: block !important;
            visibility: visible !important;
            width: 1000px !important; /* 给定固定宽度，防止图表因尺寸不确定而折叠 */
            background: white !important;
        }

        @media print {
            body { 
                visibility: hidden !important; 
                background: white !important; 
                margin: 0 !important; 
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
            #root, #app, .workspace-shell { display: none !important; }
            .markdown-body { 
                max-width: none !important; 
                background: white !important; 
                color: #1a1a1a !important; 
                font-size: 12pt !important; 
            }
            .markdown-body code { background-color: rgba(27, 31, 35, 0.05) !important; color: #24292e !important; text-shadow: none !important; }
            .markdown-body pre { background-color: #f6f8fa !important; border: 1px solid #dfe2e5 !important; white-space: pre-wrap !important; }
            @page { margin: 1.5cm; }
            * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
    `
    document.head.appendChild(style)

    // 4. 动态注入并等待脚本加载 (Mermaid 等)
    const scriptList: HTMLScriptElement[] = []
    const scriptPromises = scriptTags.map(oldScript => {
        return new Promise<void>((resolve) => {
            const newScript = document.createElement('script')
            Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value))
            if (oldScript.innerHTML) newScript.innerHTML = oldScript.innerHTML

            if (newScript.src) {
                newScript.onload = () => resolve()
                newScript.onerror = () => resolve()
            } else {
                // 内联脚本
                setTimeout(resolve, 10)
            }
            document.head.appendChild(newScript)
            scriptList.push(newScript)
        })
    })

    await Promise.all(scriptPromises)

    // 5. 触发 Mermaid 渲染
    // 增加轮询等待 Mermaid 对象挂载到 window
    const waitForMermaid = async () => {
        for (let i = 0; i < 20; i++) {
            if ((window as any).mermaid) return true
            await new Promise(r => setTimeout(r, 100))
        }
        return false
    }

    if (await waitForMermaid()) {
        const win = window as any
        console.log('[Print] 启动 Mermaid 渲染...')
        try {
            win.mermaid.initialize({ startOnLoad: false, theme: 'default' })
            await win.mermaid.run({
                querySelector: '#haomd-print-portal .mermaid'
            })
        } catch (e) {
            console.error('[Print] Mermaid 渲染失败:', e)
        }
    }

    // 6. 唤起打印
    console.log('[Print] 准备唤起打印预览...')
    return new Promise((resolve) => {
        const cleanup = () => {
            setTimeout(() => {
                cleanupOld()
                scriptList.forEach(s => s.parentNode?.removeChild(s))
                document.title = originalTitle
                resolve()
            }, 5000)
        }
        window.onafterprint = cleanup

        setTimeout(() => {
            try {
                window.print()
            } catch (e) {
                console.error('[Print] 打印指令执行失败:', e)
                cleanup()
            }
        }, 800) // 给 SVG 渲染留出最后的时间
    })
}
