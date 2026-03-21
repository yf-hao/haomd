import type { ThemeDefinition, ThemeMode } from './schema'
import { getBuiltinThemeDefinition } from './themeCatalog'

export type ResolvedThemeMode = 'light' | 'dark'

const systemThemeQuery = '(prefers-color-scheme: dark)'

export function resolveThemeMode(mode: ThemeMode, prefersDark: boolean): ResolvedThemeMode {
  if (mode === 'system') return prefersDark ? 'dark' : 'light'
  if (mode === 'custom') return prefersDark ? 'dark' : 'light'
  if (mode === 'romantic') return 'light'
  if (mode === 'electric-mint') return 'dark'
  if (mode === 'neon-pop') return 'dark'
  if (mode === 'ai-console') return 'dark'
  if (mode === 'paper') return 'light'
  if (mode === 'focus') return 'dark'
  if (mode === 'high-contrast') return 'light'
  if (mode === 'velvet-rose') return 'dark'
  return mode
}

export function getSystemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(systemThemeQuery).matches
}

export function subscribeSystemThemePreference(onChange: (prefersDark: boolean) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {}
  }

  const mediaQuery = window.matchMedia(systemThemeQuery)
  const listener = (event: MediaQueryListEvent) => onChange(event.matches)
  mediaQuery.addEventListener('change', listener)
  return () => mediaQuery.removeEventListener('change', listener)
}

export function resolveActiveTheme(mode: ThemeMode, prefersDark: boolean): ThemeDefinition {
  if (mode === 'romantic') return getBuiltinThemeDefinition('romantic')
  if (mode === 'electric-mint') return getBuiltinThemeDefinition('electric-mint')
  if (mode === 'neon-pop') return getBuiltinThemeDefinition('neon-pop')
  if (mode === 'ai-console') return getBuiltinThemeDefinition('ai-console')
  if (mode === 'paper') return getBuiltinThemeDefinition('paper')
  if (mode === 'focus') return getBuiltinThemeDefinition('focus')
  if (mode === 'high-contrast') return getBuiltinThemeDefinition('high-contrast')
  if (mode === 'velvet-rose') return getBuiltinThemeDefinition('velvet-rose')
  const resolvedMode = resolveThemeMode(mode, prefersDark)
  return getBuiltinThemeDefinition(resolvedMode)
}
