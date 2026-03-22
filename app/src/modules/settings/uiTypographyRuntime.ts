import type { UiTypographySettings } from './editorSettings'

const typographyVarEntries: Array<[string, keyof UiTypographySettings]> = [
  ['--ui-font-app', 'appFontSize'],
  ['--ui-font-settings', 'settingsFontSize'],
  ['--ui-font-sidebar', 'sidebarFontSize'],
  ['--ui-font-tabbar', 'tabBarFontSize'],
  ['--ui-font-statusbar', 'statusBarFontSize'],
  ['--ui-font-editor', 'editorFontSize'],
  ['--ui-font-preview', 'previewFontSize'],
  ['--ui-font-ai-chat-message', 'aiChatMessageFontSize'],
  ['--ui-font-ai-chat-input', 'aiChatInputFontSize'],
]

export function applyUiTypography(settings: UiTypographySettings) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  for (const [cssVar, key] of typographyVarEntries) {
    root.style.setProperty(cssVar, `${settings[key]}px`)
  }
}
