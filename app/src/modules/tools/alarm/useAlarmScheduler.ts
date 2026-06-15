import { useCallback, useEffect, useRef, useState } from 'react'
import { isAlarmRuleDue, toDateKey, toTimeKey } from './alarmRules'
import { loadAlarmRules } from './alarmStorage'
import { playAlarmSound, stopAlarmSound } from './alarmAudio'
import type { AlarmRule } from './types'

const ALARM_SCAN_INTERVAL_MS = 15_000
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

  useEffect(() => {
    activeAlarmRef.current = activeAlarm
  }, [activeAlarm])

  const dismissAlarm = useCallback(() => {
    snoozeUntilRef.current = 0
    void stopAlarmSound()
    setActiveAlarm(null)
  }, [])

  const snoozeAlarm = useCallback(() => {
    if (!activeAlarmRef.current) return
    snoozeUntilRef.current = Date.now() + ALARM_SNOOZE_MINUTES * 60_000
    void stopAlarmSound()
    setActiveAlarm(null)
  }, [])

  useEffect(() => {
    let cancelled = false

    const scan = async () => {
      if (cancelled || scanningRef.current || activeAlarmRef.current) return
      if (snoozeUntilRef.current > Date.now()) return
      scanningRef.current = true
      try {
        const rules = await loadAlarmRules()
        if (cancelled || activeAlarmRef.current) return

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
      } finally {
        scanningRef.current = false
      }
    }

    void scan()
    const timer = window.setInterval(() => {
      void scan()
    }, ALARM_SCAN_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    return () => {
      void stopAlarmSound()
    }
  }, [])

  return {
    activeAlarm,
    dismissAlarm,
    snoozeAlarm,
  }
}
