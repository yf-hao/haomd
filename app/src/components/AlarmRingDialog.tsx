import { useEffect, useRef } from 'react'
import { Button } from './Button'
import { useI18n } from '../modules/i18n/I18nContext'
import { type ActiveAlarm } from '../modules/tools/alarm/useAlarmScheduler'
import { toDateKey } from '../modules/tools/alarm/alarmRules'
import './AlarmRingDialog.css'

export type AlarmRingDialogProps = {
  open: boolean
  alarm: ActiveAlarm | null
  onStop: () => void
  onSnooze: () => void
}

export function AlarmRingDialog({ open, alarm, onStop, onSnooze }: AlarmRingDialogProps) {
  const { resolvedLanguage: locale } = useI18n()
  const dialogRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    queueMicrotask(() => dialogRef.current?.focus())
  }, [open])

  if (!open || !alarm) return null

  const dayLabel = alarm.rule.date ?? alarm.rule.startDate ?? toDateKey(new Date(alarm.firedAt))
  const repeatLabel = alarm.rule.type === 'single'
    ? (locale === 'en-US' ? 'Single alarm' : '单次闹钟')
    : alarm.rule.frequency === 'biweekly'
      ? (locale === 'en-US' ? 'Every 2 weeks' : '每两周')
      : (locale === 'en-US' ? 'Weekly' : '每周')

  return (
    <div className="modal-backdrop alarm-ring-backdrop" onClick={onStop}>
      <div
        ref={dialogRef}
        className="modal modal-alarm-ring"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onStop()
          }
        }}
      >
        <div className="alarm-ring-card">
          <div className="alarm-ring-icon">⏰</div>
          <div className="alarm-ring-title">
            {locale === 'en-US' ? 'Alarm ringing' : '闹钟响了'}
          </div>
          <div className="alarm-ring-name">{alarm.rule.title}</div>
          <div className="alarm-ring-meta">
            <span>{alarm.rule.time}</span>
            <span>·</span>
            <span>{repeatLabel}</span>
            <span>·</span>
            <span>{dayLabel}</span>
          </div>
          <div className="alarm-ring-actions">
            <Button onClick={onStop}>{locale === 'en-US' ? 'Stop' : '停止'}</Button>
            <Button variant="secondary" onClick={onSnooze}>
              {locale === 'en-US' ? 'Snooze 5 min' : '稍后 5 分钟'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
