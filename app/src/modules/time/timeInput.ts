export function formatTimeDraft(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 4)
  if (digits.length <= 2) return digits
  return `${digits.slice(0, 2)}:${digits.slice(2)}`
}

export function normalizeTimeDraft(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 4)
  if (!digits) return ''

  const hourDigits = digits.slice(0, 2)
  const minuteDigits = digits.slice(2, 4)

  const hour = clampNumber(Number(hourDigits), 0, 23)
  const minute = minuteDigits ? clampNumber(Number(minuteDigits), 0, 59) : 0

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(Math.max(value, min), max)
}
