import type { ThemeMode } from '../settings/editorSettings'

export type ResolvedThemeMode = 'light' | 'dark'

const systemThemeQuery = '(prefers-color-scheme: dark)'

export function resolveThemeMode(mode: ThemeMode, prefersDark: boolean): ResolvedThemeMode {
  if (mode === 'system') {
    return prefersDark ? 'dark' : 'light'
  }
  return mode
}

export function getSystemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia(systemThemeQuery).matches
}

export function applyResolvedTheme(mode: ResolvedThemeMode) {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = mode
  document.documentElement.style.colorScheme = mode
}

export function subscribeSystemThemePreference(onChange: (prefersDark: boolean) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {}
  }

  const mediaQuery = window.matchMedia(systemThemeQuery)
  const listener = (event: MediaQueryListEvent) => {
    onChange(event.matches)
  }

  mediaQuery.addEventListener('change', listener)
  return () => {
    mediaQuery.removeEventListener('change', listener)
  }
}
