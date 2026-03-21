import type { BuiltinThemeId, ThemeDefinition } from './schema'
import { darkTheme } from './themes/darkTheme'
import { lightTheme } from './themes/lightTheme'
import { romanticTheme } from './themes/romanticTheme'

const builtinThemes: Record<BuiltinThemeId, ThemeDefinition> = {
  light: lightTheme,
  dark: darkTheme,
  romantic: romanticTheme,
}

export function getBuiltinThemeDefinition(id: BuiltinThemeId): ThemeDefinition {
  return builtinThemes[id]
}

export function listBuiltinThemes(): ThemeDefinition[] {
  return Object.values(builtinThemes)
}
