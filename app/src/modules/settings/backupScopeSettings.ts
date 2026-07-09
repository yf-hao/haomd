import { invoke } from '@tauri-apps/api/core'
import type { BackendResult } from '../platform/backendTypes'

export type BackupScopeSettings = {
  music: boolean
  documents: BackupDocumentsScopeSettings
  alarm: boolean
  notes: boolean
}

export type BackupDocumentsScopeSettings = {
  enabled: boolean
  selectedRoots: string[]
}

const defaultBackupScopeSettings: BackupScopeSettings = {
  music: false,
  documents: {
    enabled: false,
    selectedRoots: [],
  },
  alarm: false,
  notes: false,
}

let cachedBackupScopeSettings: BackupScopeSettings | null = null

function normalizeDocumentsScope(value: unknown): BackupDocumentsScopeSettings {
  if (typeof value === 'boolean') {
    return {
      enabled: value,
      selectedRoots: [],
    }
  }

  if (value && typeof value === 'object') {
    const candidate = value as Partial<BackupDocumentsScopeSettings>
    return {
      enabled: Boolean(candidate.enabled),
      selectedRoots: Array.isArray(candidate.selectedRoots)
        ? candidate.selectedRoots.filter((root): root is string => typeof root === 'string' && root.trim().length > 0)
        : [],
    }
  }

  return { ...defaultBackupScopeSettings.documents }
}

function normalizeBackupScopeSettings(value: Partial<BackupScopeSettings> | null | undefined): BackupScopeSettings {
  return {
    music: value?.music ?? defaultBackupScopeSettings.music,
    documents: normalizeDocumentsScope(value?.documents),
    alarm: value?.alarm ?? defaultBackupScopeSettings.alarm,
    notes: value?.notes ?? defaultBackupScopeSettings.notes,
  }
}

export async function loadBackupScopeSettings(): Promise<BackupScopeSettings> {
  if (cachedBackupScopeSettings) return cachedBackupScopeSettings
  try {
    const resp = await invoke<BackendResult<BackupScopeSettings>>('load_backup_scope_settings')
    if ('Ok' in resp) {
      cachedBackupScopeSettings = normalizeBackupScopeSettings(resp.Ok.data)
      return cachedBackupScopeSettings
    }
    console.error('[backupScopeSettings] load_backup_scope_settings backend error', resp.Err.error)
    cachedBackupScopeSettings = { ...defaultBackupScopeSettings }
    return cachedBackupScopeSettings
  } catch (error) {
    console.error('[backupScopeSettings] load_backup_scope_settings failed, using defaults', error)
    cachedBackupScopeSettings = { ...defaultBackupScopeSettings }
    return cachedBackupScopeSettings
  }
}

export async function saveBackupScopeSettings(settings: BackupScopeSettings): Promise<void> {
  const resp = await invoke<BackendResult<null>>('save_backup_scope_settings', { cfg: settings })
  if ('Err' in resp) {
    throw new Error(resp.Err.error.message || 'Failed to save backup scope settings')
  }
  cachedBackupScopeSettings = {
    ...settings,
    documents: {
      ...settings.documents,
      selectedRoots: [...settings.documents.selectedRoots],
    },
  }
}

export function getDefaultBackupScopeSettings(): BackupScopeSettings {
  return {
    ...defaultBackupScopeSettings,
    documents: { ...defaultBackupScopeSettings.documents },
  }
}

export function resetBackupScopeSettingsCache() {
  cachedBackupScopeSettings = null
}
