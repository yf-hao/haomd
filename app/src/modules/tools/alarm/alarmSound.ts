import { invoke } from '@tauri-apps/api/core'
import type { BackendResult } from '../../platform/backendTypes'
import { isTauriEnv } from '../../platform/runtime'

export type ImportedAlarmSound = {
  fileName: string
  targetPath: string
}

export async function loadAlarmSoundFiles(): Promise<string[]> {
  if (!isTauriEnv()) return []
  try {
    const resp = await invoke<BackendResult<string[]>>('list_alarm_sound_files')
    if ('Ok' in resp) {
      return resp.Ok.data
    }
    console.error('[alarm] list_alarm_sound_files backend error', resp.Err.error)
    return []
  } catch (error) {
    console.error('[alarm] list_alarm_sound_files failed', error)
    return []
  }
}

export async function loadLatestAlarmSoundFile(): Promise<string | null> {
  const files = await loadAlarmSoundFiles()
  return files[0] ?? null
}

export async function importAlarmSound(sourcePath: string): Promise<string | null> {
  if (!isTauriEnv()) return null
  try {
    const resp = await invoke<BackendResult<ImportedAlarmSound>>('import_alarm_sound', { sourcePath })
    if ('Ok' in resp) return resp.Ok.data.fileName
    console.error('[alarm] import_alarm_sound backend error', resp.Err.error)
    return null
  } catch (error) {
    console.error('[alarm] import_alarm_sound failed', error)
    return null
  }
}
