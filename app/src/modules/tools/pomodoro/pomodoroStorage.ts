import { invoke } from '@tauri-apps/api/core'
import type { BackendResult } from '../../platform/backendTypes'
import { isTauriEnv } from '../../platform/runtime'
import { createDefaultPomodoroState, type PomodoroState } from './types'
import { normalizePomodoroState } from './state'

const STORAGE_KEY = 'haomd:pomodoro:state:v1'

export async function loadPomodoroState(): Promise<PomodoroState> {
  const fallback = readPomodoroStateFromLocalStorage()

  if (isTauriEnv()) {
    try {
      const resp = await invoke<BackendResult<PomodoroState>>('load_pomodoro_state')
      if ('Ok' in resp) {
        const state = normalizePomodoroState(resp.Ok.data)
        if (isEmptyState(state) && !isEmptyState(fallback)) {
          await savePomodoroState(fallback)
          return { ...fallback }
        }
        return state
      }
    } catch {
      // 回退到 localStorage
    }
  }

  return fallback
}

export async function savePomodoroState(state: PomodoroState): Promise<void> {
  const normalized = normalizePomodoroState(state)
  writePomodoroStateToLocalStorage(normalized)

  if (!isTauriEnv()) return
  try {
    const resp = await invoke<BackendResult<null>>('save_pomodoro_state', {
      state: normalized,
    })
    if ('Err' in resp) {
      console.error('[pomodoro] save_pomodoro_state backend error', resp.Err.error)
    }
  } catch (error) {
    console.error('[pomodoro] save_pomodoro_state failed', error)
  }
}

function readPomodoroStateFromLocalStorage(): PomodoroState {
  if (typeof localStorage === 'undefined') return createDefaultPomodoroState()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createDefaultPomodoroState()
    const parsed = JSON.parse(raw)
    return normalizePomodoroState(parsed)
  } catch {
    return createDefaultPomodoroState()
  }
}

function writePomodoroStateToLocalStorage(state: PomodoroState): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function isEmptyState(state: PomodoroState): boolean {
  const defaultState = createDefaultPomodoroState()
  return state.mode === defaultState.mode &&
    state.running === defaultState.running &&
    state.remainingSeconds === defaultState.remainingSeconds &&
    state.cycleCount === defaultState.cycleCount &&
    state.alarmVisible === defaultState.alarmVisible &&
    state.alarmReason === defaultState.alarmReason &&
    state.settings.focusMinutes === defaultState.settings.focusMinutes &&
    state.settings.shortBreakMinutes === defaultState.settings.shortBreakMinutes &&
    state.settings.longBreakMinutes === defaultState.settings.longBreakMinutes &&
    state.settings.roundsBeforeLongBreak === defaultState.settings.roundsBeforeLongBreak &&
    state.settings.alarmSoundFile === defaultState.settings.alarmSoundFile
}
