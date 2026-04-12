import { get, set } from 'idb-keyval'
import { emptySettings, type AiSettingsState } from '../../modules/ai/settings'
import type { WebLiteSettings, WebLiteSyncSettings } from '../domain/models'
import { createEmptyWebLiteSettings } from '../domain/models'
import { DB_KEYS, webLiteStore } from './indexedDb'

export const settingsRepoWeb = {
  async load(): Promise<WebLiteSettings> {
    const settings = await get<WebLiteSettings>(DB_KEYS.settings, webLiteStore)
    if (!settings) return createEmptyWebLiteSettings()
    return {
      ai: settings.ai ?? emptySettings,
      sync: settings.sync ?? null,
    }
  },

  async save(settings: WebLiteSettings): Promise<void> {
    await set(DB_KEYS.settings, settings, webLiteStore)
  },

  async loadAiSettings(): Promise<AiSettingsState> {
    const settings = await this.load()
    return settings.ai
  },

  async saveAiSettings(ai: AiSettingsState): Promise<void> {
    const current = await this.load()
    await this.save({ ...current, ai })
  },

  async loadSyncSettings(): Promise<WebLiteSyncSettings | null> {
    const settings = await this.load()
    return settings.sync ?? null
  },

  async saveSyncSettings(sync: WebLiteSyncSettings | null): Promise<void> {
    const current = await this.load()
    await this.save({ ...current, sync })
  },
}
