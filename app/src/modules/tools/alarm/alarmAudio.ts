import { invoke } from '@tauri-apps/api/core'
import type { BackendResult } from '../../platform/backendTypes'
import { isTauriEnv } from '../../platform/runtime'

export async function playAlarmSound(alarmSoundFile?: string | null): Promise<void> {
  if (!isTauriEnv()) return
  try {
    await invoke<BackendResult<null>>('play_alarm_sound', { alarmSoundFile })
  } catch (error) {
    console.error('[alarm] play_alarm_sound failed', error)
  }
}

export async function stopAlarmSound(): Promise<void> {
  if (!isTauriEnv()) return
  try {
    await invoke<BackendResult<null>>('stop_alarm_sound')
  } catch (error) {
    console.error('[alarm] stop_alarm_sound failed', error)
  }
}
