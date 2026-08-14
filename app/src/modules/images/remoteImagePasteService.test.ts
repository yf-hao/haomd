import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  downloadRemoteImages,
} from '../platform/clipboardPasteService'
import {
  hasRemoteImagesInHtml,
  localizeRemoteImagesInHtml,
} from './remoteImagePasteService'

vi.mock('../platform/clipboardPasteService', () => ({
  downloadRemoteImages: vi.fn(),
}))

describe('remoteImagePasteService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('detects and replaces unique remote image sources', async () => {
    vi.mocked(downloadRemoteImages).mockResolvedValue([
      { source_url: 'https://example.com/a.png', file_name: 'article_1.png' },
    ])

    const html = '<p><img src="https://example.com/a.png" data-src="lazy.png"><img src="https://example.com/a.png"></p>'
    expect(hasRemoteImagesInHtml(html)).toBe(true)

    const result = await localizeRemoteImagesInHtml(
      html,
      '/documents/images',
      'images',
      'article',
    )

    expect(downloadRemoteImages).toHaveBeenCalledWith(
      '/documents/images',
      ['https://example.com/a.png'],
      'article',
    )
    expect(result.html).toContain('src="images/article_1.png"')
    expect(result.html).not.toContain('data-src=')
    expect(result.imageCount).toBe(1)
    expect(result.failedCount).toBe(0)
  })

  it('keeps failed remote images unchanged and reports the failure count', async () => {
    vi.mocked(downloadRemoteImages).mockResolvedValue([
      { source_url: 'https://example.com/a.png', error: 'network error' },
    ])

    const html = '<img src="https://example.com/a.png">'
    const result = await localizeRemoteImagesInHtml(
      html,
      '/documents/images',
      'images',
      'article',
    )

    expect(result.html).toContain('src="https://example.com/a.png"')
    expect(result.failedCount).toBe(1)
    expect(result.imageCount).toBe(1)
  })
})
