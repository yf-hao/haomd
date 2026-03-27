export function normalizeCodeBlockLanguage(value: string | null | undefined): string {
  const normalized = (value || '').trim().toLowerCase()
  if (!normalized) return ''

  switch (normalized) {
    case 'js':
    case 'jsx':
      return 'javascript'
    case 'ts':
    case 'tsx':
      return 'typescript'
    case 'py':
      return 'python'
    case 'sh':
    case 'shell':
    case 'zsh':
      return 'bash'
    case 'yml':
      return 'yaml'
    case 'md':
      return 'markdown'
    case 'c++':
    case 'cc':
    case 'cxx':
      return 'cpp'
    case 'c#':
    case 'cs':
      return 'csharp'
    case 'plaintext':
    case 'plain':
    case 'text':
    case 'txt':
      return ''
    default:
      return normalized
  }
}
