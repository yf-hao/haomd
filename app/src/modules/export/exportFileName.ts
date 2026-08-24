export const DEFAULT_EXPORT_BASE_NAME = '未命名文档'

export function stripExportFileExtension(fileName: string): string {
  return fileName.replace(/\.[^./\\]+$/i, '')
}

export function extractFirstMarkdownHeading(markdown: string): string | null {
  let inFence = false
  let fenceMarker = ''
  let inFrontMatter = false

  for (const [index, line] of markdown.split(/\r?\n/).entries()) {
    const trimmed = line.trim()

    if (index === 0 && trimmed === '---') {
      inFrontMatter = true
      continue
    }
    if (inFrontMatter) {
      if (trimmed === '---' || trimmed === '...') {
        inFrontMatter = false
      }
      continue
    }

    const fence = trimmed.match(/^(`{3,}|~{3,})/)
    if (fence) {
      if (!inFence) {
        inFence = true
        fenceMarker = fence[1]![0]!
      } else if (fenceMarker === fence[1]![0]) {
        inFence = false
        fenceMarker = ''
      }
      continue
    }
    if (inFence) continue

    const heading = line.match(/^ {0,3}#(?!#)\s+(.+?)\s*#*\s*$/)
    if (heading?.[1]) {
      const title = heading[1]
        .replace(/\s+#+\s*$/, '')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/<[^>]+>/g, '')
        .replace(/[*_~`]/g, '')
        .trim()
      if (title) return title
    }
  }

  return null
}

export function sanitizeExportBaseName(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
}

export function resolveExportBaseName(
  fileName: string | null | undefined,
  markdown: string,
): string {
  const fileBaseName = fileName?.trim()
  if (fileBaseName) {
    const sanitizedFileName = sanitizeExportBaseName(stripExportFileExtension(fileBaseName))
    if (sanitizedFileName) return sanitizedFileName
  }

  const heading = extractFirstMarkdownHeading(markdown)
  if (heading) {
    const sanitizedHeading = sanitizeExportBaseName(heading)
    if (sanitizedHeading) return sanitizedHeading
  }

  return DEFAULT_EXPORT_BASE_NAME
}
