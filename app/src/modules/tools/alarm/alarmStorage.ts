import { invoke } from '@tauri-apps/api/core'
import type { BackendResult } from '../../platform/backendTypes'
import { isTauriEnv } from '../../platform/runtime'
import { createAlarmRule, updateAlarmRule } from './alarmRules'
import { toDateKey } from './alarmRules'
import type { AlarmRule } from './types'

const STORAGE_KEY = 'haomd:alarm:rules:v1'

let cachedRules: AlarmRule[] | null = null

export async function loadAlarmRules(): Promise<AlarmRule[]> {
  if (cachedRules) return [...cachedRules]
  const fallback = readAlarmRulesFromLocalStorage()

  if (isTauriEnv()) {
    try {
      const resp = await invoke<BackendResult<AlarmRule[]>>('load_alarm_rules')
      if ('Ok' in resp) {
        cachedRules = resp.Ok.data
        return [...resp.Ok.data]
      }
    } catch {
      // fallback
    }
  }

  cachedRules = fallback
  return [...fallback]
}

export async function saveAlarmRules(rules: AlarmRule[]): Promise<void> {
  cachedRules = rules
  writeAlarmRulesToLocalStorage(rules)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('haomd:alarm-rules-updated'))
  }
  if (!isTauriEnv()) return
  try {
    await invoke<BackendResult<null>>('save_alarm_rules', { rules })
  } catch (error) {
    console.error('[alarm] save_alarm_rules failed', error)
  }
}

export function createSingleAlarmRule(input: { title: string; date?: string; time: string; soundFile?: string | null }): AlarmRule {
  return createAlarmRule({
    title: input.title,
    type: 'single',
    date: input.date ?? toDateKey(new Date()),
    time: input.time,
    soundFile: input.soundFile,
  })
}

export function createRepeatAlarmRule(input: {
  title: string
  startDate: string
  time: string
  weekdays: number[]
  frequency: 'weekly' | 'biweekly'
  until?: string | null
  soundFile?: string | null
}): AlarmRule {
  return createAlarmRule({
    title: input.title,
    type: 'repeat',
    startDate: input.startDate,
    time: input.time,
    weekdays: input.weekdays,
    frequency: input.frequency,
    until: input.until,
    soundFile: input.soundFile,
  })
}

export { updateAlarmRule }

function readAlarmRulesFromLocalStorage(): AlarmRule[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as AlarmRule[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAlarmRulesToLocalStorage(rules: AlarmRule[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules))
  } catch (error) {
    console.error('[alarm] write localStorage failed', error)
  }
}
