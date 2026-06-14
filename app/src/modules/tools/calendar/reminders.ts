import { invoke } from '@tauri-apps/api/core'
import type { BackendResult } from '../../platform/backendTypes'
import { isTauriEnv } from '../../platform/runtime'

export type CalendarReminder = {
  id: string
  date: string
  time: string
  title: string
  createdAt: string
  updatedAt: string
}

export type CalendarRepeatRule = {
  id: string
  title: string
  time: string
  startDate: string
  frequency: 'weekly' | 'biweekly'
  weekdays: number[]
  intervalWeeks?: number | null
  until?: string | null
  enabled: boolean
  createdAt: string
  updatedAt: string
}

const REMINDERS_STORAGE_KEY = 'haomd:calendar:reminders:v1'
const REPEAT_RULES_STORAGE_KEY = 'haomd:calendar:repeat-rules:v1'
export const CALENDAR_REPEAT_RULES_UPDATED_EVENT = 'haomd:calendar:repeat-rules-updated'

let cachedReminders: CalendarReminder[] | null = null
let cachedRepeatRules: CalendarRepeatRule[] | null = null

export function resetCalendarReminderCaches(): void {
  cachedReminders = null
  cachedRepeatRules = null
}

export function toDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export async function loadCalendarReminders(): Promise<CalendarReminder[]> {
  if (cachedReminders) return [...cachedReminders]
  const fallback = readRemindersFromLocalStorage()

  if (isTauriEnv()) {
    try {
      const resp = await invoke<BackendResult<CalendarReminder[]>>('load_calendar_reminders')
      if ('Ok' in resp) {
        const data = normalizeReminderList(resp.Ok.data)
        if (data.length === 0 && fallback.length > 0) {
          await saveCalendarReminders(fallback)
          return [...fallback]
        }
        cachedReminders = data
        return [...data]
      }
    } catch {
      // 回退到浏览器存储
    }
  }

  cachedReminders = fallback
  return [...fallback]
}

export async function saveCalendarReminders(reminders: CalendarReminder[]): Promise<void> {
  const normalized = normalizeReminderList(reminders)
  cachedReminders = normalized
  writeRemindersToLocalStorage(normalized)

  if (!isTauriEnv()) return
  try {
    const resp = await invoke<BackendResult<null>>('save_calendar_reminders', {
      reminders: normalized,
    })
    if ('Err' in resp) {
      console.error('[calendar.reminders] save_calendar_reminders backend error', resp.Err.error)
    }
  } catch (error) {
    console.error('[calendar.reminders] save_calendar_reminders failed', error)
  }
}

export async function loadCalendarRepeatRules(): Promise<CalendarRepeatRule[]> {
  if (cachedRepeatRules) return [...cachedRepeatRules]
  const fallback = readRepeatRulesFromLocalStorage()

  if (isTauriEnv()) {
    try {
      const resp = await invoke<BackendResult<CalendarRepeatRule[]>>('load_calendar_repeat_rules')
      if ('Ok' in resp) {
        const data = normalizeRepeatRuleList(resp.Ok.data)
        if (data.length === 0 && fallback.length > 0) {
          await saveCalendarRepeatRules(fallback)
          return [...fallback]
        }
        cachedRepeatRules = data
        return [...data]
      }
    } catch {
      // 回退到浏览器存储
    }
  }

  cachedRepeatRules = fallback
  return [...fallback]
}

export async function saveCalendarRepeatRules(rules: CalendarRepeatRule[]): Promise<void> {
  const normalized = normalizeRepeatRuleList(rules)
  cachedRepeatRules = normalized
  writeRepeatRulesToLocalStorage(normalized)
  notifyRepeatRulesUpdated()

  if (!isTauriEnv()) return
  try {
    const resp = await invoke<BackendResult<null>>('save_calendar_repeat_rules', {
      rules: normalized,
    })
    if ('Err' in resp) {
      console.error('[calendar.reminders] save_calendar_repeat_rules backend error', resp.Err.error)
    }
  } catch (error) {
    console.error('[calendar.reminders] save_calendar_repeat_rules failed', error)
  }
}

function notifyRepeatRulesUpdated(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(CALENDAR_REPEAT_RULES_UPDATED_EVENT))
}

export function createCalendarReminder(input: { date: string; time: string; title: string }): CalendarReminder {
  const now = new Date().toISOString()
  return {
    id: createId(),
    date: input.date,
    time: normalizeTime(input.time),
    title: input.title.trim(),
    createdAt: now,
    updatedAt: now,
  }
}

