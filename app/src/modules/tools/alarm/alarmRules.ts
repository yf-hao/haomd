import type { AlarmFrequency, AlarmRule, AlarmRuleType } from './types'

const MAX_LOOKAHEAD_DAYS = 370
const MS_PER_DAY = 24 * 60 * 60 * 1000
const MS_PER_WEEK = 7 * MS_PER_DAY

export type NextAlarmOccurrence = {
  rule: AlarmRule
  dueAt: Date
}

export function toDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function createAlarmRule(input: {
  title: string
  type: AlarmRuleType
  date?: string | null
  time: string
  startDate?: string | null
  frequency?: AlarmFrequency | null
  weekdays?: number[]
  until?: string | null
  soundFile?: string | null
}): AlarmRule {
  const now = new Date().toISOString()
  const type = input.type
  const frequency = type === 'repeat' ? (input.frequency ?? 'weekly') : null
  const startDate = type === 'repeat' ? (input.startDate ?? input.date ?? toDateKey(new Date())) : null
  return {
    id: createId(),
    title: input.title.trim(),
    type,
    date: type === 'single' ? (input.date ?? toDateKey(new Date())) : null,
    time: normalizeTime(input.time),
    startDate,
    frequency,
    weekdays: type === 'repeat' ? normalizeWeekdays(input.weekdays ?? [], startDate ?? toDateKey(new Date())) : [],
    intervalWeeks: type === 'repeat' ? (frequency === 'biweekly' ? 2 : 1) : null,
    until: type === 'repeat' ? (input.until ?? null) : null,
    enabled: true,
    soundFile: normalizeSoundFile(input.soundFile),
    createdAt: now,
    updatedAt: now,
  }
}

export function updateAlarmRule(rule: AlarmRule, patch: Partial<AlarmRule>): AlarmRule {
  const type = patch.type ?? rule.type
  const frequency = type === 'repeat'
    ? (patch.frequency ?? rule.frequency ?? 'weekly')
    : null
  const startDate = type === 'repeat'
    ? (patch.startDate ?? rule.startDate ?? patch.date ?? rule.date ?? toDateKey(new Date()))
    : null

  return {
    ...rule,
    title: patch.title == null ? rule.title : patch.title.trim(),
    type,
    date: type === 'single' ? (patch.date ?? rule.date) : null,
    time: patch.time == null ? rule.time : normalizeTime(patch.time),
    startDate,
    frequency,
    weekdays: type === 'repeat'
      ? normalizeWeekdays(patch.weekdays ?? rule.weekdays, startDate ?? toDateKey(new Date()))
      : [],
    intervalWeeks: type === 'repeat' ? (frequency === 'biweekly' ? 2 : 1) : null,
    until: type === 'repeat'
      ? (patch.until === undefined ? rule.until : patch.until)
      : null,
    enabled: patch.enabled ?? rule.enabled,
    soundFile: normalizeSoundFile(patch.soundFile ?? rule.soundFile),
    updatedAt: new Date().toISOString(),
  }
}

export function alarmRulesForDate(rules: AlarmRule[], date: string): AlarmRule[] {
  return rules.filter((rule) => matchesAlarmRule(rule, date)).sort(compareAlarmRule)
}

export function findNextAlarmOccurrence(rules: AlarmRule[], from = new Date()): NextAlarmOccurrence | null {
  let nextOccurrence: NextAlarmOccurrence | null = null

  for (const rule of rules) {
    const dueAt = getNextAlarmDueAt(rule, from)
    if (!dueAt) continue
    if (!nextOccurrence || dueAt.getTime() < nextOccurrence.dueAt.getTime()) {
      nextOccurrence = { rule, dueAt }
    }
  }

  return nextOccurrence
}

export function isAlarmRuleDue(rule: AlarmRule, now: Date): boolean {
  return matchesAlarmRule(rule, toDateKey(now)) && normalizeTime(rule.time) === toTimeKey(now)
}

