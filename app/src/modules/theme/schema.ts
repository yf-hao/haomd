export type BuiltinThemeId =
  | 'light'
  | 'dark'
  | 'romantic'
  | 'electric-mint'
  | 'neon-pop'
  | 'ai-console'
  | 'paper'
  | 'focus'
  | 'high-contrast'
  | 'velvet-rose'

export type ThemeMode = 'system' | BuiltinThemeId | 'custom'

export type ThemeSurfaceTokens = {
  app: string
  shell: string
  sidebar: string
  panel: string
  status: string
  overlay: string
  modal: string
  input: string
  inputSoft: string
  inputSoftHover: string
  card: string
  cardActive: string
  editor: string
  editorGutter: string
  preview: string
  toolbar: string
  toolbarButton: string
  toolbarButtonStrong: string
  toolbarButtonHover: string
}

export type ThemeTextTokens = {
  default: string
  muted: string
  subtle: string
  accent: string
  toolbar: string
  toolbarMuted: string
  inverse: string
}

export type ThemeBorderTokens = {
  subtle: string
  strong: string
  input: string
  inputStrong: string
  toolbar: string
  toolbarHover: string
  separator: string
}

export type ThemeAccentTokens = {
  primary: string
  primarySoft: string
  primaryAlt: string
  primaryAltSoft: string
  success: string
  danger: string
  softDangerBg: string
  softDangerFg: string
  softAccentBg: string
}

export type ThemeRadiusTokens = {
  xs: string
  sm: string
  md: string
  lg: string
}

export type ThemeShadowTokens = {
  elevated: string
  modal: string
  card: string
}

export type ThemeEditorTokens = {
  gutterFg: string
  caret: string
  activeGutterBg: string
  activeLineMarker: string
}

export type ThemeComponentTokens = {
  sidebarHover: string
  sidebarActive: string
  focusRing: string
  selectionRing: string
  tabBarHeight: string
  dividerWidth: string
}

export type ThemeTokens = {
  surface: ThemeSurfaceTokens
  text: ThemeTextTokens
  border: ThemeBorderTokens
  accent: ThemeAccentTokens
  radius: ThemeRadiusTokens
  shadow: ThemeShadowTokens
  editor: ThemeEditorTokens
  component: ThemeComponentTokens
}

export type ThemeDefinition = {
  id: BuiltinThemeId | string
  label: string
  mode: BuiltinThemeId | 'custom'
  tokens: ThemeTokens
}