export function createCalendarRepeatRule(input: {
  startDate: string
  time: string
  title: string
  frequency: 'weekly' | 'biweekly'
  weekdays: number[]
  until?: string | null
}): CalendarRepeatRule {
  const now = new Date().toISOString()
  return {
    id: createId(),
    startDate: input.startDate,
    time: normalizeTime(input.time),
    title: input.title.trim(),
    frequency: input.frequency,
    weekdays: normalizeRepeatRuleWeekdays(input.weekdays, input.startDate),
    intervalWeeks: input.frequency === 'biweekly' ? 2 : 1,
    until: input.until ?? null,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  }
}

export function updateCalendarReminder(
  reminder: CalendarReminder,
  patch: { date?: string; time?: string; title?: string },
): CalendarReminder {
  return {
    ...reminder,
    date: patch.date ?? reminder.date,
    time: patch.time == null ? reminder.time : normalizeTime(patch.time),
    title: patch.title == null ? reminder.title : patch.title.trim(),
    updatedAt: new Date().toISOString(),
  }
}

export function updateCalendarRepeatRule(
  rule: CalendarRepeatRule,
  patch: {
    startDate?: string
    time?: string
    title?: string
    frequency?: 'weekly' | 'biweekly'
    weekdays?: number[]
    until?: string | null
    enabled?: boolean
  },
): CalendarRepeatRule {
  const frequency = patch.frequency ?? rule.frequency
  return {
    ...rule,
    startDate: patch.startDate ?? rule.startDate,
    time: patch.time == null ? rule.time : normalizeTime(patch.time),
    title: patch.title == null ? rule.title : patch.title.trim(),
    frequency,
    weekdays: normalizeRepeatRuleWeekdays(
      patch.weekdays ?? rule.weekdays,
      patch.startDate ?? rule.startDate,
    ),
    intervalWeeks: frequency === 'biweekly' ? 2 : 1,
    until: patch.until === undefined ? rule.until ?? null : patch.until,
    enabled: patch.enabled ?? rule.enabled,
    updatedAt: new Date().toISOString(),
  }
}

export function remindersForDate(reminders: CalendarReminder[], date: string): CalendarReminder[] {
  return reminders.filter((reminder) => reminder.date === date).sort(compareReminder)
}

export function repeatRulesForDate(rules: CalendarRepeatRule[], date: string): CalendarRepeatRule[] {
  return rules.filter((rule) => matchesRepeatRule(rule, date)).sort(compareRepeatRule)
}

export function calendarEntriesForDate(
  reminders: CalendarReminder[],
  repeatRules: CalendarRepeatRule[],
  date: string,
): Array<{ kind: 'single'; id: string; time: string; title: string } | { kind: 'repeat'; id: string; time: string; title: string }> {
  const singleEntries = remindersForDate(reminders, date).map((reminder) => ({
    kind: 'single' as const,
    id: reminder.id,
    time: reminder.time,
    title: reminder.title,
  }))
  const repeatEntries = repeatRulesForDate(repeatRules, date).map((rule) => ({
    kind: 'repeat' as const,
    id: rule.id,
    time: rule.time,
    title: rule.title,
  }))
  return [...singleEntries, ...repeatEntries].sort((a, b) => {
    const byTime = normalizeTime(a.time || '99:99').localeCompare(normalizeTime(b.time || '99:99'))
    if (byTime !== 0) return byTime
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind)
    return a.title.localeCompare(b.title)
  })
}

export function compareReminder(a: CalendarReminder, b: CalendarReminder): number {
  const byDate = a.date.localeCompare(b.date)
  if (byDate !== 0) return byDate
  const byTime = normalizeTime(a.time || '99:99').localeCompare(normalizeTime(b.time || '99:99'))
  if (byTime !== 0) return byTime
  return a.createdAt.localeCompare(b.createdAt)
}

function normalizeTime(value: string): string {
  const trimmed = value.trim()
  if (/^\d{2}:\d{2}$/.test(trimmed)) return trimmed
  const secondsMatch = /^(\d{2}:\d{2}):\d{2}$/.exec(trimmed)
  if (secondsMatch) return secondsMatch[1]
  const meridiemMatch = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])$/.exec(trimmed)
  if (meridiemMatch) {
    const hour = Number(meridiemMatch[1])
    const minute = meridiemMatch[2]
    const meridiem = meridiemMatch[3].toUpperCase()
    if (hour >= 1 && hour <= 12) {
      const normalizedHour = meridiem === 'AM'
        ? (hour === 12 ? 0 : hour)
        : (hour === 12 ? 12 : hour + 12)
      return `${String(normalizedHour).padStart(2, '0')}:${minute}`
    }
  }
  return ''
}

