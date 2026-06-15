import { createDefaultPomodoroState, DEFAULT_POMODORO_SETTINGS, type PomodoroSettings, type PomodoroState } from './types'

export function normalizePomodoroSettings(settings: Partial<PomodoroSettings> | undefined | null): PomodoroSettings {
  const focusMinutes = clampInteger(settings?.focusMinutes ?? DEFAULT_POMODORO_SETTINGS.focusMinutes, 1, 180)
  const shortBreakMinutes = clampInteger(settings?.shortBreakMinutes ?? DEFAULT_POMODORO_SETTINGS.shortBreakMinutes, 1, 60)
  const longBreakMinutes = clampInteger(settings?.longBreakMinutes ?? DEFAULT_POMODORO_SETTINGS.longBreakMinutes, 1, 120)
  const roundsBeforeLongBreak = clampInteger(settings?.roundsBeforeLongBreak ?? DEFAULT_POMODORO_SETTINGS.roundsBeforeLongBreak, 2, 12)
  const alarmSoundFile = normalizePomodoroAlarmSoundFile(settings?.alarmSoundFile)

  return {
    focusMinutes,
    shortBreakMinutes,
    longBreakMinutes,
    roundsBeforeLongBreak,
    alarmSoundFile,
  }
}

export function normalizePomodoroState(raw: Partial<PomodoroState> | null | undefined): PomodoroState {
  if (!raw || typeof raw !== 'object') return createDefaultPomodoroState()
  const settings = normalizePomodoroSettings(raw.settings)
  const state: PomodoroState = {
    mode: raw.mode === 'shortBreak' || raw.mode === 'longBreak' || raw.mode === 'focus' ? raw.mode : 'idle',
    running: Boolean(raw.running),
    remainingSeconds: clampInteger(raw.remainingSeconds ?? settings.focusMinutes * 60, 0, 24 * 60 * 60),
    cycleCount: clampInteger(raw.cycleCount ?? 0, 0, 9999),
    targetEndAt: typeof raw.targetEndAt === 'string' && raw.targetEndAt.trim() ? raw.targetEndAt : null,
    alarmVisible: Boolean(raw.alarmVisible),
    alarmReason: raw.alarmReason === 'focus-ended' || raw.alarmReason === 'break-ended' ? raw.alarmReason : null,
    settings,
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt.trim() ? raw.updatedAt : new Date().toISOString(),
  }
  if (state.mode === 'idle' && state.running) {
    state.running = false
  }
  if (!state.running) {
    state.targetEndAt = null
  }
  if (state.alarmVisible) {
    state.running = false
    state.targetEndAt = null
    state.remainingSeconds = 0
  }
  if (state.mode === 'idle' && state.remainingSeconds <= 0) {
    state.remainingSeconds = state.settings.focusMinutes * 60
  }
  return state
}

export function getDurationSecondsForMode(mode: PomodoroState['mode'], settings: PomodoroSettings): number {
  switch (mode) {
    case 'focus':
      return settings.focusMinutes * 60
    case 'shortBreak':
      return settings.shortBreakMinutes * 60
    case 'longBreak':
      return settings.longBreakMinutes * 60
    case 'idle':
    default:
      return settings.focusMinutes * 60
  }
}

export function getNextBreakMode(cycleCount: number, settings: PomodoroSettings): 'shortBreak' | 'longBreak' {
  return cycleCount % settings.roundsBeforeLongBreak === 0 ? 'longBreak' : 'shortBreak'
}

export function computeRemainingSeconds(state: PomodoroState, nowMs: number): number {
  if (!state.running || !state.targetEndAt) return state.remainingSeconds
  const targetMs = Date.parse(state.targetEndAt)
  if (Number.isNaN(targetMs)) return state.remainingSeconds
  return Math.max(0, Math.ceil((targetMs - nowMs) / 1000))
}

export function buildRunningState(
  current: PomodoroState,
  mode: PomodoroState['mode'],
  nowMs: number,
  remainingSeconds = getDurationSecondsForMode(mode, current.settings),
): PomodoroState {
  return {
    ...current,
    mode,
    running: true,
    remainingSeconds,
    targetEndAt: new Date(nowMs + remainingSeconds * 1000).toISOString(),
    alarmVisible: false,
    alarmReason: null,
    updatedAt: new Date().toISOString(),
  }
}

export function buildPausedState(current: PomodoroState, nowMs: number): PomodoroState {
  return {
    ...current,
    running: false,
    remainingSeconds: computeRemainingSeconds(current, nowMs),
    targetEndAt: null,
    updatedAt: new Date().toISOString(),
  }
}

export function buildAlarmState(current: PomodoroState, reason: NonNullable<PomodoroState['alarmReason']>): PomodoroState {
  return {
    ...current,
    running: false,
    remainingSeconds: 0,
    targetEndAt: null,
    alarmVisible: true,
    alarmReason: reason,
    updatedAt: new Date().toISOString(),
  }
}

export function buildResetState(current: PomodoroState): PomodoroState {
  return {
    ...current,
    mode: 'idle',
    running: false,
    remainingSeconds: current.settings.focusMinutes * 60,
    cycleCount: 0,
    targetEndAt: null,
    alarmVisible: false,
    alarmReason: null,
    updatedAt: new Date().toISOString(),
  }
}

export function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(Math.trunc(value), min), max)
}

export function normalizePomodoroAlarmSoundFile(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
