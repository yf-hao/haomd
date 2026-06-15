import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { Button } from './Button'
import { useI18n } from '../modules/i18n/I18nContext'
import { importMusicSound, loadLatestMusicSoundFile, loadMusicSoundFiles } from '../modules/tools/music/musicSound'
import {
  getMusicTrackDuration,
  getMusicTrackState,
  pauseMusicTrack,
  playMusicTrack,
  resumeMusicTrack,
  seekMusicTrack,
  stopMusicTrack,
  type MusicTrackState,
} from '../modules/tools/music/musicAudio'
import './MusicPlayerDialog.css'

export type MusicPlayerDialogProps = {
  open: boolean
  onClose: () => void
}

export function MusicPlayerDialog({ open, onClose }: MusicPlayerDialogProps) {
  const { resolvedLanguage: locale } = useI18n()
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const [tracks, setTracks] = useState<string[]>([])
  const [selectedTrack, setSelectedTrack] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [paused, setPaused] = useState(false)
  const [hoveredTrack, setHoveredTrack] = useState<string | null>(null)
  const [trackDurationMs, setTrackDurationMs] = useState<number | null>(null)
  const [trackPositionMs, setTrackPositionMs] = useState(0)
  const [playbackTrackName, setPlaybackTrackName] = useState<string | null>(null)
  const [isSeeking, setIsSeeking] = useState(false)
  const [draftSeekMs, setDraftSeekMs] = useState<number | null>(null)
  const hasInitializedSelectionRef = useRef(false)
  const isSeekingRef = useRef(false)
  const lastAutoAdvanceTrackRef = useRef<string | null>(null)
  const currentIndex = useMemo(() => {
    if (!selectedTrack) return -1
    return tracks.indexOf(selectedTrack)
  }, [selectedTrack, tracks])

  const currentTrackName = playbackTrackName ?? selectedTrack
  const selectedLabel = currentTrackName
    ? stripAudioExtension(currentTrackName)
    : (locale === 'en-US' ? 'No track selected' : '未选择曲目')
  const statusLabel = playing
    ? (paused ? (locale === 'en-US' ? 'Paused' : '已暂停') : (locale === 'en-US' ? 'Playing' : '播放中'))
    : (locale === 'en-US' ? 'Stopped' : '已停止')
  const effectiveDurationMs = trackDurationMs ?? 0
  const displayedPositionMs = isSeeking && draftSeekMs != null ? draftSeekMs : trackPositionMs
  const progressValue = effectiveDurationMs > 0
    ? Math.min(displayedPositionMs, effectiveDurationMs)
    : displayedPositionMs
  const progressPercent = effectiveDurationMs > 0
    ? Math.min(100, Math.max(0, (progressValue / effectiveDurationMs) * 100))
    : 0

  const setSeekingState = useCallback((next: boolean) => {
    isSeekingRef.current = next
    setIsSeeking(next)
  }, [])

  const syncTracks = useCallback(async () => {
    const list = await loadMusicSoundFiles()
    setTracks(list)
    if (!hasInitializedSelectionRef.current && list.length > 0) {
      const latest = await loadLatestMusicSoundFile()
      const nextSelection = latest ?? list[0] ?? null
      if (nextSelection) {
        setSelectedTrack(nextSelection)
        hasInitializedSelectionRef.current = true
      }
    } else if (selectedTrack && list.length > 0 && !list.includes(selectedTrack)) {
      setSelectedTrack(list[0] ?? null)
    }
  }, [selectedTrack])

  const handleImportTrack = useCallback(async () => {
    const chosen = await openDialog({
      multiple: false,
      directory: false,
      title: locale === 'en-US' ? 'Choose music file' : '选择音乐文件',
      filters: [
        {
          name: locale === 'en-US' ? 'Audio files' : '音频文件',
          extensions: ['wav', 'mp3', 'ogg', 'm4a', 'flac'],
        },
      ],
    })
    const sourcePath = Array.isArray(chosen) ? chosen[0] : chosen
    if (!sourcePath || typeof sourcePath !== 'string') return
    const fileName = await importMusicSound(sourcePath)
    if (!fileName) return
    hasInitializedSelectionRef.current = true
    setSelectedTrack(fileName)
    await syncTracks()
  }, [locale, syncTracks])

  const handleSelectTrack = useCallback((fileName: string) => {
    setSelectedTrack(fileName)
    lastAutoAdvanceTrackRef.current = null
  }, [])

  const handlePlay = useCallback(async () => {
    const track = selectedTrack ?? tracks[0]
    if (!track) return
    if (playing && !paused) return
    if (paused) {
      await resumeMusicTrack()
      setPaused(false)
      setPlaying(true)
      return
    }
    await playMusicTrack(track)
    setPlaybackTrackName(track)
    setTrackPositionMs(0)
    setPlaying(true)
    setPaused(false)
    lastAutoAdvanceTrackRef.current = null
  }, [paused, playing, selectedTrack, tracks])

  const handlePause = useCallback(async () => {
    if (!playing || paused) return
    await pauseMusicTrack()
    setPaused(true)
  }, [paused, playing])

  const handleStop = useCallback(async () => {
    await stopMusicTrack()
    setPlaying(false)
    setPaused(false)
    setPlaybackTrackName(null)
    setTrackPositionMs(0)
    setTrackDurationMs(null)
    setSeekingState(false)
    setDraftSeekMs(null)
    lastAutoAdvanceTrackRef.current = null
  }, [setSeekingState])

  const playTrackAtIndex = useCallback(async (nextTrack: string, shouldPlay: boolean) => {
    setSelectedTrack(nextTrack)
    if (!shouldPlay) return
    await playMusicTrack(nextTrack)
    setPlaybackTrackName(nextTrack)
    setTrackPositionMs(0)
    setPlaying(true)
    setPaused(false)
  }, [])

  const handleStepTrack = useCallback(async (direction: -1 | 1, shouldPlay = false) => {
    if (tracks.length === 0) return
    const nextIndex = currentIndex >= 0
      ? (currentIndex + direction + tracks.length) % tracks.length
      : (direction > 0 ? 0 : tracks.length - 1)
    const nextTrack = tracks[nextIndex]
    const shouldStart = shouldPlay || playing || paused
    await playTrackAtIndex(nextTrack, shouldStart)
  }, [currentIndex, paused, playTrackAtIndex, playing, tracks])

  const commitSeek = useCallback(async (positionMs: number) => {
    const nextPosition = Math.max(0, Math.floor(positionMs))
    await seekMusicTrack(nextPosition)
    setTrackPositionMs(nextPosition)
    setDraftSeekMs(nextPosition)
    setSeekingState(false)
  }, [setSeekingState])

  useEffect(() => {
    if (!open) return
    queueMicrotask(() => dialogRef.current?.focus())
  }, [open])

  useEffect(() => {
    if (!open) return
    void syncTracks()
    return () => {
      setHoveredTrack(null)
    }
  }, [open, syncTracks])

  useEffect(() => {
    if (open) return
    setHoveredTrack(null)
  }, [open])

  useEffect(() => {
    return () => {
      setHoveredTrack(null)
    }
  }, [])

  useEffect(() => {
    if (!open || !selectedTrack) {
      setTrackDurationMs(null)
      return
    }
    let cancelled = false
    void (async () => {
      const duration = await getMusicTrackDuration(selectedTrack)
      if (cancelled) return
      setTrackDurationMs(duration)
      if (!playing && !paused) {
        setTrackPositionMs(0)
        setDraftSeekMs(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, paused, playing, selectedTrack])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const syncPlayback = async () => {
      const state: MusicTrackState | null = await getMusicTrackState()
      if (cancelled || !state) return
      setPlaybackTrackName(state.fileName)
      setPlaying(state.playing)
      setPaused(state.paused)
      setTrackPositionMs(state.positionMs)
      setDraftSeekMs((current) => (isSeekingRef.current ? current : state.positionMs))
      if (state.durationMs != null) {
        setTrackDurationMs(state.durationMs)
      }
      if (state.fileName && !selectedTrack) {
        setSelectedTrack(state.fileName)
      }
      const finishedTrack = state.fileName && !state.playing && !state.paused && state.durationMs != null && state.positionMs >= state.durationMs
      if (finishedTrack && state.fileName !== lastAutoAdvanceTrackRef.current) {
        lastAutoAdvanceTrackRef.current = state.fileName
        void handleStepTrack(1, true)
      }
      if (!finishedTrack && state.fileName) {
        lastAutoAdvanceTrackRef.current = null
      }
    }
    void syncPlayback()
    const timer = window.setInterval(() => {
      void syncPlayback()
    }, 500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [handleStepTrack, open, selectedTrack])

  if (!open) return null

  return (
    <div className="modal-backdrop music-player-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal modal-music-player"
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
        <div className="music-player-header">
          <div>
            <div className="music-player-title">{locale === 'en-US' ? 'Music Player' : '音乐播放器'}</div>
          </div>
          <button className="music-player-close" type="button" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="music-player-body">
          <section className="music-player-now-card">
            <div className="music-player-now-head">
              <div className="music-player-now-title">
                {locale === 'en-US' ? 'Now Playing' : '当前曲目'}
              </div>
              <div className="music-player-now-status">{statusLabel}</div>
            </div>

            <div className="music-player-now-track">{selectedLabel}</div>

            <div className="music-player-progress-block">
              <div className="music-player-progress-row">
                <span className="music-player-progress-time">{formatTime(displayedPositionMs)}</span>
                <span className="music-player-progress-time">{formatTime(effectiveDurationMs)}</span>
              </div>
              <div className="music-player-progress-track">
                <div
                  className="music-player-progress-fill"
                  style={{ width: `${progressPercent}%` }}
                />
                <div
                  className={['music-player-progress-marker', isSeeking ? 'seeking' : ''].filter(Boolean).join(' ')}
                  style={{ left: `${progressPercent}%` }}
                  aria-hidden="true"
                >
                  {isSeeking ? (
                    <span className="music-player-progress-tip">{formatTime(displayedPositionMs)}</span>
                  ) : null}
                </div>
                <input
                  className="music-player-progress-input"
                  type="range"
                  min={0}
                  max={Math.max(0, effectiveDurationMs)}
                  step={1000}
                  value={effectiveDurationMs > 0 ? Math.min(displayedPositionMs, effectiveDurationMs) : 0}
                  disabled={!currentTrackName || effectiveDurationMs <= 0}
                  onPointerDown={() => {
                    if (!currentTrackName || effectiveDurationMs <= 0) return
                    setSeekingState(true)
                  }}
                  onPointerUp={() => {
                    if (!isSeekingRef.current || draftSeekMs == null) return
                    void commitSeek(draftSeekMs)
                  }}
                  onPointerCancel={() => {
                    if (!isSeekingRef.current) return
                    setSeekingState(false)
                    setDraftSeekMs(trackPositionMs)
                  }}
                  onMouseUp={() => {
                    if (!isSeekingRef.current || draftSeekMs == null) return
                    void commitSeek(draftSeekMs)
                  }}
                  onTouchEnd={() => {
                    if (!isSeekingRef.current || draftSeekMs == null) return
                    void commitSeek(draftSeekMs)
                  }}
                  onKeyUp={(event) => {
                    if (!isSeekingRef.current || draftSeekMs == null) return
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    void commitSeek(draftSeekMs)
                  }}
                  onChange={(event) => {
                    const nextValue = Number(event.currentTarget.value)
                    setDraftSeekMs(nextValue)
                    if (!isSeekingRef.current) {
                      setSeekingState(true)
                    }
                  }}
                />
              </div>
            </div>

            <div className="music-player-controls">
              <Button
                variant="secondary"
                className="music-player-control-btn"
                icon={<PrevTrackIcon />}
                onClick={() => { void handleStepTrack(-1) }}
                disabled={tracks.length === 0}
                aria-label={locale === 'en-US' ? 'Previous track' : '上一首'}
                title={locale === 'en-US' ? 'Previous track' : '上一首'}
              />
              {playing && !paused ? (
                <Button
                  variant="secondary"
                  className="music-player-control-btn"
                  icon={<PauseTrackIcon />}
                  onClick={() => { void handlePause() }}
                  disabled={tracks.length === 0}
                  aria-label={locale === 'en-US' ? 'Pause' : '暂停'}
                  title={locale === 'en-US' ? 'Pause' : '暂停'}
                />
              ) : (
                <Button
                  className="music-player-control-btn"
                  icon={<PlayTrackIcon />}
                  onClick={() => { void handlePlay() }}
                  disabled={tracks.length === 0}
                  aria-label={paused ? (locale === 'en-US' ? 'Resume' : '继续') : (locale === 'en-US' ? 'Play' : '播放')}
                  title={paused ? (locale === 'en-US' ? 'Resume' : '继续') : (locale === 'en-US' ? 'Play' : '播放')}
                />
              )}
              <Button
                variant="secondary"
                className="music-player-control-btn"
                icon={<NextTrackIcon />}
                onClick={() => { void handleStepTrack(1) }}
                disabled={tracks.length === 0}
                aria-label={locale === 'en-US' ? 'Next track' : '下一首'}
                title={locale === 'en-US' ? 'Next track' : '下一首'}
              />
              <Button
                variant="tertiary"
                className="music-player-control-btn"
                icon={<StopTrackIcon />}
                onClick={() => { void handleStop() }}
                disabled={!playing && !paused}
                aria-label={locale === 'en-US' ? 'Stop' : '停止'}
                title={locale === 'en-US' ? 'Stop' : '停止'}
              />
            </div>
          </section>

          <section className="music-player-library-card">
            <div className="music-player-library-header">
              <div className="music-player-library-title-row">
                <div className="music-player-library-title">
                  {locale === 'en-US' ? 'Library' : '播放列表'}
                </div>
                <button
                  className="music-player-library-add"
                  type="button"
                  onClick={() => { void handleImportTrack() }}
                  aria-label={locale === 'en-US' ? 'Import track' : '导入音频'}
                >
                  +
                </button>
              </div>
            </div>

            <div className="music-player-library-list">
              {tracks.length === 0 ? (
                <div className="music-player-empty">
                  {locale === 'en-US'
                    ? 'No audio files yet. Import one to start.'
                    : '还没有音频文件，先导入一个开始播放。'}
                </div>
              ) : tracks.map((fileName) => {
                const isActive = selectedTrack === fileName
                const isHovered = hoveredTrack === fileName
                return (
                  <button
                    key={fileName}
                    type="button"
                    className={['music-player-track-item', isActive ? 'active' : '', isHovered ? 'hovered' : ''].filter(Boolean).join(' ')}
                    onMouseEnter={() => setHoveredTrack(fileName)}
                    onMouseLeave={() => setHoveredTrack((current) => (current === fileName ? null : current))}
                    onClick={() => handleSelectTrack(fileName)}
                    onDoubleClick={() => { void playMusicTrack(fileName); setSelectedTrack(fileName); setPlaying(true); setPaused(false) }}
                  >
                    <span className="music-player-track-name">{stripAudioExtension(fileName)}</span>
                  </button>
                )
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function formatTime(totalMs: number): string {
  if (!Number.isFinite(totalMs) || totalMs <= 0) {
    return '00:00'
  }
  const totalSeconds = Math.floor(totalMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function stripAudioExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '')
}

function PrevTrackIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 5h2v14H6zM18 6 8.5 12 18 18z" />
    </svg>
  )
}

function NextTrackIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M16 5h2v14h-2zM6 6l9.5 6L6 18z" />
    </svg>
  )
}

function PlayTrackIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}

function PauseTrackIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 5h3v14H7zm7 0h3v14h-3z" />
    </svg>
  )
}

function StopTrackIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6h12v12H6z" />
    </svg>
  )
}