function readRemindersFromLocalStorage(): CalendarReminder[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(REMINDERS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return normalizeReminderList(parsed.filter(isCalendarReminder))
  } catch {
    return []
  }
}

function writeRemindersToLocalStorage(reminders: CalendarReminder[]): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(REMINDERS_STORAGE_KEY, JSON.stringify(reminders))
}

function readRepeatRulesFromLocalStorage(): CalendarRepeatRule[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(REPEAT_RULES_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return normalizeRepeatRuleList(parsed.filter(isCalendarRepeatRule))
  } catch {
    return []
  }
}

function writeRepeatRulesToLocalStorage(rules: CalendarRepeatRule[]): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(REPEAT_RULES_STORAGE_KEY, JSON.stringify(rules))
}

function normalizeReminderList(reminders: CalendarReminder[]): CalendarReminder[] {
  return [...reminders]
    .filter(isCalendarReminder)
    .map((reminder) => ({
      ...reminder,
      time: normalizeTime(reminder.time),
    }))
    .sort(compareReminder)
}

function normalizeRepeatRuleList(rules: CalendarRepeatRule[]): CalendarRepeatRule[] {
  return [...rules]
    .filter(isCalendarRepeatRule)
    .sort((a, b) => {
      const byDate = a.startDate.localeCompare(b.startDate)
      if (byDate !== 0) return byDate
      const byTime = normalizeTime(a.time || '99:99').localeCompare(normalizeTime(b.time || '99:99'))
      if (byTime !== 0) return byTime
      return a.createdAt.localeCompare(b.createdAt)
    })
}

function compareRepeatRule(a: CalendarRepeatRule, b: CalendarRepeatRule): number {
  const byStart = a.startDate.localeCompare(b.startDate)
  if (byStart !== 0) return byStart
  const byTime = normalizeTime(a.time || '99:99').localeCompare(normalizeTime(b.time || '99:99'))
  if (byTime !== 0) return byTime
  return a.createdAt.localeCompare(b.createdAt)
}

function matchesRepeatRule(rule: CalendarRepeatRule, date: string): boolean {
  if (!rule.enabled) return false
  const target = parseDateKey(date)
  const start = parseDateKey(rule.startDate)
  if (!target || !start) return false
  const until = rule.until ? parseDateKey(rule.until) : null
  if (until && target > until) return false
  if (target < start) return false
  if (!rule.weekdays.length) return false

  if (!rule.weekdays.includes(target.getDay())) return false

  const intervalWeeks = Math.max(rule.intervalWeeks ?? (rule.frequency === 'biweekly' ? 2 : 1), 1)
  const diffWeeks = Math.floor((weekStart(target).getTime() - weekStart(start).getTime()) / (7 * 86400000))
  if (diffWeeks < 0) return false
  return diffWeeks % intervalWeeks === 0
}

function weekStart(date: Date): Date {
  const value = new Date(date)
  value.setHours(0, 0, 0, 0)
  value.setDate(value.getDate() - value.getDay())
  return value
}

function parseDateKey(date: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const value = new Date(year, month, day)
  if (
    value.getFullYear() !== year ||
    value.getMonth() !== month ||
    value.getDate() !== day
  ) {
    return null
  }
  return value
}

function normalizeWeekdays(weekdays: number[]): number[] {
  return [...new Set(weekdays)]
    .map((weekday) => Math.floor(weekday))
    .filter((weekday) => Number.isInteger(weekday) && weekday >= 0 && weekday <= 6)
    .sort((a, b) => a - b)
}

function normalizeRepeatRuleWeekdays(weekdays: number[], startDate: string): number[] {
  const normalized = normalizeWeekdays(weekdays)
  if (normalized.length > 0) return normalized
  const start = parseDateKey(startDate)
  return start ? [start.getDay()] : [new Date().getDay()]
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `reminder_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function isCalendarReminder(value: unknown): value is CalendarReminder {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<CalendarReminder>
  return typeof item.id === 'string' &&
    typeof item.date === 'string' &&
    typeof item.time === 'string' &&
    typeof item.title === 'string' &&
    typeof item.createdAt === 'string' &&
    typeof item.updatedAt === 'string'
}

function isCalendarRepeatRule(value: unknown): value is CalendarRepeatRule {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<CalendarRepeatRule>
  return typeof item.id === 'string' &&
    typeof item.title === 'string' &&
    typeof item.time === 'string' &&
    typeof item.startDate === 'string' &&
    typeof item.frequency === 'string' &&
    Array.isArray(item.weekdays) &&
    typeof item.enabled === 'boolean' &&
    typeof item.createdAt === 'string' &&
    typeof item.updatedAt === 'string'
}
