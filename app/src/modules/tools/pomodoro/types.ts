export type PomodoroMode = 'idle' | 'focus' | 'shortBreak' | 'longBreak'

export type PomodoroAlarmReason = 'focus-ended' | 'break-ended' | null

export type PomodoroSettings = {
  focusMinutes: number
  shortBreakMinutes: number
  longBreakMinutes: number
  roundsBeforeLongBreak: number
  alarmSoundFile: string | null
}

export type PomodoroState = {
  mode: PomodoroMode
  running: boolean
  remainingSeconds: number
  cycleCount: number
  targetEndAt: string | null
  alarmVisible: boolean
  alarmReason: PomodoroAlarmReason
  settings: PomodoroSettings
  updatedAt: string
}

export const DEFAULT_POMODORO_SETTINGS: PomodoroSettings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  roundsBeforeLongBreak: 4,
  alarmSoundFile: null,
}

export function createDefaultPomodoroState(): PomodoroState {
  return {
    mode: 'idle',
    running: false,
    remainingSeconds: DEFAULT_POMODORO_SETTINGS.focusMinutes * 60,
    cycleCount: 0,
    targetEndAt: null,
    alarmVisible: false,
    alarmReason: null,
    settings: { ...DEFAULT_POMODORO_SETTINGS },
    updatedAt: new Date().toISOString(),
  }
}
