import { createContext, useContext, type ReactNode } from 'react'
import type { ResolvedThemeMode } from './themeRuntime'

const ThemeModeContext = createContext<ResolvedThemeMode>('dark')

export function ThemeModeProvider({
  value,
  children,
}: Readonly<{
  value: ResolvedThemeMode
  children: ReactNode
}>) {
  return <ThemeModeContext.Provider value={value}>{children}</ThemeModeContext.Provider>
}

export function useResolvedThemeMode(): ResolvedThemeMode {
  return useContext(ThemeModeContext)
}
