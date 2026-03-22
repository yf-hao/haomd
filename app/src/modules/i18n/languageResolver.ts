import type { LanguageMode, ResolvedLanguage } from './schema'

export function normalizeLanguageTag(input: string | null | undefined): ResolvedLanguage {
  if (!input) return 'en-US'
  if (input.toLowerCase().startsWith('zh')) return 'zh-CN'
  return 'en-US'
}

export function getSystemResolvedLanguage(): ResolvedLanguage {
  if (typeof navigator === 'undefined') return 'en-US'
  const candidates =
    Array.isArray(navigator.languages) && navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language]
  for (const lang of candidates) {
    if (normalizeLanguageTag(lang) === 'zh-CN') return 'zh-CN'
  }
  return 'en-US'
}

export function resolveLanguageMode(mode: LanguageMode): ResolvedLanguage {
  if (mode === 'system') return getSystemResolvedLanguage()
  return mode
}
