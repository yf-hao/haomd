export type LinkDownloadInfo = {
  shouldDownload: boolean
  url: string
  suggestedFileName?: string
}

/**
 * 链接分类接口：判断一个 href 是否属于「需要下载」的链接，并给出建议文件名。
 */
export interface LinkClassifier {
  classify(href: string): LinkDownloadInfo
}

/**
 * 题目附件链接分类器：
 * - 域名为 aigc.sias.edu.cn
 * - 路径包含 /files/tools/
 * - 扩展名为 .txt
 */
export class ExamAttachmentLinkClassifier implements LinkClassifier {
  classify(href: string): LinkDownloadInfo {
    try {
      const url = new URL(href)
      const isExamHost = url.hostname === 'aigc.sias.edu.cn'
      const inToolsDir = url.pathname.includes('/files/tools/')
      const isTxt = url.pathname.endsWith('.txt')

      const shouldDownload = isExamHost && inToolsDir && isTxt
      const suggestedFileName = decodeURIComponent(
        url.pathname.split('/').pop() || 'download.txt',
      )

      return { shouldDownload, url: url.toString(), suggestedFileName }
    } catch {
      // 相对路径等解析失败的情况，做一个简单兜底：按 .txt 后缀判断
      const isTxt = href.endsWith('.txt')
      return {
        shouldDownload: isTxt,
        url: href,
        suggestedFileName: isTxt ? href.split('/').pop() : undefined,
      }
    }
  }
}
