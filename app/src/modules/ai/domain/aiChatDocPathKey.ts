export function buildPdfAiChatDocPathKey(pdfPath?: string | null): string | null {
  const trimmed = pdfPath?.trim()
  if (!trimmed) return null
  return `pdf:${encodeURIComponent(trimmed)}`
}
