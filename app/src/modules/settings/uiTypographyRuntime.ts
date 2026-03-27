import type { UiTypographySettings } from './editorSettings'

const UI_TYPOGRAPHY_CHANGED_EVENT = 'haomd:ui-typography-changed'

const typographyVarEntries: Array<[string, keyof UiTypographySettings]> = [
  ['--ui-font-app', 'appFontSize'],
  ['--ui-font-settings', 'settingsFontSize'],
  ['--ui-font-sidebar', 'sidebarFontSize'],
  ['--ui-font-tabbar', 'tabBarFontSize'],
  ['--ui-font-statusbar', 'statusBarFontSize'],
  ['--ui-font-editor', 'editorFontSize'],
  ['--ui-font-preview', 'previewFontSize'],
  ['--ui-font-wysiwyg', 'wysiwygFontSize'],
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

export function emitUiTypographyChanged(settings: UiTypographySettings) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<UiTypographySettings>(UI_TYPOGRAPHY_CHANGED_EVENT, { detail: settings }))
}

export function subscribeUiTypographyChanged(listener: (settings: UiTypographySettings) => void) {
  if (typeof window === 'undefined') return () => {}
  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<UiTypographySettings>
    if (customEvent.detail) {
      listener(customEvent.detail)
    }
  }
  window.addEventListener(UI_TYPOGRAPHY_CHANGED_EVENT, handler)
  return () => window.removeEventListener(UI_TYPOGRAPHY_CHANGED_EVENT, handler)
}
