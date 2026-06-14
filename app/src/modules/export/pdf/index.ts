/**
 * PDF 导出逻辑
 * 技术路径：预渲染所有动态内容 + 独立打印文档
 */

import { prepareExportHtmlContents } from '../html'
import { printHtmlDocument } from './printHtmlDocument'

/**
 * 导出为 PDF
 */
export async function exportToPdf(ctx: any) {
    const tr = (key: string, fallback: string, params?: Record<string, string | number>) =>
        ctx.t?.(key, params) ?? fallback
    try {
        console.log('[Export PDF] 开始准备 PDF 内容')
        ctx.setStatusMessage(tr('export.pdfPreparing', '正在准备 PDF 数据...'))

        const { fullHtml, title } = await prepareExportHtmlContents(ctx, {
            preRenderMermaid: true,
            inlineCss: true,
        })

        ctx.setStatusMessage(tr('export.pdfPrinting', '正在唤起系统打印对话框...'))
        await printHtmlDocument({ html: fullHtml, title }).catch((error) => {
            console.error('[Export PDF] 打印失败:', error)
            ctx.setStatusMessage(tr('export.pdfFailed', 'PDF 导出失败: ' + (error as Error).message, { message: (error as Error).message }))
        })

        ctx.setStatusMessage(tr('export.pdfCompleted', 'PDF 导出任务已完成'))
        return true
    } catch (error) {
        console.error('[Export PDF] 导出失败:', error)
        ctx.setStatusMessage(tr('export.pdfFailed', 'PDF 导出失败: ' + (error as Error).message, { message: (error as Error).message }))
        return false
    }
}
