export type CalendarReminder = {
  id: string
  date: string
  time: string
  title: string
  createdAt: string
  updatedAt: string
}

const STORAGE_KEY = 'haomd:calendar:reminders:v1'

export function toDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function loadCalendarReminders(): CalendarReminder[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isCalendarReminder).sort(compareReminder)
  } catch {
    return []
  }
}

export function saveCalendarReminders(reminders: CalendarReminder[]): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...reminders].sort(compareReminder)))
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

export function remindersForDate(reminders: CalendarReminder[], date: string): CalendarReminder[] {
  return reminders.filter((reminder) => reminder.date === date).sort(compareReminder)
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
