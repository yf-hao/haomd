import { invoke } from '@tauri-apps/api/core'
import type { BackendResult } from '../../platform/backendTypes'
import { isTauriEnv } from '../../platform/runtime'

export async function playPomodoroAlarm(alarmSoundFile?: string | null): Promise<void> {
  if (!isTauriEnv()) return
  try {
    const resp = await invoke<BackendResult<null>>('play_pomodoro_alarm', {
      alarmSoundFile,
    })
    if ('Err' in resp) {
      console.error('[pomodoro] play_pomodoro_alarm backend error', resp.Err.error)
    }
  } catch (error) {
    console.error('[pomodoro] play_pomodoro_alarm failed', error)
  }
}

export async function stopPomodoroAlarm(): Promise<void> {
  if (!isTauriEnv()) return
  try {
    const resp = await invoke<BackendResult<null>>('stop_pomodoro_alarm')
    if ('Err' in resp) {
      console.error('[pomodoro] stop_pomodoro_alarm backend error', resp.Err.error)
    }
  } catch (error) {
    console.error('[pomodoro] stop_pomodoro_alarm failed', error)
  }
}
