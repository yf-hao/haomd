import type { ThemeDefinition } from './schema'
import type { ResolvedThemeMode } from './themeResolver'
import { createThemeVariableMap } from './themeVariables'

export function applyThemeDefinition(theme: ThemeDefinition, resolvedMode: ResolvedThemeMode) {
  if (typeof document === 'undefined') return

  const root = document.documentElement
  root.dataset.theme = resolvedMode
  root.style.colorScheme = resolvedMode

  const variables = createThemeVariableMap(theme.tokens)
  for (const [name, value] of Object.entries(variables)) {
    root.style.setProperty(name, value)
  }
}
