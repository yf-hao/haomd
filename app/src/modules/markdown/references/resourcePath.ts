export function fileUrl(path: string): URL {
  const normalized = path.replace(/\\/g, '/').replace(/^\/\/\?\/UNC\//i, '//').replace(/^\/\/\?\//, '')
  const encoded = normalized.split('/').map((part, index) =>
    index === 0 && /^[a-z]:$/i.test(part) ? part : encodeURIComponent(part)).join('/')
  return new URL(normalized.startsWith('//') ? `file:${encoded}` : `file://${encoded.startsWith('/') ? '' : '/'}${encoded}`)
}

export function resolveDocumentLink(href: string, documentPath?: string | null): string {
  if (!documentPath || href.startsWith('#')) return href
  try {
    const local = resolveLocalResource(href, documentPath)
    return local ? fileUrl(local.path).href + local.search + local.hash : href
  } catch { return href }
}

export function decodeResourcePath(path: string): string {
  // A literal percent sign is legal in a local filename. Decode valid encoded
  // sequences once and leave malformed sequences intact rather than losing it.
  return path.replace(/(?:%[\da-f]{2})+/gi, encoded => {
    try { return decodeURIComponent(encoded) } catch { return encoded }
  })
}

export function resolveLocalResource(value: string, documentPath: string): { path: string; search: string; hash: string } | null {
  if (!value || value.startsWith('#') || value.startsWith('//')) return null
  const drive = /^[a-z]:[\\/]/i.test(value)
  if (!drive && /^[a-z][a-z\d+.-]*:/i.test(value) && !/^file:/i.test(value)) return null
  const url = drive ? fileUrl(value) : new URL(value.replace(/\\/g, '/'), fileUrl(documentPath))
  if (url.protocol !== 'file:') return null
  const pathname = decodeResourcePath(url.pathname)
  const path = url.hostname ? `//${url.hostname}${pathname}` : /^\/[a-z]:\//i.test(pathname) ? pathname.slice(1) : pathname
  return { path, search: url.search, hash: url.hash }
}
