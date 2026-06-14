import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createCalendarReminder,
  loadCalendarReminders,
  remindersForDate,
  saveCalendarReminders,
  toDateKey,
  updateCalendarReminder,
  type CalendarReminder,
} from './reminders'

describe('tools/calendar reminders', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: createMemoryStorage(),
      configurable: true,
    })
  })

  afterEach(() => {
    globalThis.localStorage?.clear()
    Object.defineProperty(globalThis, 'localStorage', {
      value: undefined,
      configurable: true,
    })
    vi.restoreAllMocks()
  })

  it('formats local date keys', () => {
    expect(toDateKey(new Date(2026, 5, 14))).toBe('2026-06-14')
  })

  it('persists valid reminders and ignores invalid storage content', () => {
    const reminder: CalendarReminder = {
      id: 'r1',
      date: '2026-06-14',
      time: '09:30',
      title: 'Review notes',
      createdAt: '2026-06-14T00:00:00.000Z',
      updatedAt: '2026-06-14T00:00:00.000Z',
    }

    saveCalendarReminders([reminder])
    expect(loadCalendarReminders()).toEqual([reminder])

    localStorage.setItem('haomd:calendar:reminders:v1', '{bad json')
    expect(loadCalendarReminders()).toEqual([])
  })

  it('creates and updates reminders with normalized fields', () => {
    const reminder = createCalendarReminder({
      date: '2026-06-14',
      time: '9:00',
      title: '  Morning plan  ',
    })

    expect(reminder).toEqual(expect.objectContaining({
      date: '2026-06-14',
      time: '',
      title: 'Morning plan',
    }))
    expect(reminder.id.length).toBeGreaterThan(0)

    const updated = updateCalendarReminder(reminder, {
      time: '09:00',
      title: '  Updated plan ',
    })
    expect(updated.time).toBe('09:00')
    expect(updated.title).toBe('Updated plan')
  })

  it('accepts time values with seconds from native time inputs', () => {
    const reminder = createCalendarReminder({
      date: '2026-06-14',
      time: '09:30:00',
      title: 'With seconds',
    })

    expect(reminder.time).toBe('09:30')
  })

  it('normalizes meridiem time values to 24-hour format', () => {
    const noon = createCalendarReminder({
      date: '2026-06-14',
      time: '12:00 PM',
      title: 'Noon',
    })
    const midnight = createCalendarReminder({
      date: '2026-06-14',
      time: '12:00 AM',
      title: 'Midnight',
    })

    expect(noon.time).toBe('12:00')
    expect(midnight.time).toBe('00:00')
  })

  it('filters reminders by date and sorts by time', () => {
    const reminders: CalendarReminder[] = [
      makeReminder('r2', '2026-06-14', '18:00'),
      makeReminder('r1', '2026-06-14', '09:00'),
      makeReminder('r3', '2026-06-15', '08:00'),
    ]

    expect(remindersForDate(reminders, '2026-06-14').map((item) => item.id)).toEqual(['r1', 'r2'])
  })
})

function makeReminder(id: string, date: string, time: string): CalendarReminder {
  return {
    id,
    date,
    time,
    title: id,
    createdAt: `2026-06-14T00:00:0${id.slice(1)}.000Z`,
    updatedAt: `2026-06-14T00:00:0${id.slice(1)}.000Z`,
  }
}

function createMemoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => Array.from(data.keys())[index] ?? null,
    removeItem: (key) => {
      data.delete(key)
    },
    setItem: (key, value) => {
      data.set(key, value)
    },
  }
}
