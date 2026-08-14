import { downloadRemoteImages } from '../platform/clipboardPasteService'

const REMOTE_IMAGE_SOURCE_ATTRIBUTES = ['src', 'data-src', 'data-original', 'data-lazy-src'] as const

function getRemoteImageSource(image: HTMLImageElement): string | null {
  for (const attribute of REMOTE_IMAGE_SOURCE_ATTRIBUTES) {
    const source = image.getAttribute(attribute)?.trim() || ''
    if (!source) continue
    try {
      const parsed = new URL(source)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return source
    } catch {
      // Ignore non-URL image sources and continue checking lazy-load attributes.
    }
  }
  return null
}

export type LocalizedRemoteImages = {
  html: string
  failedCount: number
  imageCount: number
}

function collectRemoteImageSources(html: string): {
  template: HTMLTemplateElement
  images: HTMLImageElement[]
  sources: string[]
} {
  const template = document.createElement('template')
  template.innerHTML = html
  const images = Array.from(template.content.querySelectorAll('img'))
  const sources = Array.from(
    new Set(
      images
        .map(getRemoteImageSource)
        .filter((source): source is string => Boolean(source)),
    ),
  )
  return { template, images, sources }
}

export function hasRemoteImagesInHtml(html: string): boolean {
  return collectRemoteImageSources(html).sources.length > 0
}

export async function localizeRemoteImagesInHtml(
  html: string,
  targetDir: string,
  relDir: string,
  suggestedName: string,
): Promise<LocalizedRemoteImages> {
  const { template, images, sources: remoteSources } = collectRemoteImageSources(html)

  if (remoteSources.length === 0) {
    return { html, failedCount: 0, imageCount: 0 }
  }

  const downloads = await downloadRemoteImages(targetDir, remoteSources, suggestedName)
  const downloadedBySource = new Map(
    downloads
      .filter((download) => download.file_name)
      .map((download) => [download.source_url, download.file_name!]),
  )

  for (const image of images) {
    const source = getRemoteImageSource(image)
    const fileName = source ? downloadedBySource.get(source) : undefined
    if (!fileName) continue

    image.setAttribute('src', `${relDir}/${fileName}`)
    for (const attribute of REMOTE_IMAGE_SOURCE_ATTRIBUTES) {
      if (attribute !== 'src') image.removeAttribute(attribute)
    }
    image.removeAttribute('srcset')
  }

  return {
    html: template.innerHTML,
    failedCount: downloads.filter((download) => !download.file_name).length,
    imageCount: remoteSources.length,
  }
}
