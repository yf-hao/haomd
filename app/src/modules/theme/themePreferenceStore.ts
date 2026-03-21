import {
  getDefaultThemeSettings,
  getThemeSettings,
  type ThemeSettings,
} from '../settings/editorSettings'

export async function loadThemePreference(): Promise<ThemeSettings> {
  try {
    return await getThemeSettings()
  } catch {
    return getDefaultThemeSettings()
  }
}
