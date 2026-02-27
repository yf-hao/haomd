import { invoke } from '@tauri-apps/api/core'
import type { BackendResult } from '../platform/backendTypes'

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

export type EditorSettings = {
  aiCompression?: Partial<AiCompressionSettings>
  hugeDoc?: HugeDocSettings
  aiChat?: Partial<AiChatUiSettings>
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
  maxVisibleMessagesDialog: 10,
  maxVisibleMessagesPane: 10,
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

/** 仅供测试使用：清除单例缓存 */
export function resetSettingsCache() {
  cachedSettings = null
}

