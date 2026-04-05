import { invoke } from '@tauri-apps/api/core'
import type { BackendResult } from '../platform/backendTypes'

export type WebDavBackupSettings = {
  enabled: boolean
  url: string
  username: string
  password: string
}

const defaultWebDavBackup: WebDavBackupSettings = {
  enabled: false,
  url: '',
  username: '',
  password: '',
}

let cachedBackupSettings: WebDavBackupSettings | null = null

export async function loadBackupSettings(): Promise<WebDavBackupSettings> {
  if (cachedBackupSettings) return cachedBackupSettings
  try {
    const resp = await invoke<BackendResult<WebDavBackupSettings>>('load_backup_settings')
    if ('Ok' in resp) {
      cachedBackupSettings = {
        enabled: resp.Ok.data?.enabled ?? defaultWebDavBackup.enabled,
        url: resp.Ok.data?.url ?? defaultWebDavBackup.url,
        username: resp.Ok.data?.username ?? defaultWebDavBackup.username,
        password: resp.Ok.data?.password ?? defaultWebDavBackup.password,
      }
      return cachedBackupSettings
    }
    console.error('[backupSettings] load_backup_settings backend error', resp.Err.error)
    cachedBackupSettings = { ...defaultWebDavBackup }
    return cachedBackupSettings
  } catch (e) {
    console.error('[backupSettings] load_backup_settings failed, using defaults', e)
    cachedBackupSettings = { ...defaultWebDavBackup }
    return cachedBackupSettings
  }
}

export async function saveBackupSettings(settings: WebDavBackupSettings): Promise<void> {
  const resp = await invoke<BackendResult<null>>('save_backup_settings', { cfg: settings })
  if ('Err' in resp) {
    throw new Error(resp.Err.error.message || 'Failed to save backup settings')
  }
  cachedBackupSettings = { ...settings }
}

export function getDefaultWebDavBackupSettings(): WebDavBackupSettings {
  return { ...defaultWebDavBackup }
}

export function resetBackupSettingsCache() {
  cachedBackupSettings = null
}
