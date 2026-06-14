import { describe, expect, it } from 'vitest'
import { addCalendarMonths, addDays, addMonths, monthStart, sameCalendarDate } from './dateUtils'

describe('tools/calendar dateUtils', () => {
  it('compares calendar dates without comparing time', () => {
    expect(sameCalendarDate(
      new Date(2026, 5, 13, 8, 30),
      new Date(2026, 5, 13, 21, 15),
    )).toBe(true)
    expect(sameCalendarDate(
      new Date(2026, 5, 13),
      new Date(2026, 5, 14),
    )).toBe(false)
  })

  it('calculates month boundaries for calendar navigation', () => {
    expect(monthStart(new Date(2026, 5, 13)).toISOString()).toBe(new Date(2026, 5, 1).toISOString())
    expect(addMonths(new Date(2026, 5, 13), 1).toISOString()).toBe(new Date(2026, 6, 1).toISOString())
    expect(addMonths(new Date(2026, 0, 13), -1).toISOString()).toBe(new Date(2025, 11, 1).toISOString())
  })

  it('moves selected dates by day and calendar month', () => {
    expect(addDays(new Date(2026, 5, 13), 7).toISOString()).toBe(new Date(2026, 5, 20).toISOString())
    expect(addDays(new Date(2026, 5, 1), -1).toISOString()).toBe(new Date(2026, 4, 31).toISOString())
    expect(addCalendarMonths(new Date(2026, 0, 31), 1).toISOString()).toBe(new Date(2026, 1, 28).toISOString())
    expect(addCalendarMonths(new Date(2024, 0, 31), 1).toISOString()).toBe(new Date(2024, 1, 29).toISOString())
  })
})
