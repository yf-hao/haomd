export function sameCalendarDate(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

export function monthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1)
}

export function addDays(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta)
}

export function addCalendarMonths(date: Date, delta: number): Date {
  const targetYear = date.getFullYear()
  const targetMonth = date.getMonth() + delta
  const lastDay = daysInMonth(targetYear, targetMonth)
  return new Date(targetYear, targetMonth, Math.min(date.getDate(), lastDay))
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}
