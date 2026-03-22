import { invoke } from '@tauri-apps/api/core'
import type { BackendResult } from '../platform/backendTypes'
import type { LanguageMode } from '../i18n/schema'
import type { ThemeMode } from '../theme/schema'

export type AiCompressionSettings = {
  minMessagesToCompress: number
  keepRecentRounds: number
  maxMessagesAfterCompress: number
  maxMessagesPerSummaryBatch: number
}

export type HugeDocSettings = {
  enabled?: boolean
  lineThreshold?: number
  chunkContextLines?: number
  chunkMaxLines?: number
}

export type AiChatUiSettings = {
  maxVisibleMessagesDialog: number
  maxVisibleMessagesPane: number
}

export type ThemeSettings = {
  mode: ThemeMode
  customThemeId?: string | null
  editorBackground?: ThemeBackgroundSettings
  aiChatBackground?: ThemeBackgroundSettings
}

export type ThemeBackgroundSize = 'cover' | 'contain' | 'auto' | 'height-fill' | 'width-fill'

export type ThemeBackgroundSettings = {
  enabled: boolean
  path: string | null
  opacity: number
  overlayOpacity: number
  blurPx: number
  brightness: number
  size: ThemeBackgroundSize
  positionX: number
  positionY: number
}

export type ThemeEditorBackgroundSize = ThemeBackgroundSize
export type ThemeEditorBackgroundSettings = ThemeBackgroundSettings

export type WordExportStyleSettings = {
  bodyFontFamily: string
  bodyFontSizePt: number
  headingFontFamily: string
  heading1SizePt: number
  heading2SizePt: number
  heading3SizePt: number
  paragraphSpacingAfterPt: number
  lineSpacing: number
  codeFontSizePt: number
  pageMarginCm: number
}

export type EditorSettings = {
  aiCompression?: Partial<AiCompressionSettings>
  hugeDoc?: HugeDocSettings
  aiChat?: Partial<AiChatUiSettings>
  language?: LanguageMode
  theme?: Partial<ThemeSettings>
  wordExport?: Partial<WordExportStyleSettings>
}

const defaultCompression: AiCompressionSettings = {
  minMessagesToCompress: 80,
  keepRecentRounds: 8,
  maxMessagesAfterCompress: 200,
  maxMessagesPerSummaryBatch: 200,
}

const defaultHugeDoc: Required<HugeDocSettings> = {
  enabled: true,
  lineThreshold: 1000,
  chunkContextLines: 200,
  chunkMaxLines: 400,
}

const defaultAiChatUi: AiChatUiSettings = {
  maxVisibleMessagesDialog: 50,
  maxVisibleMessagesPane: 50,
}

const defaultLanguage: LanguageMode = 'system'

const defaultTheme: ThemeSettings = {
  mode: 'system',
  customThemeId: null,
  editorBackground: {
    enabled: false,
    path: null,
    opacity: 0.3,
    overlayOpacity: 0,
    blurPx: 1,
    brightness: 100,
    size: 'height-fill',
    positionX: 50,
    positionY: 50,
  },
  aiChatBackground: {
    enabled: false,
    path: null,
    opacity: 0.3,
    overlayOpacity: 0,
    blurPx: 1,
    brightness: 100,
    size: 'height-fill',
    positionX: 50,
    positionY: 50,
  },
}

const defaultWordExport: WordExportStyleSettings = {
  bodyFontFamily: 'Times New Roman',
  bodyFontSizePt: 12,
  headingFontFamily: 'Calibri',
  heading1SizePt: 16,
  heading2SizePt: 15,
  heading3SizePt: 14,
  paragraphSpacingAfterPt: 8,
  lineSpacing: 1.25,
  codeFontSizePt: 10.5,
  pageMarginCm: 2.54,
}

let cachedSettings: EditorSettings | null = null

export async function loadEditorSettings(): Promise<EditorSettings> {
  if (cachedSettings) return cachedSettings
  try {
    const resp = await invoke<BackendResult<EditorSettings>>('load_editor_settings')
    if ('Ok' in resp) {
      const settings = resp.Ok.data ?? {}
      cachedSettings = settings
      return settings
    }
    console.error('[editorSettings] load_editor_settings backend error', resp.Err.error)
    cachedSettings = {}
    return cachedSettings
  } catch (e) {
    console.error('[editorSettings] load_editor_settings failed, using defaults', e)
    cachedSettings = {}
    return cachedSettings
  }
}

export async function getAiCompressionSettings(): Promise<AiCompressionSettings> {
  const settings = await loadEditorSettings()
  const cfg = settings.aiCompression ?? {}
  return {
    minMessagesToCompress: cfg.minMessagesToCompress ?? defaultCompression.minMessagesToCompress,
    keepRecentRounds: cfg.keepRecentRounds ?? defaultCompression.keepRecentRounds,
    maxMessagesAfterCompress: cfg.maxMessagesAfterCompress ?? defaultCompression.maxMessagesAfterCompress,
    maxMessagesPerSummaryBatch: cfg.maxMessagesPerSummaryBatch ?? defaultCompression.maxMessagesPerSummaryBatch,
  }
}

export async function getHugeDocSettings(): Promise<{ enabled: boolean; lineThreshold: number; chunkContextLines: number; chunkMaxLines: number }> {
  const settings = await loadEditorSettings()
  const cfg = settings.hugeDoc ?? {}
  return {
    enabled: cfg.enabled ?? defaultHugeDoc.enabled,
    lineThreshold: cfg.lineThreshold ?? defaultHugeDoc.lineThreshold,
    chunkContextLines: cfg.chunkContextLines ?? defaultHugeDoc.chunkContextLines,
    chunkMaxLines: cfg.chunkMaxLines ?? defaultHugeDoc.chunkMaxLines,
  }
}

