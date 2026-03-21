import { createContext, useContext, type ReactNode } from 'react'
import type { ThemeMode, ThemeDefinition } from './schema'
import type { ThemeSettings } from '../settings/editorSettings'
import type { ResolvedThemeMode } from './themeResolver'

export type ThemeContextValue = {
  selectedMode: ThemeMode
  themeSettings: ThemeSettings
  resolvedMode: ResolvedThemeMode
  activeTheme: ThemeDefinition
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeModeProvider({
  value,
  children,
}: Readonly<{
  value: ThemeContextValue
  children: ReactNode
}>) {
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useThemeContext(): ThemeContextValue {
  const value = useContext(ThemeContext)
  if (!value) {
    throw new Error('Theme context is not available')
  }
  return value
}

export function useResolvedThemeMode(): ResolvedThemeMode {
  return useThemeContext().resolvedMode
}

export function useActiveTheme(): ThemeDefinition {
  return useThemeContext().activeTheme
}
