import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { Button } from './Button'
import { FieldGroup } from './FieldGroup'
import { useI18n } from '../modules/i18n/I18nContext'
import { type PomodoroController } from '../modules/tools/pomodoro/usePomodoroController'
import { computeRemainingSeconds } from '../modules/tools/pomodoro/state'
import {
  importPomodoroAlarmSound,
  loadLatestPomodoroAlarmSoundFile,
  loadPomodoroAlarmSoundFiles,
} from '../modules/tools/pomodoro/pomodoroSound'
import { playPomodoroAlarm, stopPomodoroAlarm } from '../modules/tools/pomodoro/pomodoroAudio'
import './PomodoroDialog.css'

export type PomodoroDialogProps = {
  open: boolean
  controller: PomodoroController
  onClose: () => void
}

const DEFAULT_SOUND_HOVER_KEY = '__default__'

export function PomodoroDialog({ open, controller, onClose }: PomodoroDialogProps) {
  const { resolvedLanguage: locale } = useI18n()
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [soundFiles, setSoundFiles] = useState<string[]>([])
  const [soundPickerOpen, setSoundPickerOpen] = useState(false)
  const [hoveredSoundFile, setHoveredSoundFile] = useState<string | null>(null)
  const hasInitializedSoundSelectionRef = useRef(false)
  const state = controller.state
  const remainingSeconds = useMemo(
    () => computeRemainingSeconds(state, controller.nowMs),
    [controller.nowMs, state],
  )
  const soundFileLabel = state.settings.alarmSoundFile ?? (locale === 'en-US' ? 'Default alarm' : '默认提示音')

  const handleImportSound = useCallback(async () => {
    const chosen = await openDialog({
      multiple: false,
      directory: false,
      title: locale === 'en-US' ? 'Choose alarm sound' : '选择提示音',
      filters: [
        {
          name: locale === 'en-US' ? 'Audio files' : '音频文件',
          extensions: ['wav', 'mp3', 'ogg', 'm4a', 'flac'],
        },
      ],
    })
    const sourcePath = Array.isArray(chosen) ? chosen[0] : chosen
    console.info('[pomodoro][ui] choose sound result=', chosen)
    if (!sourcePath || typeof sourcePath !== 'string') return
    console.info('[pomodoro][ui] importing sound from=', sourcePath)
    const fileName = await importPomodoroAlarmSound(sourcePath)
    if (!fileName) return
    hasInitializedSoundSelectionRef.current = true
    controller.updateSettings({ alarmSoundFile: fileName })
  }, [controller, locale])

  const handleRestoreDefaultSound = useCallback(() => {
    hasInitializedSoundSelectionRef.current = true
    controller.updateSettings({ alarmSoundFile: null })
  }, [controller])

  const handleToggleSoundPicker = useCallback(async () => {
    if (soundPickerOpen) {
      setSoundPickerOpen(false)
      setHoveredSoundFile(null)
      return
    }
    const files = soundFiles.length > 0 ? soundFiles : await loadPomodoroAlarmSoundFiles()
    setSoundFiles(files)
    setSoundPickerOpen(true)
  }, [soundFiles, soundPickerOpen])

  const handleSelectSound = useCallback((fileName: string | null) => {
    hasInitializedSoundSelectionRef.current = true
    controller.updateSettings({ alarmSoundFile: fileName })
    setSoundPickerOpen(false)
    setHoveredSoundFile(null)
  }, [controller])

  const handlePreviewSound = useCallback(async () => {
    if (previewing) {
      setPreviewing(false)
      await stopPomodoroAlarm()
      return
    }
    setPreviewing(true)
    await playPomodoroAlarm(state.settings.alarmSoundFile)
  }, [previewing, state.settings.alarmSoundFile])
  const phaseLabel = state.alarmVisible
    ? (locale === 'en-US' ? 'Alarm' : '提醒')
    : state.running
      ? (state.mode === 'focus'
        ? (locale === 'en-US' ? 'Focus' : '专注中')
        : state.mode === 'shortBreak'
          ? (locale === 'en-US' ? 'Short break' : '短休息')
          : (locale === 'en-US' ? 'Long break' : '长休息'))
      : (locale === 'en-US' ? 'Paused' : '已暂停')

  useEffect(() => {
    if (!open) return
    queueMicrotask(() => dialogRef.current?.focus())
  }, [open])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void loadPomodoroAlarmSoundFiles().then((files) => {
      if (cancelled) return
      setSoundFiles(files)
    })
    if (!hasInitializedSoundSelectionRef.current && !state.settings.alarmSoundFile) {
      void loadLatestPomodoroAlarmSoundFile().then((fileName) => {
        if (cancelled) return
        hasInitializedSoundSelectionRef.current = true
        if (fileName && !state.settings.alarmSoundFile) {
          controller.updateSettings({ alarmSoundFile: fileName })
        }
      })
    } else if (state.settings.alarmSoundFile) {
      hasInitializedSoundSelectionRef.current = true
    }
    return () => {
      cancelled = true
    }
  }, [controller, open, state.settings.alarmSoundFile])

  useEffect(() => {
    if (open) return
    setPreviewing(false)
    setSoundPickerOpen(false)
    setHoveredSoundFile(null)
    void stopPomodoroAlarm()
  }, [open])

  useEffect(() => {
    return () => {
      setPreviewing(false)
      setSoundPickerOpen(false)
      setHoveredSoundFile(null)
      void stopPomodoroAlarm()
    }
  }, [])

  if (!open) return null

  return (
    <div className="modal-backdrop pomodoro-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal modal-pomodoro"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
        }}
      >
        <div className="pomodoro-header">
          <div>
            <div className="pomodoro-kicker">{locale === 'en-US' ? 'Tool' : '工具'}</div>
            <div className="pomodoro-title">{locale === 'en-US' ? 'Pomodoro Timer' : '番茄闹钟'}</div>
          </div>
          <button className="pomodoro-close" type="button" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="pomodoro-body">
          <section className="pomodoro-stage-card">
            <div className={[
              'pomodoro-ring',
              state.alarmVisible ? 'alarm' : '',
              state.running ? 'running' : '',
            ].filter(Boolean).join(' ')}>
              <div className="pomodoro-ring-inner">
                <div className="pomodoro-time">{formatClock(remainingSeconds)}</div>
                <div className="pomodoro-phase">{phaseLabel}</div>
              </div>
            </div>

            <div className="pomodoro-stage-meta">
              <span className="pomodoro-cycle">
                {locale === 'en-US'
                  ? `${state.cycleCount} round(s)`
                  : `已完成 ${state.cycleCount} 轮`}
              </span>
              <span className="pomodoro-mode">
                {state.mode === 'idle'
                  ? (locale === 'en-US' ? 'Ready' : '待开始')
                  : state.mode === 'focus'
                    ? (locale === 'en-US' ? 'Focus' : '专注')
                    : state.mode === 'shortBreak'
                      ? (locale === 'en-US' ? 'Short break' : '短休')
                      : (locale === 'en-US' ? 'Long break' : '长休')}
              </span>
            </div>

            <div className="pomodoro-stage-actions">
              {!state.running && !state.alarmVisible ? (
                <Button onClick={controller.startFocus}>
                  {locale === 'en-US' ? 'Start' : '开始'}
                </Button>
              ) : null}
              {state.running ? (
                <Button variant="secondary" onClick={controller.pause}>
                  {locale === 'en-US' ? 'Pause' : '暂停'}
                </Button>
              ) : null}
              {!state.running && !state.alarmVisible && state.mode !== 'idle' ? (
                <Button variant="secondary" onClick={controller.resume}>
                  {locale === 'en-US' ? 'Resume' : '继续'}
                </Button>
              ) : null}
              <Button variant="tertiary" onClick={controller.reset}>
                {locale === 'en-US' ? 'Reset' : '重置'}
              </Button>
            </div>
          </section>

          <section className="pomodoro-settings-card">
            <div className="pomodoro-settings-header">
              <div className="pomodoro-settings-title">
                {locale === 'en-US' ? 'Settings' : '设置'}
              </div>
              <div className="pomodoro-settings-description">
                {locale === 'en-US'
                  ? 'Adjust focus and break durations.'
                  : '调整专注、短休和长休时长。'}
              </div>
            </div>

            <FieldGroup label={locale === 'en-US' ? 'Focus minutes' : '专注分钟'}>
              <input
                className="field-input pomodoro-number-input"
                type="number"
                min={1}
                max={180}
                step={1}
                value={state.settings.focusMinutes}
                onChange={(event) => controller.updateSettings({ focusMinutes: Number(event.target.value) })}
              />
            </FieldGroup>

            <FieldGroup label={locale === 'en-US' ? 'Short break' : '短休分钟'}>
              <input
                className="field-input pomodoro-number-input"
                type="number"
                min={1}
                max={60}
                step={1}
                value={state.settings.shortBreakMinutes}
                onChange={(event) => controller.updateSettings({ shortBreakMinutes: Number(event.target.value) })}
              />
            </FieldGroup>

            <FieldGroup label={locale === 'en-US' ? 'Long break' : '长休分钟'}>
              <input
                className="field-input pomodoro-number-input"
                type="number"
                min={1}
                max={120}
                step={1}
                value={state.settings.longBreakMinutes}
                onChange={(event) => controller.updateSettings({ longBreakMinutes: Number(event.target.value) })}
              />
            </FieldGroup>

            <FieldGroup label={locale === 'en-US' ? 'Rounds' : '轮数'}>
              <input
                className="field-input pomodoro-number-input"
                type="number"
                min={2}
                max={12}
                step={1}
                value={state.settings.roundsBeforeLongBreak}
                onChange={(event) => controller.updateSettings({ roundsBeforeLongBreak: Number(event.target.value) })}
              />
            </FieldGroup>

            <div className="pomodoro-sound-section">
              <div className="pomodoro-sound-header">
                <div className="pomodoro-sound-title">
                  {locale === 'en-US' ? 'Sound' : '音效'}
                </div>
                <button type="button" className="pomodoro-sound-label" onClick={handleToggleSoundPicker}>
                  <span className="pomodoro-sound-label-text">{soundFileLabel}</span>
                  <span className="pomodoro-sound-label-caret">▾</span>
                </button>
                {soundPickerOpen ? (
                  <div
                    className="pomodoro-sound-picker"
                    onMouseLeave={() => setHoveredSoundFile(null)}
                  >
                    <button
                      type="button"
                      className={['pomodoro-sound-picker-item', state.settings.alarmSoundFile === null && hoveredSoundFile !== null && hoveredSoundFile !== DEFAULT_SOUND_HOVER_KEY ? '' : state.settings.alarmSoundFile === null ? 'active' : ''].filter(Boolean).join(' ')}
                      onMouseEnter={() => setHoveredSoundFile(DEFAULT_SOUND_HOVER_KEY)}
                      onClick={() => handleSelectSound(null)}
                    >
                      {locale === 'en-US' ? 'Default alarm' : '默认提示音'}
                    </button>
                    {soundFiles.map((fileName) => (
                      <button
                        key={fileName}
                        type="button"
                        className={['pomodoro-sound-picker-item', state.settings.alarmSoundFile === fileName && hoveredSoundFile !== null && hoveredSoundFile !== fileName ? '' : state.settings.alarmSoundFile === fileName ? 'active' : ''].filter(Boolean).join(' ')}
                        onMouseEnter={() => setHoveredSoundFile(fileName)}
                        onClick={() => handleSelectSound(fileName)}
                      >
                        {fileName}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="pomodoro-sound-actions">
                <Button variant="secondary" onClick={handleImportSound}>
                  {locale === 'en-US' ? 'Import sound' : '导入音频'}
                </Button>
                <Button variant="secondary" onClick={handlePreviewSound}>
                  {previewing
                    ? (locale === 'en-US' ? 'Stop' : '停止')
                    : (locale === 'en-US' ? 'Preview' : '试听')}
                </Button>
                <Button variant="tertiary" onClick={handleRestoreDefaultSound}>
                  {locale === 'en-US' ? 'Default' : '恢复默认'}
                </Button>
              </div>
            </div>
          </section>
        </div>

        {state.alarmVisible ? (
          <div className="pomodoro-alarm-overlay">
            <div className="pomodoro-alarm-card">
              <div className="pomodoro-alarm-icon">⏰</div>
              <div className="pomodoro-alarm-title">
                {state.alarmReason === 'focus-ended'
                  ? (locale === 'en-US' ? 'Focus session finished' : '专注结束')
                  : (locale === 'en-US' ? 'Break finished' : '休息结束')}
              </div>
              <div className="pomodoro-alarm-subtitle">
                {state.alarmReason === 'focus-ended'
                  ? (locale === 'en-US' ? 'Take a break now.' : '现在可以进入休息。')
                  : (locale === 'en-US' ? 'Start the next focus round.' : '开始下一轮专注。')}
              </div>
              <div className="pomodoro-alarm-actions">
                {state.alarmReason === 'focus-ended' ? (
                  <Button onClick={controller.dismissAlarmAndStartBreak}>
                    {locale === 'en-US' ? 'Start break' : '开始休息'}
                  </Button>
                ) : (
                  <Button onClick={controller.dismissAlarmAndStartFocus}>
                    {locale === 'en-US' ? 'Start focus' : '继续专注'}
                  </Button>
                )}
                <Button variant="secondary" onClick={onClose}>
                  {locale === 'en-US' ? 'Close' : '关闭'}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
