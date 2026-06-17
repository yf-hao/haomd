import { useEffect, useMemo, useRef, useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { Button } from './Button'
import { FieldGroup } from './FieldGroup'
import { TimeField } from './TimeField'
import { useI18n } from '../modules/i18n/I18nContext'
import {
  createRepeatAlarmRule,
  createSingleAlarmRule,
  loadAlarmRules,
  saveAlarmRules,
  updateAlarmRule,
} from '../modules/tools/alarm/alarmStorage'
import { toDateKey } from '../modules/tools/alarm/alarmRules'
import type { AlarmRule } from '../modules/tools/alarm/types'
import { importAlarmSound, loadAlarmSoundFiles, loadLatestAlarmSoundFile } from '../modules/tools/alarm/alarmSound'
import { playAlarmSound, stopAlarmSound } from '../modules/tools/alarm/alarmAudio'
import './ReminderToolDialog.css'

export type AlarmDialogProps = {
  open: boolean
  onClose: () => void
}

const WEEKDAYS_ZH = ['日', '一', '二', '三', '四', '五', '六']
const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DEFAULT_SOUND_HOVER_KEY = '__default__'

export function AlarmDialog({ open, onClose }: AlarmDialogProps) {
  const { resolvedLanguage: locale } = useI18n()
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const [rules, setRules] = useState<AlarmRule[]>([])
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftType, setDraftType] = useState<'single' | 'repeat'>('single')
  const [draftDate, setDraftDate] = useState(() => toDateKey(new Date()))
  const [draftStartDate, setDraftStartDate] = useState(() => toDateKey(new Date()))
  const [draftTime, setDraftTime] = useState('08:00')
  const [draftFrequency, setDraftFrequency] = useState<'weekly' | 'biweekly'>('weekly')
  const [draftWeekdays, setDraftWeekdays] = useState<number[]>([])
  const [draftUntilDate, setDraftUntilDate] = useState('')
  const [draftEnabled, setDraftEnabled] = useState(true)
  const [draftSoundFile, setDraftSoundFile] = useState<string | null>(null)
  const [soundFiles, setSoundFiles] = useState<string[]>([])
  const [soundPickerOpen, setSoundPickerOpen] = useState(false)
  const [hoveredSoundFile, setHoveredSoundFile] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const selectedRuleIdRef = useRef<string | null>(null)
  const weekdays = locale === 'en-US' ? WEEKDAYS_EN : WEEKDAYS_ZH
  const title = locale === 'en-US' ? 'Alarm' : '闹钟'

  const sortedRules = useMemo(() => {
    return [...rules].sort((a, b) => {
      const byDate = (a.date ?? a.startDate ?? '').localeCompare(b.date ?? b.startDate ?? '')
      if (byDate !== 0) return byDate
      const byTime = a.time.localeCompare(b.time)
      if (byTime !== 0) return byTime
      return a.createdAt.localeCompare(b.createdAt)
    })
  }, [rules])

  function resetDraft() {
    const today = toDateKey(new Date())
    setSelectedRuleId(null)
    setDraftTitle('')
    setDraftType('single')
    setDraftDate(today)
    setDraftStartDate(today)
    setDraftTime('08:00')
    setDraftFrequency('weekly')
    setDraftWeekdays([new Date().getDay()])
    setDraftUntilDate('')
    setDraftEnabled(true)
    setDraftSoundFile(null)
    setSoundPickerOpen(false)
    setHoveredSoundFile(null)
    void loadLatestAlarmSoundFile().then((fileName) => {
      if (selectedRuleIdRef.current === null) {
        setDraftSoundFile(fileName)
      }
    })
  }

  useEffect(() => {
    if (!open) return
    queueMicrotask(() => titleInputRef.current?.focus())
  }, [open, selectedRuleId])

  useEffect(() => {
    selectedRuleIdRef.current = selectedRuleId
  }, [selectedRuleId])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    queueMicrotask(() => resetDraft())
    void loadAlarmRules().then((items) => {
      if (!cancelled) setRules(items)
    })
    queueMicrotask(() => dialogRef.current?.focus())
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (open) return
    setPreviewing(false)
    void stopAlarmSound()
  }, [open])

  useEffect(() => {
    return () => {
      setPreviewing(false)
      void stopAlarmSound()
    }
  }, [])

  function persistRules(next: AlarmRule[]) {
    setRules(next)
    void saveAlarmRules(next)
  }

  function handleSelectRule(rule: AlarmRule) {
    setSelectedRuleId(rule.id)
    setDraftTitle(rule.title)
    setDraftType(rule.type)
    setDraftDate(rule.date ?? toDateKey(new Date()))
    setDraftStartDate(rule.startDate ?? rule.date ?? toDateKey(new Date()))
    setDraftTime(rule.time)
    setDraftFrequency(rule.frequency ?? 'weekly')
    setDraftWeekdays(rule.weekdays)
    setDraftUntilDate(rule.until ?? '')
    setDraftEnabled(rule.enabled)
    setDraftSoundFile(rule.soundFile)
    setHoveredSoundFile(null)
  }

  function handleSubmit() {
    const titleText = draftTitle.trim()
    if (!titleText) return
    if (draftType === 'single') {
      if (selectedRuleId) {
        const original = rules.find((rule) => rule.id === selectedRuleId)
        if (!original) return
        persistRules(rules.map((rule) => (
          rule.id === selectedRuleId
            ? updateAlarmRule(original, {
              title: titleText,
              type: 'single',
              date: draftDate,
              time: draftTime,
              enabled: draftEnabled,
              soundFile: draftSoundFile,
            })
            : rule
        )))
      } else {
        persistRules([
          ...rules,
          createSingleAlarmRule({
            title: titleText,
            date: draftDate,
            time: draftTime,
            soundFile: draftSoundFile,
          }),
        ])
      }
      resetDraft()
      return
    }

    const effectiveWeekdays = draftWeekdays.length > 0 ? draftWeekdays : [new Date(`${draftStartDate}T00:00:00`).getDay()]
    if (selectedRuleId) {
      const original = rules.find((rule) => rule.id === selectedRuleId)
      if (!original) return
      persistRules(rules.map((rule) => (
        rule.id === selectedRuleId
          ? updateAlarmRule(original, {
            title: titleText,
            type: 'repeat',
            startDate: draftStartDate,
            time: draftTime,
            frequency: draftFrequency,
            weekdays: effectiveWeekdays,
            until: draftUntilDate || null,
            enabled: draftEnabled,
            soundFile: draftSoundFile,
          })
          : rule
      )))
    } else {
      persistRules([
        ...rules,
        createRepeatAlarmRule({
          title: titleText,
          startDate: draftStartDate,
          time: draftTime,
          frequency: draftFrequency,
          weekdays: effectiveWeekdays,
          until: draftUntilDate || null,
          soundFile: draftSoundFile,
        }),
      ])
    }
    resetDraft()
  }

  function handleDelete(id: string) {
    persistRules(rules.filter((rule) => rule.id !== id))
    if (selectedRuleId === id) resetDraft()
  }

  const handleImportSound = async () => {
    const chosen = await openDialog({
      multiple: false,
      directory: false,
      title: locale === 'en-US' ? 'Choose alarm sound' : '选择闹钟音频',
      filters: [{ name: locale === 'en-US' ? 'Audio files' : '音频文件', extensions: ['wav', 'mp3', 'ogg', 'm4a', 'flac'] }],
    })
    const sourcePath = Array.isArray(chosen) ? chosen[0] : chosen
    if (!sourcePath || typeof sourcePath !== 'string') return
    const fileName = await importAlarmSound(sourcePath)
    if (!fileName) return
    setDraftSoundFile(fileName)
    const files = await loadAlarmSoundFiles()
    setSoundFiles(files)
  }

  const handleToggleSoundPicker = async () => {
    if (soundPickerOpen) {
      setSoundPickerOpen(false)
      setHoveredSoundFile(null)
      return
    }
    const files = soundFiles.length > 0 ? soundFiles : await loadAlarmSoundFiles()
    setSoundFiles(files)
    setSoundPickerOpen(true)
  }

  const handleSelectSound = (fileName: string | null) => {
    setDraftSoundFile(fileName)
    setSoundPickerOpen(false)
    setHoveredSoundFile(null)
  }

  const handlePreviewSound = async () => {
    if (previewing) {
      setPreviewing(false)
      await stopAlarmSound()
      return
    }
    setPreviewing(true)
    await playAlarmSound(draftSoundFile)
  }

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
                  {selectedRuleId ? (locale === 'en-US' ? 'Edit alarm' : '编辑闹钟') : (locale === 'en-US' ? 'New alarm' : '新建闹钟')}
                </div>
                <div className="reminder-tool-column-description">
                  {locale === 'en-US'
                    ? 'Configure single or repeat alarms.'
                    : '配置单次或重复闹钟。'}
                </div>
              </div>
              <div className="reminder-tool-column-badge">
                {locale === 'en-US' ? 'Alarm' : '闹钟'}
              </div>
            </div>

            <div className="reminder-tool-editor">
              <FieldGroup label={locale === 'en-US' ? 'Title' : '标题'}>
                <input ref={titleInputRef} className="field-input" type="text" value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} placeholder={locale === 'en-US' ? 'Alarm' : '闹钟'} />
              </FieldGroup>
              <FieldGroup label={locale === 'en-US' ? 'Type' : '类型'}>
                <select className="field-select" value={draftType} onChange={(e) => setDraftType(e.target.value as 'single' | 'repeat')}>
                  <option value="single">{locale === 'en-US' ? 'Single' : '单次'}</option>
                  <option value="repeat">{locale === 'en-US' ? 'Repeat' : '重复'}</option>
                </select>
              </FieldGroup>
              {draftType === 'single' ? (
                <FieldGroup label={locale === 'en-US' ? 'Date' : '日期'}>
                  <input className="field-input" type="date" value={draftDate} onChange={(e) => setDraftDate(e.target.value)} />
                </FieldGroup>
              ) : (
                <>
                  <FieldGroup label={locale === 'en-US' ? 'Start date' : '开始日期'}>
                    <input className="field-input" type="date" value={draftStartDate} onChange={(e) => setDraftStartDate(e.target.value)} />
                  </FieldGroup>
                  <FieldGroup label={locale === 'en-US' ? 'Frequency' : '频率'}>
                    <select className="field-select" value={draftFrequency} onChange={(e) => setDraftFrequency(e.target.value as 'weekly' | 'biweekly')}>
                      <option value="weekly">{locale === 'en-US' ? 'Weekly' : '每周'}</option>
                      <option value="biweekly">{locale === 'en-US' ? 'Every 2 weeks' : '每两周'}</option>
                    </select>
                  </FieldGroup>
                  <FieldGroup label={locale === 'en-US' ? 'Weekdays' : '周几'}>
                    <div className="reminder-tool-weekdays">
                      {weekdays.map((day, index) => (
                        <button
                          key={day}
                          type="button"
                          className={['reminder-tool-weekday', draftWeekdays.includes(index) ? 'active' : ''].filter(Boolean).join(' ')}
                          onClick={() => setDraftWeekdays((current) => (
                            current.includes(index) ? current.filter((item) => item !== index) : [...current, index]
                          ))}
                        >
                          {day}
                        </button>
                      ))}
                    </div>
                  </FieldGroup>
                  <FieldGroup label={locale === 'en-US' ? 'End date' : '结束日期'}>
                    <input className="field-input" type="date" value={draftUntilDate} onChange={(e) => setDraftUntilDate(e.target.value)} />
                  </FieldGroup>
                </>
              )}
              <FieldGroup label={locale === 'en-US' ? 'Time' : '时间'}>
                <TimeField
                  className="field-input reminder-tool-time"
                  lang="zh-CN"
                  value={draftTime}
                  onValueChange={setDraftTime}
                  aria-label={locale === 'en-US' ? 'Alarm time' : '闹钟时间'}
                />
              </FieldGroup>
              <FieldGroup label={locale === 'en-US' ? 'Sound' : '音效'}>
                <div className="reminder-tool-sound-row">
                  <button type="button" className="reminder-tool-sound-value" onClick={handleToggleSoundPicker}>
                    <span className="reminder-tool-sound-value-text">
                      {draftSoundFile ?? (locale === 'en-US' ? 'Default alarm' : '默认提示音')}
                    </span>
                    <span className="reminder-tool-sound-value-caret">▾</span>
                  </button>
                  {soundPickerOpen ? (
                    <div
                      className="reminder-tool-sound-picker"
                      onMouseLeave={() => setHoveredSoundFile(null)}
                    >
                      <button
                        type="button"
                        className={['reminder-tool-sound-picker-item', draftSoundFile === null && hoveredSoundFile !== null && hoveredSoundFile !== DEFAULT_SOUND_HOVER_KEY ? '' : draftSoundFile === null ? 'active' : ''].filter(Boolean).join(' ')}
                        onMouseEnter={() => setHoveredSoundFile(DEFAULT_SOUND_HOVER_KEY)}
                        onClick={() => handleSelectSound(null)}
                      >
                        {locale === 'en-US' ? 'Default alarm' : '默认提示音'}
                      </button>
                      {soundFiles.map((fileName) => (
                        <button
                          key={fileName}
                          type="button"
                          className={['reminder-tool-sound-picker-item', draftSoundFile === fileName && hoveredSoundFile !== null && hoveredSoundFile !== fileName ? '' : draftSoundFile === fileName ? 'active' : ''].filter(Boolean).join(' ')}
                          onMouseEnter={() => setHoveredSoundFile(fileName)}
                          onClick={() => handleSelectSound(fileName)}
                        >
                          {fileName}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="reminder-tool-sound-actions">
                    <Button variant="secondary" onClick={handleImportSound}>{locale === 'en-US' ? 'Import sound' : '导入音频'}</Button>
                    <Button variant="secondary" onClick={handlePreviewSound}>{previewing ? (locale === 'en-US' ? 'Stop' : '停止') : (locale === 'en-US' ? 'Preview' : '试听')}</Button>
                    <Button variant="tertiary" onClick={() => setDraftSoundFile(null)}>{locale === 'en-US' ? 'Default' : '恢复默认'}</Button>
                  </div>
                </div>
              </FieldGroup>
              <div className="reminder-tool-enable-row">
                <label className="reminder-tool-enable-label">
                  <input type="checkbox" checked={draftEnabled} onChange={(e) => setDraftEnabled(e.target.checked)} />
                  <span>{locale === 'en-US' ? 'Enabled' : '启用'}</span>
                </label>
              </div>
              <div className="reminder-tool-actions">
                <Button onClick={handleSubmit}>{selectedRuleId ? (locale === 'en-US' ? 'Save' : '保存') : (locale === 'en-US' ? 'Add' : '添加')}</Button>
                <Button variant="tertiary" onClick={resetDraft}>{locale === 'en-US' ? 'Reset' : '重置'}</Button>
              </div>
            </div>
          </div>

          <div className="reminder-tool-column reminder-tool-column-right">
            <div className="reminder-tool-column-header">
              <div className="reminder-tool-column-title">
                {locale === 'en-US' ? 'Alarm list' : '闹钟列表'}
              </div>
            </div>
            <div className="reminder-tool-list">
              {sortedRules.map((rule) => (
                <button
                  key={rule.id}
                  type="button"
                  className={['reminder-tool-item', selectedRuleId === rule.id ? 'active' : ''].filter(Boolean).join(' ')}
                  onClick={() => handleSelectRule(rule)}
                >
                  <div className="reminder-tool-item-row">
                    <div className="reminder-tool-item-title">{rule.title}</div>
                  </div>
                  <div className="reminder-tool-item-meta">
                    {rule.type === 'single'
                      ? `${rule.date ?? '--'} ${rule.time}`
                      : `${rule.time} · ${rule.frequency === 'biweekly' ? (locale === 'en-US' ? 'Every 2 weeks' : '每两周') : (locale === 'en-US' ? 'Weekly' : '每周')}`}
                  </div>
                  <div className="reminder-tool-item-meta reminder-tool-item-meta-secondary">
                    {rule.type === 'single'
                      ? (locale === 'en-US' ? 'Single alarm' : '单次闹钟')
                      : `${locale === 'en-US' ? 'Weekdays' : '周几'} ${rule.weekdays.length > 0 ? rule.weekdays.map((day: number) => weekdays[day] ?? String(day)).join(' ') : (locale === 'en-US' ? 'Default' : '默认')}`}
                  </div>
                  <div className="reminder-tool-item-footer">
                    <span
                      className={[
                        'reminder-tool-item-badge',
                        rule.enabled ? 'enabled' : 'disabled',
                      ].filter(Boolean).join(' ')}
                    >
                      {rule.enabled ? (locale === 'en-US' ? 'On' : '启用') : (locale === 'en-US' ? 'Off' : '停用')}
                    </span>
                  </div>
                  <button
                    className="reminder-tool-item-close"
                    type="button"
                    aria-label={locale === 'en-US' ? 'Delete' : '删除'}
                    onClick={(event) => {
                      event.stopPropagation()
                      handleDelete(rule.id)
                    }}
                  >
                    ×
                  </button>
                </button>
              ))}
              {sortedRules.length === 0 ? (
                <div className="reminder-tool-empty">
                  {locale === 'en-US' ? 'No alarms yet.' : '还没有闹钟。'}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
