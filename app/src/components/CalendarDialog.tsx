import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  addCalendarMonths,
  addDays,
  addMonths,
  monthStart,
  sameCalendarDate,
} from '../modules/tools/calendar/dateUtils'
import { useI18n } from '../modules/i18n/I18nContext'
import {
  CALENDAR_REPEAT_RULES_UPDATED_EVENT,
  createCalendarReminder,
  calendarEntriesForDate,
  loadCalendarReminders,
  loadCalendarRepeatRules,
  remindersForDate,
  saveCalendarReminders,
  toDateKey,
  updateCalendarReminder,
  type CalendarRepeatRule,
  type CalendarReminder,
} from '../modules/tools/calendar/reminders'
import './CalendarDialog.css'

export type CalendarDialogProps = {
  open: boolean
  onClose: () => void
}

const WEEKDAYS_ZH = ['日', '一', '二', '三', '四', '五', '六']
const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function CalendarDialog({ open, onClose }: CalendarDialogProps) {
  const { resolvedLanguage: locale } = useI18n()
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const today = new Date()
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(new Date()))
  const [selectedDate, setSelectedDate] = useState(() => new Date())
  const [reminders, setReminders] = useState<CalendarReminder[]>([])
  const [repeatRules, setRepeatRules] = useState<CalendarRepeatRule[]>([])
  const [draftTitle, setDraftTitle] = useState('')
  const [draftTime, setDraftTime] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [reminderPanelOpen, setReminderPanelOpen] = useState(false)

  const calendarDays = useMemo(() => buildCalendarDays(visibleMonth), [visibleMonth])
  const selectedDateKey = toDateKey(selectedDate)
  const selectedDateEntries = useMemo(
    () => remindersForDate(reminders, selectedDateKey).filter((reminder) => reminder.id !== editingId),
    [editingId, reminders, selectedDateKey],
  )
  const selectedDateRepeatEntries = useMemo(
    () => calendarEntriesForDate(reminders, repeatRules, selectedDateKey).filter((entry) => entry.kind === 'repeat'),
    [reminders, repeatRules, selectedDateKey],
  )
  const weekdays = locale === 'en-US' ? WEEKDAYS_EN : WEEKDAYS_ZH
  const title = locale === 'en-US'
    ? `${visibleMonth.toLocaleString('en-US', { month: 'long' })} ${visibleMonth.getFullYear()}`
    : `${visibleMonth.getFullYear()}年${visibleMonth.getMonth() + 1}月`
  const selectedDateTitle = formatDatePanelTitle(selectedDate, locale)

  useEffect(() => {
    if (!open) return
    queueMicrotask(() => dialogRef.current?.focus())
  }, [open])

  useEffect(() => {
    let cancelled = false
    void loadCalendarReminders().then((items) => {
      if (!cancelled) setReminders(items)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const reload = () => {
      void loadCalendarRepeatRules().then((items) => {
        if (!cancelled) setRepeatRules(items)
      })
    }
    reload()
    const handleRepeatRulesUpdated = () => reload()
    window.addEventListener(CALENDAR_REPEAT_RULES_UPDATED_EVENT, handleRepeatRulesUpdated)
    return () => {
      cancelled = true
      window.removeEventListener(CALENDAR_REPEAT_RULES_UPDATED_EVENT, handleRepeatRulesUpdated)
    }
  }, [])

  useEffect(() => {
    if (!reminderPanelOpen) return
    queueMicrotask(() => titleInputRef.current?.focus())
  }, [reminderPanelOpen])

  function selectDate(date: Date) {
    setSelectedDate(date)
    setVisibleMonth(monthStart(date))
    setDraftTitle('')
    setDraftTime(getDefaultReminderTime())
    setEditingId(null)
  }

  function openReminderPanel(date = selectedDate) {
    selectDate(date)
    setReminderPanelOpen(true)
  }

  function closeReminderPanel() {
    setReminderPanelOpen(false)
    setDraftTitle('')
    setDraftTime(getDefaultReminderTime())
    setEditingId(null)
    queueMicrotask(() => dialogRef.current?.focus())
  }

  function selectToday() {
    selectDate(new Date())
  }

  function moveSelectedDate(nextDate: Date) {
    selectDate(nextDate)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (isInsideReminderPanel(event.target)) {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeReminderPanel()
      }
      return
    }

    switch (event.key) {
      case 'Escape':
        event.preventDefault()
        if (reminderPanelOpen) {
          closeReminderPanel()
        } else {
          onClose()
        }
        return
      case 'Enter':
        event.preventDefault()
        openReminderPanel()
        return
      case 'ArrowLeft':
        event.preventDefault()
        moveSelectedDate(addDays(selectedDate, -1))
        return
      case 'ArrowRight':
        event.preventDefault()
        moveSelectedDate(addDays(selectedDate, 1))
        return
      case 'ArrowUp':
        event.preventDefault()
        moveSelectedDate(addDays(selectedDate, -7))
        return
      case 'ArrowDown':
        event.preventDefault()
        moveSelectedDate(addDays(selectedDate, 7))
        return
      case 'PageUp':
        event.preventDefault()
        moveSelectedDate(addCalendarMonths(selectedDate, -1))
        return
      case 'PageDown':
        event.preventDefault()
        moveSelectedDate(addCalendarMonths(selectedDate, 1))
        return
      case 'Home':
        event.preventDefault()
        moveSelectedDate(addDays(selectedDate, -selectedDate.getDay()))
        return
      case 'End':
        event.preventDefault()
        moveSelectedDate(addDays(selectedDate, 6 - selectedDate.getDay()))
        return
      default:
    }
  }

  function persistReminders(next: CalendarReminder[]) {
    setReminders(next)
    void saveCalendarReminders(next)
  }

  function handleSubmitReminder() {
    const titleText = draftTitle.trim()
    if (!titleText) return
    const normalizedTime = normalizeReminderTime(draftTime)

    if (editingId) {
      const originalReminder = reminders.find((reminder) => reminder.id === editingId)
      if (!originalReminder) return
      persistReminders([
        ...reminders.filter((reminder) => reminder.id !== editingId),
        updateCalendarReminder(originalReminder, { date: selectedDateKey, time: normalizedTime, title: titleText }),
      ])
    } else {
      persistReminders([
        ...reminders,
        createCalendarReminder({ date: selectedDateKey, time: normalizedTime, title: titleText }),
      ])
    }

    setDraftTitle('')
    setDraftTime(getDefaultReminderTime())
    setEditingId(null)
  }

  function handleEditReminder(reminder: CalendarReminder) {
    setEditingId(reminder.id)
    setDraftTitle(reminder.title)
    setDraftTime(reminder.time || getDefaultReminderTime())
  }

  function handleDeleteReminder(id: string) {
    persistReminders(reminders.filter((reminder) => reminder.id !== id))
    if (editingId === id) {
      setEditingId(null)
      setDraftTitle('')
      setDraftTime(getDefaultReminderTime())
    }
  }

  function handleCancelEdit() {
    setEditingId(null)
    setDraftTitle('')
    setDraftTime(getDefaultReminderTime())
  }

  if (!open) return null

  return (
    <div
      ref={dialogRef}
      className="calendar-dialog-shell"
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <div className="modal modal-calendar-tool">
        <div className="calendar-dialog-header">
          <div>
            <div className="calendar-dialog-kicker">{locale === 'en-US' ? 'Tool' : '工具'}</div>
            <div className="calendar-dialog-title">{title}</div>
          </div>
          <button className="calendar-dialog-close" type="button" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="calendar-dialog-toolbar">
          <button type="button" className="calendar-nav-btn" onClick={() => setVisibleMonth((prev) => addMonths(prev, -1))}>
            {locale === 'en-US' ? 'Previous' : '上个月'}
          </button>
          <button type="button" className="calendar-nav-btn calendar-today-btn" onClick={selectToday}>
            {locale === 'en-US' ? 'Today' : '今天'}
          </button>
          <button type="button" className="calendar-nav-btn" onClick={() => setVisibleMonth((prev) => addMonths(prev, 1))}>
            {locale === 'en-US' ? 'Next' : '下个月'}
          </button>
        </div>

        <div className="calendar-main-stage">
          <div className="calendar-grid" role="grid">
            {weekdays.map((weekday) => (
              <div key={weekday} className="calendar-weekday">{weekday}</div>
            ))}
            {calendarDays.map((date) => {
              const isCurrentMonth = date.getMonth() === visibleMonth.getMonth()
              const isSelected = sameCalendarDate(date, selectedDate)
              const isToday = sameCalendarDate(date, today)
              const dateKey = toDateKey(date)
              const dayEntries = calendarEntriesForDate(reminders, repeatRules, dateKey)
              const reminderCount = dayEntries.length
              return (
                <button
                  type="button"
                  key={`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`}
                  className={[
                    'calendar-day',
                    isCurrentMonth ? '' : 'muted',
                    isSelected ? 'selected' : '',
                    isToday ? 'today' : '',
                  ].filter(Boolean).join(' ')}
                  aria-label={formatDateLabel(date, { isToday, isSelected, locale, reminderCount })}
                  aria-selected={isSelected}
                  role="gridcell"
                  onClick={() => selectDate(date)}
                  onDoubleClick={() => openReminderPanel(date)}
                >
                  <span className="calendar-day-number">{date.getDate()}</span>
                  {reminderCount > 0 ? (
                    <span className="calendar-day-reminders" aria-hidden="true">
                      {dayEntries.slice(0, 2).map((entry) => (
                        <span key={`${entry.kind}-${entry.id}`} className="calendar-day-reminder-line">
                          {entry.time ? `${entry.time} ` : ''}
                          {entry.title}
                        </span>
                      ))}
                      {reminderCount > 2 ? (
                        <span className="calendar-day-reminder-more">+{reminderCount - 2}</span>
                      ) : null}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {reminderPanelOpen ? (
        <div className="calendar-reminder-panel" role="dialog" aria-modal="false">
          <div className="calendar-reminder-panel-header">
            <div>
              <div className="calendar-reminder-kicker">{locale === 'en-US' ? 'Reminders' : '提醒'}</div>
              <div className="calendar-reminder-date">{selectedDateTitle}</div>
            </div>
            <div className="calendar-reminder-panel-meta">
              <span className="calendar-reminder-count">
                {locale === 'en-US' ? `${selectedDateEntries.length} item(s)` : `${selectedDateEntries.length} 条`}
              </span>
              <button className="calendar-reminder-close-btn" type="button" onClick={closeReminderPanel} aria-label="Close">×</button>
            </div>
          </div>

          <div className="calendar-reminder-form">
            <input
              className="calendar-reminder-time"
              type="text"
              inputMode="numeric"
              maxLength={5}
              placeholder="HH:mm"
              autoComplete="off"
              value={draftTime}
              onChange={(event) => setDraftTime(formatReminderTimeDraft(event.target.value))}
              onBlur={(event) => setDraftTime(normalizeReminderTime(event.target.value))}
              onFocus={(event) => {
                event.currentTarget.select()
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) return
                event.preventDefault()
                event.currentTarget.focus()
                event.currentTarget.select()
              }}
              aria-label={locale === 'en-US' ? 'Reminder time' : '提醒时间'}
            />
            <input
              ref={titleInputRef}
              className="calendar-reminder-title-input"
              type="text"
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              placeholder={locale === 'en-US' ? 'Reminder title' : '提醒内容'}
              aria-label={locale === 'en-US' ? 'Reminder title' : '提醒内容'}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  handleSubmitReminder()
                }
              }}
            />
            <button
              className="calendar-reminder-save-btn"
              type="button"
              disabled={!draftTitle.trim()}
              onClick={handleSubmitReminder}
            >
              {editingId ? (locale === 'en-US' ? 'Save' : '保存') : (locale === 'en-US' ? 'Add' : '添加')}
            </button>
            {editingId ? (
              <button className="calendar-reminder-cancel-btn" type="button" onClick={handleCancelEdit}>
                {locale === 'en-US' ? 'Cancel' : '取消'}
              </button>
            ) : null}
          </div>

          <div className="calendar-reminder-list">
            {selectedDateEntries.length === 0 ? (
              <div className="calendar-reminder-empty">
                {selectedDateRepeatEntries.length > 0
                  ? (locale === 'en-US' ? 'This day has repeat reminders. Manage them in Tools → Repeat Reminders.' : '这一天只有重复提醒，请在“工具 → 重复提醒”中管理。')
                  : (locale === 'en-US' ? 'No reminders for this day.' : '当天暂无提醒。')}
              </div>
            ) : selectedDateEntries.map((entry) => (
              <div
                key={entry.id}
                className={[
                  'calendar-reminder-item',
                  editingId === entry.id ? 'editing' : '',
                ].filter(Boolean).join(' ')}
              >
                <div className="calendar-reminder-item-main">
                  {entry.time ? <span className="calendar-reminder-item-time">{entry.time}</span> : null}
                  <span className="calendar-reminder-item-title">{entry.title}</span>
                </div>
                <div className="calendar-reminder-item-actions">
                  <button
                    type="button"
                    onClick={() => {
                      const reminder = reminders.find((item) => item.id === entry.id)
                      if (reminder) handleEditReminder(reminder)
                    }}
                  >
                    {locale === 'en-US' ? 'Edit' : '修改'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      handleDeleteReminder(entry.id)
                    }}
                  >
                    {locale === 'en-US' ? 'Delete' : '删除'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function buildCalendarDays(visibleMonth: Date): Date[] {
  const first = monthStart(visibleMonth)
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay())
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0)
  const end = new Date(last.getFullYear(), last.getMonth(), last.getDate() + (6 - last.getDay()))
  const days: Date[] = []
  for (let current = start; current <= end; current = addDays(current, 1)) {
    days.push(new Date(current))
  }
  return days
}

function formatDateLabel(
  date: Date,
  options: { isToday: boolean; isSelected: boolean; locale: 'zh-CN' | 'en-US'; reminderCount: number },
): string {
  if (options.locale === 'en-US') {
    const parts = [
      date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
      options.isToday ? 'today' : '',
      options.isSelected ? 'selected' : '',
      options.reminderCount > 0 ? `${options.reminderCount} reminder(s)` : '',
    ].filter(Boolean)
    return parts.join(', ')
  }

  const parts = [
    `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日，${WEEKDAYS_ZH[date.getDay()]}`,
    options.isToday ? '今天' : '',
    options.isSelected ? '已选中' : '',
    options.reminderCount > 0 ? `${options.reminderCount} 条提醒` : '',
  ].filter(Boolean)
  return parts.join('，')
}

function formatDatePanelTitle(date: Date, locale: 'zh-CN' | 'en-US'): string {
  if (locale === 'en-US') {
    return date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAYS_ZH[date.getDay()]}`
}

function isInsideReminderPanel(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest('.calendar-reminder-panel')
}

function formatReminderTimeDraft(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 4)
  if (digits.length <= 2) return digits
  return `${digits.slice(0, 2)}:${digits.slice(2)}`
}

function normalizeReminderTime(value: string): string {
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

function getDefaultReminderTime(now = new Date()): string {
  const roundedMinutes = Math.ceil(now.getMinutes() / 30) * 30
  const next = new Date(now)
  next.setSeconds(0, 0)
  next.setMinutes(roundedMinutes)
  if (roundedMinutes >= 60) {
    next.setHours(next.getHours() + 1, 0, 0, 0)
  }
  return `${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}`
}
