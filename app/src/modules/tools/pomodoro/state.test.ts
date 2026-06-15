import { describe, expect, it } from 'vitest'
import {
  buildAlarmState,
  buildPausedState,
  buildResetState,
  buildRunningState,
  computeRemainingSeconds,
  getDurationSecondsForMode,
  getNextBreakMode,
  normalizePomodoroSettings,
  normalizePomodoroState,
  normalizePomodoroAlarmSoundFile,
} from './state'
import { createDefaultPomodoroState } from './types'

describe('pomodoro state helpers', () => {
  it('normalizes settings and state', () => {
    const state = normalizePomodoroState({
      mode: 'focus',
      running: true,
      remainingSeconds: 12,
      cycleCount: 3,
      targetEndAt: '2026-06-15T12:00:00.000Z',
      alarmVisible: false,
      alarmReason: null,
      settings: {
        focusMinutes: 30,
        shortBreakMinutes: 7,
        longBreakMinutes: 20,
        roundsBeforeLongBreak: 6,
        alarmSoundFile: '  alarm.wav  ',
      },
      updatedAt: '2026-06-15T00:00:00.000Z',
    })

    expect(state.mode).toBe('focus')
    expect(state.running).toBe(true)
    expect(state.settings.focusMinutes).toBe(30)
    expect(state.settings.alarmSoundFile).toBe('alarm.wav')
  })

  it('builds timers and transitions', () => {
    const current = createDefaultPomodoroState()
    const running = buildRunningState(current, 'focus', Date.parse('2026-06-15T00:00:00.000Z'), 1500)
    expect(running.running).toBe(true)
    expect(running.targetEndAt).toBe('2026-06-15T00:25:00.000Z')

    const paused = buildPausedState({ ...running, targetEndAt: '2026-06-15T00:24:00.000Z' }, Date.parse('2026-06-15T00:20:00.000Z'))
    expect(paused.running).toBe(false)
    expect(paused.remainingSeconds).toBe(240)

    const alarm = buildAlarmState(paused, 'focus-ended')
    expect(alarm.alarmVisible).toBe(true)
    expect(alarm.remainingSeconds).toBe(0)

    const reset = buildResetState(alarm)
    expect(reset.mode).toBe('idle')
    expect(reset.remainingSeconds).toBe(25 * 60)
  })

  it('computes durations and break rounds', () => {
    const settings = normalizePomodoroSettings({
      focusMinutes: 25,
      shortBreakMinutes: 5,
      longBreakMinutes: 15,
      roundsBeforeLongBreak: 4,
    })

    expect(getDurationSecondsForMode('focus', settings)).toBe(1500)
    expect(getDurationSecondsForMode('shortBreak', settings)).toBe(300)
    expect(getNextBreakMode(4, settings)).toBe('longBreak')
    expect(getNextBreakMode(3, settings)).toBe('shortBreak')
  })

  it('computes remaining seconds from a target end time', () => {
    const state = {
      ...createDefaultPomodoroState(),
      running: true,
      targetEndAt: '2026-06-15T00:10:00.000Z',
    }
    expect(computeRemainingSeconds(state, Date.parse('2026-06-15T00:09:30.000Z'))).toBe(30)
  })

  it('normalizes alarm sound file names', () => {
    expect(normalizePomodoroAlarmSoundFile(' alarm.wav ')).toBe('alarm.wav')
    expect(normalizePomodoroAlarmSoundFile('')).toBeNull()
    expect(normalizePomodoroAlarmSoundFile(null)).toBeNull()
  })
})
