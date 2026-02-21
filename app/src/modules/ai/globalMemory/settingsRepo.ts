import { DEFAULT_GLOBAL_MEMORY_SETTINGS, type GlobalMemorySettings } from './types'

const SETTINGS_STORAGE_KEY = 'haomd_global_memory_settings_v1'

function isBrowserEnv(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

export function loadGlobalMemorySettings(): GlobalMemorySettings {
  if (!isBrowserEnv()) {
    return DEFAULT_GLOBAL_MEMORY_SETTINGS
  }

  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return DEFAULT_GLOBAL_MEMORY_SETTINGS

    const parsed = JSON.parse(raw) as Partial<GlobalMemorySettings> | null
    if (!parsed || typeof parsed !== 'object') {
      return DEFAULT_GLOBAL_MEMORY_SETTINGS
    }

    const base = DEFAULT_GLOBAL_MEMORY_SETTINGS

    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : base.enabled,
      autoUpdateEnabled:
        typeof parsed.autoUpdateEnabled === 'boolean'
          ? parsed.autoUpdateEnabled
          : base.autoUpdateEnabled,
      minDigests: typeof parsed.minDigests === 'number' ? parsed.minDigests : base.minDigests,
      minIntervalHours:
        typeof parsed.minIntervalHours === 'number'
          ? parsed.minIntervalHours
          : base.minIntervalHours,
      maxDigestsPerBatch:
        typeof parsed.maxDigestsPerBatch === 'number'
          ? parsed.maxDigestsPerBatch
          : base.maxDigestsPerBatch,
      maxAutoUpdatesPerDay:
        typeof parsed.maxAutoUpdatesPerDay === 'number'
          ? parsed.maxAutoUpdatesPerDay
          : base.maxAutoUpdatesPerDay,
    }
  } catch (e) {
    console.error('[globalMemorySettings] Failed to load settings:', e)
    return DEFAULT_GLOBAL_MEMORY_SETTINGS
  }
}

export function saveGlobalMemorySettings(settings: GlobalMemorySettings): void {
  if (!isBrowserEnv()) return

  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch (e) {
    console.error('[globalMemorySettings] Failed to save settings:', e)
  }
}
