function normalizeInput(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, ' ')
}

const EXACT_MATCHES = new Set([
  '当前目录',
  '当前的目录',
  '当前的目录是哪里',
  '当前目录是哪里',
  '我现在在哪个目录',
  '我当前在哪个目录',
  'current directory',
  'what is the current directory',
])

export function shouldRevealCurrentDirectory(input: string): boolean {
  const normalized = normalizeInput(input)
  if (!normalized) return false
  if (EXACT_MATCHES.has(normalized)) return true

  return (
    normalized.includes('当前目录') ||
    normalized.includes('当前的目录') ||
    normalized.includes('在哪个目录') ||
    normalized.includes('current directory')
  )
}
