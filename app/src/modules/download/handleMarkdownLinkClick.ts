import { invoke } from '@tauri-apps/api/core'
import type { LinkClassifier } from './linkClassifier'
import type { TextDownloadService } from './downloadService'
import type { FileSaveService } from './fileSaveService'

/**
 * 非下载型链接的打开行为接口（例如在内置浏览器中打开）。
 */
export interface ExternalLinkOpener {
  open(url: string): Promise<void> | void
}

export class TauriWebviewOpener implements ExternalLinkOpener {
  async open(url: string): Promise<void> {
    await invoke('open_webview_browser', { url })
  }
}

/**
 * UI 层用于处理 Markdown 链接点击的统一接口。
 */
export interface MarkdownLinkClickHandler {
  handleClick(href: string): Promise<void>
}

/**
 * 用例层：
 * 1. 使用 LinkClassifier 判断链接是否需要下载；
 * 2. 对需要下载的，调用 TextDownloadService 拉取内容，再通过 FileSaveService 保存；
 * 3. 对其它链接，交给 ExternalLinkOpener 处理（例如打开浏览器）。
 */
export class DownloadOnClickUseCase implements MarkdownLinkClickHandler {
  private readonly classifier: LinkClassifier
  private readonly downloader: TextDownloadService
  private readonly saver: FileSaveService
  private readonly fallbackOpener: ExternalLinkOpener

  constructor(
    classifier: LinkClassifier,
    downloader: TextDownloadService,
    saver: FileSaveService,
    fallbackOpener: ExternalLinkOpener,
  ) {
    this.classifier = classifier
    this.downloader = downloader
    this.saver = saver
    this.fallbackOpener = fallbackOpener
  }

  async handleClick(href: string): Promise<void> {
    const info = this.classifier.classify(href)

    if (!info.shouldDownload) {
      await this.fallbackOpener.open(href)
      return
    }

    const content = await this.downloader.downloadText(info.url)
    const defaultFileName = info.suggestedFileName ?? 'download.txt'

    await this.saver.saveTextWithDialog({
      defaultFileName,
      content,
    })
  }
}
