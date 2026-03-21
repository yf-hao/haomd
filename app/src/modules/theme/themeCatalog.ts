import type { BuiltinThemeId, ThemeDefinition } from './schema'
import { aiConsoleTheme } from './themes/aiConsoleTheme'
import { darkTheme } from './themes/darkTheme'
import { electricMintTheme } from './themes/electricMintTheme'
import { focusTheme } from './themes/focusTheme'
import { highContrastTheme } from './themes/highContrastTheme'
import { lightTheme } from './themes/lightTheme'
import { neonPopTheme } from './themes/neonPopTheme'
import { paperTheme } from './themes/paperTheme'
import { romanticTheme } from './themes/romanticTheme'
import { velvetRoseTheme } from './themes/velvetRoseTheme'

const builtinThemes: Record<BuiltinThemeId, ThemeDefinition> = {
  light: lightTheme,
  dark: darkTheme,
  romantic: romanticTheme,
  'electric-mint': electricMintTheme,
  'neon-pop': neonPopTheme,
  'ai-console': aiConsoleTheme,
  paper: paperTheme,
  focus: focusTheme,
  'high-contrast': highContrastTheme,
  'velvet-rose': velvetRoseTheme,
}

export function getBuiltinThemeDefinition(id: BuiltinThemeId): ThemeDefinition {
  return builtinThemes[id]
}

export function listBuiltinThemes(): ThemeDefinition[] {
  return Object.values(builtinThemes)
}