export async function getAiChatUiSettings(): Promise<AiChatUiSettings> {
  const settings = await loadEditorSettings()
  const cfg = settings.aiChat ?? {}
  return {
    maxVisibleMessagesDialog: cfg.maxVisibleMessagesDialog ?? defaultAiChatUi.maxVisibleMessagesDialog,
    maxVisibleMessagesPane: cfg.maxVisibleMessagesPane ?? defaultAiChatUi.maxVisibleMessagesPane,
  }
}

export async function getThemeSettings(): Promise<ThemeSettings> {
  const settings = await loadEditorSettings()
  const cfg = settings.theme ?? {}
  return {
    mode: cfg.mode ?? defaultTheme.mode,
    customThemeId: cfg.customThemeId ?? null,
    editorBackground: {
      enabled: cfg.editorBackground?.enabled ?? defaultTheme.editorBackground?.enabled ?? false,
      path: cfg.editorBackground?.path ?? defaultTheme.editorBackground?.path ?? null,
      opacity: cfg.editorBackground?.opacity ?? defaultTheme.editorBackground?.opacity ?? 0.3,
      overlayOpacity: cfg.editorBackground?.overlayOpacity ?? defaultTheme.editorBackground?.overlayOpacity ?? 0,
      blurPx: cfg.editorBackground?.blurPx ?? defaultTheme.editorBackground?.blurPx ?? 1,
      brightness: cfg.editorBackground?.brightness ?? defaultTheme.editorBackground?.brightness ?? 100,
      size: cfg.editorBackground?.size ?? defaultTheme.editorBackground?.size ?? 'height-fill',
      positionX: cfg.editorBackground?.positionX ?? defaultTheme.editorBackground?.positionX ?? 50,
      positionY: cfg.editorBackground?.positionY ?? defaultTheme.editorBackground?.positionY ?? 50,
    },
    aiChatBackground: {
      enabled: cfg.aiChatBackground?.enabled ?? defaultTheme.aiChatBackground?.enabled ?? false,
      path: cfg.aiChatBackground?.path ?? defaultTheme.aiChatBackground?.path ?? null,
      opacity: cfg.aiChatBackground?.opacity ?? defaultTheme.aiChatBackground?.opacity ?? 0.3,
      overlayOpacity: cfg.aiChatBackground?.overlayOpacity ?? defaultTheme.aiChatBackground?.overlayOpacity ?? 0,
      blurPx: cfg.aiChatBackground?.blurPx ?? defaultTheme.aiChatBackground?.blurPx ?? 1,
      brightness: cfg.aiChatBackground?.brightness ?? defaultTheme.aiChatBackground?.brightness ?? 100,
      size: cfg.aiChatBackground?.size ?? defaultTheme.aiChatBackground?.size ?? 'height-fill',
      positionX: cfg.aiChatBackground?.positionX ?? defaultTheme.aiChatBackground?.positionX ?? 50,
      positionY: cfg.aiChatBackground?.positionY ?? defaultTheme.aiChatBackground?.positionY ?? 50,
    },
  }
}

export async function getLanguageSetting(): Promise<LanguageMode> {
  const settings = await loadEditorSettings()
  return settings.language ?? defaultLanguage
}

export async function getWordExportStyleSettings(): Promise<WordExportStyleSettings> {
  const settings = await loadEditorSettings()
  const cfg = settings.wordExport ?? {}
  return {
    bodyFontFamily: cfg.bodyFontFamily ?? defaultWordExport.bodyFontFamily,
    bodyFontSizePt: cfg.bodyFontSizePt ?? defaultWordExport.bodyFontSizePt,
    headingFontFamily: cfg.headingFontFamily ?? defaultWordExport.headingFontFamily,
    heading1SizePt: cfg.heading1SizePt ?? defaultWordExport.heading1SizePt,
    heading2SizePt: cfg.heading2SizePt ?? defaultWordExport.heading2SizePt,
    heading3SizePt: cfg.heading3SizePt ?? defaultWordExport.heading3SizePt,
    paragraphSpacingAfterPt: cfg.paragraphSpacingAfterPt ?? defaultWordExport.paragraphSpacingAfterPt,
    lineSpacing: cfg.lineSpacing ?? defaultWordExport.lineSpacing,
    codeFontSizePt: cfg.codeFontSizePt ?? defaultWordExport.codeFontSizePt,
    pageMarginCm: cfg.pageMarginCm ?? defaultWordExport.pageMarginCm,
  }
}

export async function saveEditorSettings(settings: EditorSettings): Promise<void> {
  const resp = await invoke<BackendResult<null>>('save_editor_settings', { cfg: settings })
  if ('Err' in resp) {
    throw new Error(resp.Err.error.message || 'Failed to save settings')
  }
  cachedSettings = settings
}

export function getDefaultWordExportStyleSettings(): WordExportStyleSettings {
  return { ...defaultWordExport }
}

export function getDefaultThemeSettings(): ThemeSettings {
  return {
    ...defaultTheme,
    editorBackground: defaultTheme.editorBackground ? { ...defaultTheme.editorBackground } : undefined,
    aiChatBackground: defaultTheme.aiChatBackground ? { ...defaultTheme.aiChatBackground } : undefined,
  }
}

export function getDefaultLanguageSetting(): LanguageMode {
  return defaultLanguage
}

/** 仅供测试使用：清除单例缓存 */
export function resetSettingsCache() {
  cachedSettings = null
}
