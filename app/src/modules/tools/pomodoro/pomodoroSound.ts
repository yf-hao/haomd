import { invoke } from '@tauri-apps/api/core'
import type { BackendResult } from '../../platform/backendTypes'
import { isTauriEnv } from '../../platform/runtime'

type ImportedPomodoroAlarmSound = {
  fileName: string
  targetPath: string
}

export async function loadPomodoroAlarmSoundFiles(): Promise<string[]> {
  if (!isTauriEnv()) return []
  try {
    const resp = await invoke<BackendResult<string[]>>('list_pomodoro_alarm_sound_files')
    if ('Ok' in resp) {
      return resp.Ok.data
    }
    console.error('[pomodoro] list_pomodoro_alarm_sound_files backend error', resp.Err.error)
    return []
  } catch (error) {
    console.error('[pomodoro] list_pomodoro_alarm_sound_files failed', error)
    return []
  }
}

export async function loadLatestPomodoroAlarmSoundFile(): Promise<string | null> {
  const files = await loadPomodoroAlarmSoundFiles()
  return files[0] ?? null
}

export async function importPomodoroAlarmSound(sourcePath: string): Promise<string | null> {
  if (!isTauriEnv()) return null
  try {
    const normalizedSourcePath = normalizeFilePickerPath(sourcePath)
    console.info('[pomodoro][import] sourcePath=', sourcePath, 'normalizedSourcePath=', normalizedSourcePath)
    const resp = await invoke<BackendResult<ImportedPomodoroAlarmSound>>('import_pomodoro_alarm_sound', {
      sourcePath: normalizedSourcePath,
    })
    if ('Err' in resp) {
      console.error('[pomodoro] import_pomodoro_alarm_sound backend error', resp.Err.error)
      return null
    }
    console.info('[pomodoro][import] fileName=', resp.Ok.data.fileName, 'targetPath=', resp.Ok.data.targetPath)
    return resp.Ok.data.fileName
  } catch (error) {
    console.error('[pomodoro] import_pomodoro_alarm_sound failed', error)
    return null
  }
}

function normalizeFilePickerPath(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return trimmed
  if (!trimmed.startsWith('file://')) return trimmed
  try {
    return decodeURIComponent(new URL(trimmed).pathname)
  } catch {
    return trimmed
  }
}
