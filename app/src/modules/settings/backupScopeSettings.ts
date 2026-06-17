import { invoke } from '@tauri-apps/api/core'
import type { BackendResult } from '../platform/backendTypes'

export type BackupScopeSettings = {
  music: boolean
  documents: boolean
  notes: boolean
}

const defaultBackupScopeSettings: BackupScopeSettings = {
  music: false,
  documents: false,
  notes: false,
}

let cachedBackupScopeSettings: BackupScopeSettings | null = null

export async function loadBackupScopeSettings(): Promise<BackupScopeSettings> {
  if (cachedBackupScopeSettings) return cachedBackupScopeSettings
  try {
    const resp = await invoke<BackendResult<BackupScopeSettings>>('load_backup_scope_settings')
    if ('Ok' in resp) {
      cachedBackupScopeSettings = {
        music: resp.Ok.data?.music ?? defaultBackupScopeSettings.music,
        documents: resp.Ok.data?.documents ?? defaultBackupScopeSettings.documents,
        notes: resp.Ok.data?.notes ?? defaultBackupScopeSettings.notes,
      }
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
  cachedBackupScopeSettings = { ...settings }
}

export function getDefaultBackupScopeSettings(): BackupScopeSettings {
  return { ...defaultBackupScopeSettings }
}

export function resetBackupScopeSettingsCache() {
  cachedBackupScopeSettings = null
}