export function matchesAlarmRule(rule: AlarmRule, date: string): boolean {
  if (!rule.enabled) return false
  if (rule.type === 'single') {
    return rule.date === date
  }
  if (!rule.startDate) return false
  if (date < rule.startDate) return false
  if (rule.until && date > rule.until) return false
  const weekdays = rule.weekdays.length > 0 ? rule.weekdays : [parseDateWeekday(rule.startDate)]
  const weekday = parseDateWeekday(date)
  if (!weekdays.includes(weekday)) return false
  const intervalWeeks = rule.intervalWeeks ?? (rule.frequency === 'biweekly' ? 2 : 1)
  const weekDiff = Math.floor((dateToUtc(date).getTime() - dateToUtc(rule.startDate).getTime()) / (7 * 24 * 60 * 60 * 1000))
  if (weekDiff < 0) return false
  return weekDiff % intervalWeeks === 0
}

function compareAlarmRule(a: AlarmRule, b: AlarmRule): number {
  const byDate = (a.date ?? a.startDate ?? '').localeCompare(b.date ?? b.startDate ?? '')
  if (byDate !== 0) return byDate
  const byTime = normalizeTime(a.time).localeCompare(normalizeTime(b.time))
  if (byTime !== 0) return byTime
  return a.createdAt.localeCompare(b.createdAt)
}

function getNextAlarmDueAt(rule: AlarmRule, from: Date): Date | null {
  if (!rule.enabled) return null
  const [hour, minute] = parseTime(normalizeTime(rule.time))
  if (rule.type === 'single') {
    if (!rule.date) return null
    const candidate = dateAtTime(rule.date, hour, minute)
    return candidate.getTime() >= from.getTime() ? candidate : null
  }

  if (!rule.startDate) return null
  const startDate = dateToUtc(rule.startDate)
  const untilDate = rule.until
  const weekdays = rule.weekdays.length > 0 ? rule.weekdays : [parseDateWeekday(rule.startDate)]
  const intervalWeeks = rule.intervalWeeks ?? (rule.frequency === 'biweekly' ? 2 : 1)
  const fromDate = dateToUtc(toDateKey(from))

  for (let offset = 0; offset <= MAX_LOOKAHEAD_DAYS; offset += 1) {
    const candidateDate = new Date(fromDate.getTime() + offset * MS_PER_DAY)
    const dateKey = toDateKey(candidateDate)
    if (dateKey < rule.startDate) continue
    if (untilDate && dateKey > untilDate) break
    if (!weekdays.includes(parseDateWeekday(dateKey))) continue
    const weekDiff = Math.floor((dateToUtc(dateKey).getTime() - startDate.getTime()) / MS_PER_WEEK)
    if (weekDiff < 0 || weekDiff % intervalWeeks !== 0) continue

    const candidate = dateAtTime(dateKey, hour, minute)
    if (candidate.getTime() >= from.getTime()) return candidate
  }

  return null
}

function normalizeWeekdays(weekdays: number[], startDate: string): number[] {
  const filtered = weekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
  if (filtered.length > 0) return Array.from(new Set(filtered)).sort((a, b) => a - b)
  return [parseDateWeekday(startDate)]
}

function normalizeTime(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return '00:00'
  const parts = trimmed.match(/^(\d{1,2}):(\d{1,2})$/)
  if (!parts) return trimmed
  const hh = String(Math.min(23, Math.max(0, Number(parts[1])))).padStart(2, '0')
  const mm = String(Math.min(59, Math.max(0, Number(parts[2])))).padStart(2, '0')
  return `${hh}:${mm}`
}

function normalizeSoundFile(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseTime(value: string): [number, number] {
  const parts = value.match(/^(\d{2}):(\d{2})$/)
  if (!parts) return [0, 0]
  return [Number(parts[1]), Number(parts[2])]
}

function parseDateWeekday(date: string): number {
  return dateToUtc(date).getUTCDay()
}

export function toTimeKey(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

function dateToUtc(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`)
}

function dateAtTime(date: string, hours: number, minutes: number): Date {
  const [year, month, day] = date.split('-').map((part) => Number(part))
  return new Date(year, month - 1, day, hours, minutes, 0, 0)
}

function createId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}
