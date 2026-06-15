import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildAlarmState, buildPausedState, buildResetState, buildRunningState, computeRemainingSeconds, getDurationSecondsForMode, getNextBreakMode, normalizePomodoroSettings } from './state'
import { loadPomodoroState, savePomodoroState } from './pomodoroStorage'
import { playPomodoroAlarm, stopPomodoroAlarm } from './pomodoroAudio'
import type { PomodoroMode, PomodoroState } from './types'
import { createDefaultPomodoroState } from './types'

const NOW_UPDATE_INTERVAL_MS = 1000

export type PomodoroController = {
  state: PomodoroState
  dialogOpen: boolean
  nowMs: number
  openDialog: () => void
  closeDialog: () => void
  startFocus: () => void
  pause: () => void
  resume: () => void
  reset: () => void
  updateSettings: (patch: Partial<PomodoroState['settings']>) => void
  dismissAlarmAndStartBreak: () => void
  dismissAlarmAndStartFocus: () => void
}

export function usePomodoroController(): PomodoroController {
  const [state, setState] = useState<PomodoroState>(() => createDefaultPomodoroState())
  const [dialogOpen, setDialogOpen] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const hydratedRef = useRef(false)
  const stateRef = useRef(state)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const persistState = useCallback(async (next: PomodoroState) => {
    if (!hydratedRef.current) return
    await savePomodoroState(next)
  }, [])

  const refreshNow = useCallback(() => {
    setNowMs(Date.now())
  }, [])

  const applyState = useCallback((next: PomodoroState, options?: { persist?: boolean; openDialog?: boolean }) => {
    setState(next)
    stateRef.current = next
    if (options?.openDialog === true) setDialogOpen(true)
    if (options?.openDialog === false) setDialogOpen(false)
    if (options?.persist !== false) {
      void persistState(next)
    }
  }, [persistState])

  useEffect(() => {
    let cancelled = false
    void loadPomodoroState().then((loaded) => {
      if (cancelled) return
      const normalized = createDefaultPomodoroState()
      const nextSettings = normalizePomodoroSettings(loaded.settings)
      const nextState: PomodoroState = {
        ...normalized,
        ...loaded,
        settings: nextSettings,
      }

      const now = Date.now()
      let hydratedState = nextState
      if (hydratedState.running && hydratedState.targetEndAt) {
        const remaining = computeRemainingSeconds(hydratedState, now)
        if (remaining <= 0) {
          hydratedState = buildAlarmState(hydratedState, hydratedState.mode === 'focus' ? 'focus-ended' : 'break-ended')
          setDialogOpen(true)
          void playPomodoroAlarm(hydratedState.settings.alarmSoundFile)
        } else {
          hydratedState = {
            ...hydratedState,
            remainingSeconds: remaining,
          }
        }
      } else if (hydratedState.alarmVisible) {
        setDialogOpen(true)
        void playPomodoroAlarm(hydratedState.settings.alarmSoundFile)
      }

      setState(hydratedState)
      stateRef.current = hydratedState
      hydratedRef.current = true
      setDialogOpen(hydratedState.alarmVisible)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!state.running && !state.alarmVisible) return
    const timer = window.setInterval(() => {
      setNowMs(Date.now())
    }, NOW_UPDATE_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [state.alarmVisible, state.running])

  useEffect(() => {
    if (!hydratedRef.current) return
    if (!state.running || state.alarmVisible || !state.targetEndAt) return
    const remaining = computeRemainingSeconds(state, nowMs)
    if (remaining > 0) return

    const alarmReason = state.mode === 'focus' ? 'focus-ended' : 'break-ended'
    const next = buildAlarmState({
      ...state,
      remainingSeconds: 0,
      targetEndAt: null,
    }, alarmReason)
    setDialogOpen(true)
    void playPomodoroAlarm(state.settings.alarmSoundFile)
    applyState(next)
  }, [applyState, nowMs, state])

  const openDialog = useCallback(() => setDialogOpen(true), [])
  const closeDialog = useCallback(() => {
    const current = stateRef.current
    if (current.alarmVisible) {
      void stopPomodoroAlarm()
      const next: PomodoroState = {
        ...current,
        mode: 'idle',
        running: false,
        remainingSeconds: current.settings.focusMinutes * 60,
        targetEndAt: null,
        alarmVisible: false,
        alarmReason: null,
        updatedAt: new Date().toISOString(),
      }
      applyState(next, { openDialog: false })
      return
    }
    setDialogOpen(false)
  }, [applyState])

  const startFocus = useCallback(() => {
    const current = stateRef.current
    void stopPomodoroAlarm()
    const now = Date.now()
    refreshNow()
    const next = buildRunningState(current, 'focus', now, getDurationSecondsForMode('focus', current.settings))
    applyState(next, { openDialog: true })
  }, [applyState, refreshNow])

  const pause = useCallback(() => {
    const current = stateRef.current
    if (!current.running) return
    void stopPomodoroAlarm()
    refreshNow()
    applyState(buildPausedState(current, Date.now()))
  }, [applyState, refreshNow])

  const resume = useCallback(() => {
    const current = stateRef.current
    if (current.running || current.mode === 'idle') return
    const mode: PomodoroMode = current.remainingSeconds > 0 ? current.mode : 'focus'
    const duration = current.remainingSeconds > 0
      ? current.remainingSeconds
      : getDurationSecondsForMode(mode, current.settings)
    const now = Date.now()
    refreshNow()
    const next = buildRunningState(current, mode, now, duration)
    applyState(next, { openDialog: true })
  }, [applyState, refreshNow])

  const reset = useCallback(() => {
    void stopPomodoroAlarm()
    refreshNow()
    applyState(buildResetState(stateRef.current), { openDialog: true })
  }, [applyState, refreshNow])

  const updateSettings = useCallback((patch: Partial<PomodoroState['settings']>) => {
    const current = stateRef.current
    const settings = normalizePomodoroSettings({
      ...current.settings,
      ...patch,
    })
    const next: PomodoroState = {
      ...current,
      settings,
      remainingSeconds: current.running && current.targetEndAt
        ? current.remainingSeconds
        : (current.mode === 'idle' ? settings.focusMinutes * 60 : getDurationSecondsForMode(current.mode, settings)),
      updatedAt: new Date().toISOString(),
    }
    applyState(next)
  }, [applyState])

  const dismissAlarmAndStartBreak = useCallback(() => {
    const current = stateRef.current
    if (!current.alarmVisible) return
    void stopPomodoroAlarm()
    const nextCycleCount = current.mode === 'focus' ? current.cycleCount + 1 : current.cycleCount
    const breakMode = current.mode === 'focus'
      ? getNextBreakMode(nextCycleCount, current.settings)
      : 'shortBreak'
    const next: PomodoroState = {
      ...current,
      mode: breakMode,
      running: true,
      remainingSeconds: getDurationSecondsForMode(breakMode, current.settings),
      targetEndAt: new Date(Date.now() + getDurationSecondsForMode(breakMode, current.settings) * 1000).toISOString(),
      cycleCount: nextCycleCount,
      alarmVisible: false,
      alarmReason: null,
      updatedAt: new Date().toISOString(),
    }
    refreshNow()
    applyState(next, { openDialog: true })
  }, [applyState, refreshNow])

  const dismissAlarmAndStartFocus = useCallback(() => {
    const current = stateRef.current
    if (!current.alarmVisible) return
    void stopPomodoroAlarm()
    const next: PomodoroState = {
      ...current,
      mode: 'focus',
      running: true,
      remainingSeconds: getDurationSecondsForMode('focus', current.settings),
      targetEndAt: new Date(Date.now() + getDurationSecondsForMode('focus', current.settings) * 1000).toISOString(),
      alarmVisible: false,
      alarmReason: null,
      updatedAt: new Date().toISOString(),
    }
    refreshNow()
    applyState(next, { openDialog: true })
  }, [applyState, refreshNow])

  const controller = useMemo<PomodoroController>(() => ({
    state,
    dialogOpen,
    nowMs,
    openDialog,
    closeDialog,
    startFocus,
    pause,
    resume,
    reset,
    updateSettings,
    dismissAlarmAndStartBreak,
    dismissAlarmAndStartFocus,
  }), [
    closeDialog,
    dialogOpen,
    dismissAlarmAndStartBreak,
    dismissAlarmAndStartFocus,
    nowMs,
    openDialog,
    pause,
    reset,
    resume,
    startFocus,
    state,
    updateSettings,
  ])

  return controller
}
