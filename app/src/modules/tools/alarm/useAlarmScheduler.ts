import { useCallback, useEffect, useRef, useState } from 'react'
import { findNextAlarmOccurrence, isAlarmRuleDue, toDateKey, toTimeKey, type NextAlarmOccurrence } from './alarmRules'
import { loadAlarmRules } from './alarmStorage'
import { playAlarmSound, stopAlarmSound } from './alarmAudio'
import type { AlarmRule } from './types'

const ALARM_SNOOZE_MINUTES = 5

export type ActiveAlarm = {
  rule: AlarmRule
  firedAt: string
}

export type UseAlarmSchedulerResult = {
  activeAlarm: ActiveAlarm | null
  dismissAlarm: () => void
  snoozeAlarm: () => void
}

export function useAlarmScheduler(): UseAlarmSchedulerResult {
  const [activeAlarm, setActiveAlarm] = useState<ActiveAlarm | null>(null)
  const activeAlarmRef = useRef<ActiveAlarm | null>(null)
  const snoozeUntilRef = useRef<number>(0)
  const firedKeysRef = useRef(new Set<string>())
  const scanningRef = useRef(false)
  const scheduleTimerRef = useRef<number | null>(null)
  const nextOccurrenceRef = useRef<NextAlarmOccurrence | null>(null)

  useEffect(() => {
    activeAlarmRef.current = activeAlarm
  }, [activeAlarm])

  const clearScheduleTimer = useCallback(() => {
    if (scheduleTimerRef.current != null) {
      window.clearTimeout(scheduleTimerRef.current)
      scheduleTimerRef.current = null
    }
  }, [])

  const computeNextOccurrence = useCallback(async (from = new Date()) => {
    const rules = await loadAlarmRules()
    const nextOccurrence = findNextAlarmOccurrence(rules, from)
    nextOccurrenceRef.current = nextOccurrence
    return nextOccurrence
  }, [])

  const armNextTimer = useCallback((nextOccurrence: NextAlarmOccurrence | null) => {
    clearScheduleTimer()
    if (!nextOccurrence) return
    if (activeAlarmRef.current) return
    if (snoozeUntilRef.current > Date.now()) return

    const delay = nextOccurrence.dueAt.getTime() - Date.now()
    if (delay <= 0) {
      void fireNextAlarm()
      return
    }

    scheduleTimerRef.current = window.setTimeout(() => {
      void fireNextAlarm()
    }, delay)
  }, [clearScheduleTimer])

  const refreshSchedule = useCallback(async (from = new Date()) => {
    const nextOccurrence = await computeNextOccurrence(from)
    armNextTimer(nextOccurrence)
  }, [armNextTimer, computeNextOccurrence])

  const dismissAlarm = useCallback(() => {
    snoozeUntilRef.current = 0
    void stopAlarmSound()
    setActiveAlarm(null)
    void refreshSchedule()
  }, [refreshSchedule])

  const snoozeAlarm = useCallback(() => {
    if (!activeAlarmRef.current) return
    snoozeUntilRef.current = Date.now() + ALARM_SNOOZE_MINUTES * 60_000
    void stopAlarmSound()
    setActiveAlarm(null)
    void refreshSchedule(new Date(snoozeUntilRef.current))
  }, [refreshSchedule])

  const fireNextAlarm = useCallback(async () => {
    if (scanningRef.current || activeAlarmRef.current) return
    if (snoozeUntilRef.current > Date.now()) return
    scanningRef.current = true
    try {
      const rules = await loadAlarmRules()
      if (activeAlarmRef.current) return
      const now = new Date()
      const dueRule = rules.find((rule) => isAlarmRuleDue(rule, now))
      if (!dueRule) return

      const fireKey = `${dueRule.id}:${toDateKey(now)}:${toTimeKey(now)}`
      if (firedKeysRef.current.has(fireKey)) return
      firedKeysRef.current.add(fireKey)

      setActiveAlarm({
        rule: dueRule,
        firedAt: now.toISOString(),
      })
      await playAlarmSound(dueRule.soundFile)
      void computeNextOccurrence(now)
    } finally {
      scanningRef.current = false
    }
  }, [computeNextOccurrence])

  useEffect(() => {
    void refreshSchedule()
    const handleRulesUpdated = () => {
      void refreshSchedule()
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshSchedule()
      }
    }
    const handleWindowFocus = () => {
      void refreshSchedule()
    }
    window.addEventListener('haomd:alarm-rules-updated', handleRulesUpdated)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleWindowFocus)

    return () => {
      clearScheduleTimer()
      window.removeEventListener('haomd:alarm-rules-updated', handleRulesUpdated)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleWindowFocus)
    }
  }, [clearScheduleTimer, refreshSchedule])

  useEffect(() => {
    return () => {
      clearScheduleTimer()
      void stopAlarmSound()
    }
  }, [clearScheduleTimer])

  useEffect(() => {
    if (activeAlarm) return
    void refreshSchedule()
  }, [activeAlarm, refreshSchedule])

  return {
    activeAlarm,
    dismissAlarm,
    snoozeAlarm,
  }
}
