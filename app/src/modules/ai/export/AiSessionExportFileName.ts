export function sanitizeExportFileNamePart(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, '-')
    .split('')
    .filter((character) => character.charCodeAt(0) >= 32)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 80)
}

export function getDocPathBaseName(docPath: string): string {
  const baseName = docPath.split(/[/\\]/).pop()?.replace(/\.[^./\\]+$/, '') || ''
  return sanitizeExportFileNamePart(baseName) || 'untitled'
}

export function buildSuggestedExportFileName(options: {
  prefix: string
  extension: string
  docPath: string
  currentSessionTitle?: string | null
  hasCurrentSession?: boolean
}): string {
  const baseName = options.hasCurrentSession
    ? sanitizeExportFileNamePart(options.currentSessionTitle?.trim() ?? '') || 'untitled'
    : getDocPathBaseName(options.docPath)
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const mi = String(now.getMinutes()).padStart(2, '0')
  const timestamp = `${yyyy}${mm}${dd}-${hh}${mi}`

  return `${options.prefix} - ${baseName} - ${timestamp}.${options.extension}`
}
