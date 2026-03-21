import type { BuiltinThemeId, ThemeDefinition } from './schema'
import { darkTheme } from './themes/darkTheme'
import { lightTheme } from './themes/lightTheme'

const builtinThemes: Record<BuiltinThemeId, ThemeDefinition> = {
  light: lightTheme,
  dark: darkTheme,
}

export function getBuiltinThemeDefinition(id: BuiltinThemeId): ThemeDefinition {
  return builtinThemes[id]
}

export function listBuiltinThemes(): ThemeDefinition[] {
  return Object.values(builtinThemes)
}
