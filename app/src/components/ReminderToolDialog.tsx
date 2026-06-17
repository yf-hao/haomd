import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../modules/i18n/I18nContext'
import { Button } from './Button'
import { FieldGroup } from './FieldGroup'
import { TimeField } from './TimeField'
import {
  createCalendarRepeatRule,
  loadCalendarRepeatRules,
  saveCalendarRepeatRules,
  toDateKey,
  updateCalendarRepeatRule,
  type CalendarRepeatRule,
} from '../modules/tools/calendar/reminders'
import './ReminderToolDialog.css'

export type ReminderToolDialogProps = {
  open: boolean
  onClose: () => void
}

const WEEKDAYS_ZH = ['日', '一', '二', '三', '四', '五', '六']
const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function ReminderToolDialog({ open, onClose }: ReminderToolDialogProps) {
  const { resolvedLanguage: locale } = useI18n()
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const [repeatRules, setRepeatRules] = useState<CalendarRepeatRule[]>([])
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftTime, setDraftTime] = useState('')
  const [draftStartDate, setDraftStartDate] = useState(() => toDateKey(new Date()))
  const [draftUntilDate, setDraftUntilDate] = useState('')
  const [draftFrequency, setDraftFrequency] = useState<'weekly' | 'biweekly'>('weekly')
  const [draftWeekdays, setDraftWeekdays] = useState<number[]>([])
  const [draftEnabled, setDraftEnabled] = useState(true)
  const weekdays = locale === 'en-US' ? WEEKDAYS_EN : WEEKDAYS_ZH
  const title = locale === 'en-US' ? 'Repeat Reminders' : '重复提醒'

  const sortedRules = useMemo(() => {
    return [...repeatRules].sort((a, b) => {
      const byDate = a.startDate.localeCompare(b.startDate)
      if (byDate !== 0) return byDate
      const byTime = a.time.localeCompare(b.time)
      if (byTime !== 0) return byTime
      return a.createdAt.localeCompare(b.createdAt)
    })
  }, [repeatRules])

  useEffect(() => {
    if (!open) return
    queueMicrotask(() => titleInputRef.current?.focus())
  }, [open, selectedRuleId])

  function persistRepeatRules(next: CalendarRepeatRule[]) {
    setRepeatRules(next)
    void saveCalendarRepeatRules(next)
  }

  function resetDraft() {
    const startDate = toDateKey(new Date())
    setSelectedRuleId(null)
    setDraftTitle('')
    setDraftTime('')
    setDraftStartDate(startDate)
    setDraftUntilDate('')
    setDraftFrequency('weekly')
    setDraftWeekdays([parseDateWeekday(startDate)])
    setDraftEnabled(true)
  }

  function handleSelectRule(rule: CalendarRepeatRule) {
    setSelectedRuleId(rule.id)
    setDraftTitle(rule.title)
    setDraftTime(rule.time)
    setDraftStartDate(rule.startDate)
    setDraftUntilDate(rule.until ?? '')
    setDraftFrequency(rule.frequency)
    setDraftWeekdays(rule.weekdays)
    setDraftEnabled(rule.enabled)
  }

  function handleSubmit() {
    const titleText = draftTitle.trim()
    if (!titleText) return
    const effectiveWeekdays = draftWeekdays.length > 0
      ? draftWeekdays
      : [parseDateWeekday(draftStartDate)]
    if (selectedRuleId) {
      const originalRule = repeatRules.find((rule) => rule.id === selectedRuleId)
      if (!originalRule) return
      persistRepeatRules(repeatRules.map((rule) => (
        rule.id === selectedRuleId
          ? updateCalendarRepeatRule(originalRule, {
            title: titleText,
            time: draftTime,
            startDate: draftStartDate,
            until: draftUntilDate || null,
            frequency: draftFrequency,
            weekdays: effectiveWeekdays,
            enabled: draftEnabled,
          })
          : rule
      )))
      resetDraft()
      return
    }

    persistRepeatRules([
      ...repeatRules,
      createCalendarRepeatRule({
        title: titleText,
        time: draftTime,
        startDate: draftStartDate,
        until: draftUntilDate || null,
        frequency: draftFrequency,
        weekdays: effectiveWeekdays,
      }),
    ])
    resetDraft()
  }

  function handleDelete(id: string) {
    persistRepeatRules(repeatRules.filter((rule) => rule.id !== id))
    if (selectedRuleId === id) resetDraft()
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    queueMicrotask(() => resetDraft())
    void loadCalendarRepeatRules().then((items) => {
      if (!cancelled) setRepeatRules(items)
    })
    queueMicrotask(() => dialogRef.current?.focus())
    return () => {
      cancelled = true
    }
  }, [open])

  if (!open) return null

  return (
    <div className="modal-backdrop reminder-tool-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal modal-reminder-tool"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
        }}
      >
        <div className="modal-title reminder-tool-title">{title}</div>
        <div className="modal-content reminder-tool-body">
          <div className="reminder-tool-column reminder-tool-column-left">
            <div className="reminder-tool-column-header reminder-tool-column-header-row">
              <div>
                <div className="reminder-tool-column-title">
                  {selectedRuleId ? (locale === 'en-US' ? 'Edit rule' : '编辑规则') : (locale === 'en-US' ? 'New rule' : '新建规则')}
                </div>
                <div className="reminder-tool-column-description">
                  {locale === 'en-US'
                    ? 'Configure repeat reminders and sync them to the calendar.'
                    : '配置重复提醒，并同步到日历中显示。'}
                </div>
              </div>
              <div className="reminder-tool-column-badge">
                {locale === 'en-US' ? 'Repeat' : '重复'}
              </div>
            </div>

            <div className="reminder-tool-editor">
              <FieldGroup label={locale === 'en-US' ? 'Title' : '标题'}>
                <input
                  ref={titleInputRef}
                  className="field-input"
                  type="text"
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  placeholder={locale === 'en-US' ? 'Meeting' : '开会'}
                />
              </FieldGroup>

              <FieldGroup label={locale === 'en-US' ? 'Time' : '时间'}>
                <TimeField
                  className="field-input reminder-tool-time"
                  lang="zh-CN"
                  value={draftTime}
                  onValueChange={setDraftTime}
                  aria-label={locale === 'en-US' ? 'Repeat reminder time' : '重复提醒时间'}
                />
              </FieldGroup>

              <FieldGroup label={locale === 'en-US' ? 'Start date' : '开始日期'}>
                <input
                  className="field-input"
                  type="date"
                  value={draftStartDate}
                  onChange={(event) => {
                    const nextStartDate = event.target.value
                    const currentStartWeekday = parseDateWeekday(draftStartDate)
                    const nextStartWeekday = parseDateWeekday(nextStartDate)
                    const shouldSyncWeekdays =
                      draftWeekdays.length === 0 ||
                      (draftWeekdays.length === 1 && draftWeekdays[0] === currentStartWeekday)

                    setDraftStartDate(nextStartDate)
                    if (shouldSyncWeekdays) {
                      setDraftWeekdays([nextStartWeekday])
                    }
                  }}
                />
              </FieldGroup>

              <FieldGroup label={locale === 'en-US' ? 'End date' : '结束日期'}>
                <input
                  className="field-input"
                  type="date"
                  value={draftUntilDate}
                  onChange={(event) => setDraftUntilDate(event.target.value)}
                />
              </FieldGroup>

              <FieldGroup label={locale === 'en-US' ? 'Frequency' : '频率'}>
                <select
                  className="field-select"
                  value={draftFrequency}
                  onChange={(event) => setDraftFrequency(event.target.value as 'weekly' | 'biweekly')}
                >
                  <option value="weekly">{locale === 'en-US' ? 'Weekly' : '每周'}</option>
                  <option value="biweekly">{locale === 'en-US' ? 'Every 2 weeks' : '每两周'}</option>
                </select>
              </FieldGroup>

              <FieldGroup label={locale === 'en-US' ? 'Weekdays' : '周几'}>
                <div className="reminder-tool-weekdays">
                  {weekdays.map((weekday, index) => {
                    const active = draftWeekdays.includes(index)
                    return (
                      <button
                        key={weekday}
                        type="button"
                        className={['reminder-tool-weekday', active ? 'active' : ''].filter(Boolean).join(' ')}
                        onClick={() => {
                          setDraftWeekdays((prev) => prev.includes(index)
                            ? prev.filter((item) => item !== index)
                            : [...prev, index].sort((a, b) => a - b))
                        }}
                      >
                        {weekday}
                      </button>
                    )
                  })}
                </div>
              </FieldGroup>

              <label className="reminder-tool-enabled">
                <input
                  type="checkbox"
                  checked={draftEnabled}
                  onChange={(event) => setDraftEnabled(event.target.checked)}
                />
                <span>{locale === 'en-US' ? 'Enabled' : '启用'}</span>
              </label>

              <div className="reminder-tool-actions">
                <Button variant="primary" type="button" onClick={handleSubmit} disabled={!draftTitle.trim()}>
                  {selectedRuleId ? (locale === 'en-US' ? 'Save' : '保存') : (locale === 'en-US' ? 'Add' : '添加')}
                </Button>
                {selectedRuleId ? (
                  <Button variant="tertiary" type="button" onClick={resetDraft}>
                    {locale === 'en-US' ? 'Cancel Edit' : '取消编辑'}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="reminder-tool-column reminder-tool-column-right">
            <div className="reminder-tool-column-header">
              <div className="reminder-tool-column-title">{locale === 'en-US' ? 'Rules' : '规则'}</div>
              <div className="reminder-tool-column-description">
                {locale === 'en-US'
                  ? `${sortedRules.length} item(s)`
                  : `${sortedRules.length} 条`}
              </div>
            </div>
            <div className="reminder-tool-list">
              {sortedRules.length === 0 ? (
                <div className="reminder-tool-empty">
                  {locale === 'en-US' ? 'No repeat reminders yet.' : '暂无重复提醒。'}
                </div>
              ) : sortedRules.map((rule) => (
                <button
                  key={rule.id}
                  type="button"
                  className={[
                    'reminder-tool-sidebar-item',
                    selectedRuleId === rule.id ? 'active' : '',
                  ].filter(Boolean).join(' ')}
                  title={[
                    rule.title,
                    rule.time,
                    draftFrequencyLabel(rule.frequency, locale),
                    formatWeekdaysLabel(rule.weekdays, locale),
                    `${locale === 'en-US' ? 'From' : '开始'} ${rule.startDate}`,
                    rule.until ? `${locale === 'en-US' ? 'Until' : '截至'} ${rule.until}` : '',
                    rule.enabled ? (locale === 'en-US' ? 'Enabled' : '启用') : (locale === 'en-US' ? 'Disabled' : '停用'),
                  ].filter(Boolean).join(' · ')}
                  onClick={() => handleSelectRule(rule)}
                  >
                    <button
                      type="button"
                      className="reminder-tool-sidebar-item-delete"
                      aria-label={locale === 'en-US' ? `Delete ${rule.title}` : `删除 ${rule.title}`}
                      title={locale === 'en-US' ? 'Delete rule' : '删除规则'}
                      onClick={(event) => {
                        event.stopPropagation()
                        handleDelete(rule.id)
                      }}
                    >
                      ×
                    </button>
                    <div className="reminder-tool-sidebar-item-main">
                      <span className="reminder-tool-sidebar-item-title">{rule.title}</span>
                      <span className="reminder-tool-sidebar-item-meta">
                        {[
                          rule.time,
                          draftFrequencyLabel(rule.frequency, locale),
                          `${locale === 'en-US' ? 'From' : '开始'} ${rule.startDate}`,
                          rule.until ? `${locale === 'en-US' ? 'Until' : '截至'} ${rule.until}` : '',
                        ].filter(Boolean).join(' · ')}
                      </span>
                      <span className="reminder-tool-sidebar-item-weekdays">
                        {formatWeekdaysLabel(rule.weekdays, locale)}
                      </span>
                    </div>
                    <span
                      className={[
                        'reminder-tool-sidebar-item-status',
                        rule.enabled ? 'on' : 'off',
                      ].join(' ')}
                    >
                      {rule.enabled ? (locale === 'en-US' ? 'Enabled' : '启用') : (locale === 'en-US' ? 'Disabled' : '停用')}
                    </span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="modal-actions reminder-tool-footer">
          <Button variant="primary" type="button" onClick={onClose}>
            {locale === 'en-US' ? 'Close' : '关闭'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function draftFrequencyLabel(frequency: CalendarRepeatRule['frequency'], locale: string): string {
  if (locale === 'en-US') {
    return frequency === 'biweekly' ? 'Every 2 weeks' : 'Weekly'
  }
  return frequency === 'biweekly' ? '每两周' : '每周'
}

function formatWeekdaysLabel(weekdays: number[], locale: string): string {
  const names = locale === 'en-US' ? WEEKDAYS_EN : WEEKDAYS_ZH
  const normalized = [...new Set(weekdays)].filter((weekday) => Number.isInteger(weekday) && weekday >= 0 && weekday <= 6)
  if (normalized.length === 0) return locale === 'en-US' ? 'Weekdays: —' : '周几：—'
  const joined = normalized
    .sort((a, b) => a - b)
    .map((weekday) => names[weekday])
    .join(locale === 'en-US' ? ', ' : '、')
  return locale === 'en-US' ? `Weekdays: ${joined}` : `周几：${joined}`
}

function parseDateWeekday(dateKey: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (!match) return new Date().getDay()
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const value = new Date(year, month, day)
  if (
    value.getFullYear() !== year ||
    value.getMonth() !== month ||
    value.getDate() !== day
  ) {
    return new Date().getDay()
  }
  return value.getDay()
}
