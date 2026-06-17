import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { Button } from './Button'
import { useI18n } from '../modules/i18n/I18nContext'
import { deleteMusicSound, importMusicSound, loadMusicSoundFiles, moveMusicSound } from '../modules/tools/music/musicSound'
import {
  loadMusicPlaylistStore,
  saveMusicPlaylistStore,
  type MusicPlaylistRecord,
  type MusicPlaylistStore,
} from '../modules/tools/music/musicPlaylists'
import {
  getMusicTrackDuration,
  getMusicTrackState,
  pauseMusicTrack,
  playMusicTrack,
  resumeMusicTrack,
  seekMusicTrack,
  setMusicTrackVolume,
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
  const playlistMenuRef = useRef<HTMLDivElement | null>(null)
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
  const [volumePercent, setVolumePercent] = useState(100)
  const [isVolumeOpen, setIsVolumeOpen] = useState(false)
  const [playlistStore, setPlaylistStore] = useState<MusicPlaylistStore | null>(null)
  const [isPlaylistMenuOpen, setIsPlaylistMenuOpen] = useState(false)
  const [isCreatingPlaylist, setIsCreatingPlaylist] = useState(false)
  const [playlistDraftName, setPlaylistDraftName] = useState('')
  const [trackMenu, setTrackMenu] = useState<{
    fileName: string
    x: number
    y: number
    mode: 'actions' | 'move'
  } | null>(null)
  const hasInitializedSelectionRef = useRef(false)
  const isSeekingRef = useRef(false)
  const lastAutoAdvanceTrackRef = useRef<string | null>(null)
  const volumeControlRef = useRef<HTMLDivElement | null>(null)
  const trackMenuRef = useRef<HTMLDivElement | null>(null)
  const activePlaylist = useMemo(() => {
    if (!playlistStore || playlistStore.playlists.length === 0) return null
    return playlistStore.playlists.find((playlist) => playlist.id === playlistStore.activePlaylistId)
      ?? playlistStore.playlists[0]
  }, [playlistStore])
  const activePlaylistId = useMemo(() => {
    if (!playlistStore) return 'default'
    return resolveActivePlaylistId(playlistStore)
  }, [playlistStore])
  const activePlaylistTracks = useMemo(() => tracks, [tracks])
  const playlistItems = useMemo(() => {
    return playlistStore?.playlists.length
      ? playlistStore.playlists
      : createDefaultPlaylistStore(tracks).playlists
  }, [playlistStore, tracks])
  const currentIndex = useMemo(() => {
    if (!selectedTrack) return -1
    return activePlaylistTracks.indexOf(selectedTrack)
  }, [activePlaylistTracks, selectedTrack])

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
  const currentVolume = Math.max(0, Math.min(100, volumePercent))
  const isMuted = currentVolume <= 0

  const setSeekingState = useCallback((next: boolean) => {
    isSeekingRef.current = next
    setIsSeeking(next)
  }, [])

  const commitPlaylistStore = useCallback(async (nextStore: MusicPlaylistStore) => {
    const normalized = normalizePlaylistStore(nextStore)
    setPlaylistStore(normalized)
    await saveMusicPlaylistStore(normalized)
    return normalized
  }, [])

  const syncLibrary = useCallback(async () => {
    const store = await loadMusicPlaylistStore()
    const nextActivePlaylistId = resolveActivePlaylistId(store ?? createDefaultPlaylistStore([]))
    const nextTracks = await loadMusicSoundFiles(nextActivePlaylistId)
    const nextStore = store
      ? clonePlaylistStore(store)
      : createDefaultPlaylistStore(nextTracks)
    const activePlaylist = nextStore.playlists.find((playlist) => playlist.id === nextActivePlaylistId)
    if (activePlaylist) {
      activePlaylist.trackFiles = [...nextTracks]
      activePlaylist.updatedAt = new Date().toISOString()
    }
    setPlaylistStore(nextStore)
    void saveMusicPlaylistStore(nextStore)
    setTracks(nextTracks)
    if (!hasInitializedSelectionRef.current) {
      setSelectedTrack(nextTracks[0] ?? null)
      hasInitializedSelectionRef.current = true
      return
    }

    if (selectedTrack && nextTracks.length > 0 && !nextTracks.includes(selectedTrack)) {
      setSelectedTrack(nextTracks[0] ?? null)
    } else if (selectedTrack && nextTracks.length === 0) {
      setSelectedTrack(null)
    } else if (!selectedTrack && nextTracks.length > 0) {
      setSelectedTrack(nextTracks[0])
    }
  }, [selectedTrack])

  const handleAddTrackToActivePlaylist = useCallback(async (
    fileName: string,
    baseStore?: MusicPlaylistStore,
  ): Promise<MusicPlaylistStore | null> => {
    const currentStore = baseStore ?? playlistStore ?? createDefaultPlaylistStore(tracks)
    const activePlaylistId = resolveActivePlaylistId(currentStore)
    const nextStore = clonePlaylistStore(currentStore)
    const playlist = nextStore.playlists.find((item) => item.id === activePlaylistId)
    if (!playlist) return null
    if (!playlist.trackFiles.includes(fileName)) {
      playlist.trackFiles = [...playlist.trackFiles, fileName]
      playlist.updatedAt = new Date().toISOString()
    }
    nextStore.activePlaylistId = playlist.id
    await commitPlaylistStore(nextStore)
    return nextStore
  }, [commitPlaylistStore, playlistStore, tracks])

  const handleSelectPlaylist = useCallback(async (playlistId: string) => {
    const currentStore = playlistStore ?? createDefaultPlaylistStore(tracks)
    const nextStore = clonePlaylistStore(currentStore)
    const playlist = nextStore.playlists.find((item) => item.id === playlistId)
    if (!playlist) return
    nextStore.activePlaylistId = playlist.id
    await commitPlaylistStore(nextStore)

    const nextTracks = await loadMusicSoundFiles(playlist.id)
    setTracks(nextTracks)
    playlist.trackFiles = [...nextTracks]
    playlist.updatedAt = new Date().toISOString()
    await saveMusicPlaylistStore(nextStore)
    setSelectedTrack(selectedTrack && nextTracks.includes(selectedTrack) ? selectedTrack : (nextTracks[0] ?? null))
    setIsPlaylistMenuOpen(false)
  }, [commitPlaylistStore, playlistStore, selectedTrack, tracks])

  const handleCreatePlaylist = useCallback(async () => {
    const name = playlistDraftName.trim()
    if (!name) return
    const currentStore = playlistStore ?? createDefaultPlaylistStore(tracks)
    const nextStore = clonePlaylistStore(currentStore)
    const now = new Date().toISOString()
    const playlist: MusicPlaylistRecord = {
      id: createPlaylistId(),
      name,
      trackFiles: [],
      createdAt: now,
      updatedAt: now,
    }
    nextStore.playlists = [...nextStore.playlists, playlist]
    nextStore.activePlaylistId = playlist.id
    await commitPlaylistStore(nextStore)
    setSelectedTrack(null)
    setTracks([])
    setIsPlaylistMenuOpen(false)
    setIsCreatingPlaylist(false)
    setPlaylistDraftName('')
  }, [commitPlaylistStore, playlistDraftName, playlistStore, tracks])

  const closeTrackMenu = useCallback(() => {
    setTrackMenu(null)
  }, [])

  const handleOpenTrackMenu = useCallback((event: MouseEvent<HTMLButtonElement>, fileName: string) => {
    event.preventDefault()
    event.stopPropagation()
    setIsPlaylistMenuOpen(false)
    setIsCreatingPlaylist(false)
    setTrackMenu({
      fileName,
      x: clampMenuCoordinate(event.clientX, 244, window.innerWidth),
      y: clampMenuCoordinate(event.clientY, 280, window.innerHeight),
      mode: 'actions',
    })
  }, [])

  const handleOpenMoveTrackMenu = useCallback(() => {
    setTrackMenu((current) => (current ? { ...current, mode: 'move' } : current))
  }, [])

  const handleMoveTrackToPlaylist = useCallback(async (targetPlaylistId: string) => {
    if (!trackMenu) return
    const sourceFile = trackMenu.fileName
    const currentStore = playlistStore ?? createDefaultPlaylistStore(tracks)
    const nextStore = clonePlaylistStore(currentStore)
    const sourcePlaylistId = resolveActivePlaylistId(currentStore)
    const sourcePlaylist = nextStore.playlists.find((item) => item.id === sourcePlaylistId)
    const targetPlaylist = nextStore.playlists.find((item) => item.id === targetPlaylistId)
    if (!sourcePlaylist || !targetPlaylist || sourcePlaylist.id === targetPlaylist.id) return
    const moved = await moveMusicSound(sourcePlaylist.id, targetPlaylist.id, sourceFile)
    if (!moved) return
    const sourceTracks = await loadMusicSoundFiles(sourcePlaylist.id)
    setTracks(sourceTracks)
    const now = new Date().toISOString()
    sourcePlaylist.trackFiles = sourceTracks
    targetPlaylist.trackFiles = await loadMusicSoundFiles(targetPlaylist.id)
    sourcePlaylist.updatedAt = now
    targetPlaylist.updatedAt = now
    await commitPlaylistStore(nextStore)
    if (selectedTrack === sourceFile) {
      setSelectedTrack(sourceTracks[0] ?? null)
    }
    closeTrackMenu()
  }, [closeTrackMenu, commitPlaylistStore, playlistStore, selectedTrack, trackMenu, tracks])

  const handleOpenCreatePlaylist = useCallback(() => {
    setPlaylistDraftName('')
    setIsCreatingPlaylist(true)
  }, [])

  const handleCancelCreatePlaylist = useCallback(() => {
    setPlaylistDraftName('')
    setIsCreatingPlaylist(false)
  }, [])

  const handleImportTrack = useCallback(async () => {
    const chosen = await openDialog({
      multiple: true,
      directory: false,
      title: locale === 'en-US' ? 'Choose music files' : '选择音乐文件',
      filters: [
        {
          name: locale === 'en-US' ? 'Audio files' : '音频文件',
          extensions: ['wav', 'mp3', 'ogg', 'm4a', 'flac'],
        },
      ],
    })
    const sourcePaths = (Array.isArray(chosen) ? chosen : [chosen]).filter(
      (item): item is string => typeof item === 'string' && item.trim().length > 0,
    )
    if (sourcePaths.length === 0) return

    const importedFileNames: string[] = []
    let nextStore = playlistStore ?? createDefaultPlaylistStore(tracks)
    for (const sourcePath of sourcePaths) {
      const fileName = await importMusicSound(activePlaylistId, sourcePath)
      if (!fileName) continue
      importedFileNames.push(fileName)
      const updatedStore = await handleAddTrackToActivePlaylist(fileName, nextStore)
      if (updatedStore) {
        nextStore = updatedStore
      }
    }
    if (importedFileNames.length === 0) return
    hasInitializedSelectionRef.current = true
    setSelectedTrack(importedFileNames[0])
    await syncLibrary()
  }, [activePlaylistId, handleAddTrackToActivePlaylist, locale, syncLibrary])

  const handleSelectTrack = useCallback((fileName: string) => {
    setSelectedTrack(fileName)
    lastAutoAdvanceTrackRef.current = null
  }, [])

  const handlePlay = useCallback(async () => {
    const track = selectedTrack ?? activePlaylistTracks[0]
    if (!track) return
    if (playing && !paused) return
    if (paused) {
      await resumeMusicTrack()
      setPaused(false)
      setPlaying(true)
      return
    }
    await playMusicTrack(activePlaylistId, track)
    setPlaybackTrackName(track)
    setTrackPositionMs(0)
    setPlaying(true)
    setPaused(false)
    lastAutoAdvanceTrackRef.current = null
  }, [activePlaylistTracks, paused, playing, selectedTrack])

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

  const handleDeleteTrack = useCallback(async () => {
    if (!trackMenu) return
    const fileName = trackMenu.fileName
    if (currentTrackName === fileName || selectedTrack === fileName) {
      await handleStop()
    }
    const deleted = await deleteMusicSound(activePlaylistId, fileName)
    if (!deleted) return
    await syncLibrary()
    closeTrackMenu()
  }, [activePlaylistId, closeTrackMenu, currentTrackName, handleStop, selectedTrack, syncLibrary, trackMenu])

  const handleToggleVolumePanel = useCallback(() => {
    setIsVolumeOpen((current) => !current)
  }, [])

  const handleChangeVolume = useCallback(async (nextPercent: number) => {
    const next = Math.max(0, Math.min(100, Math.round(nextPercent)))
    setVolumePercent(next)
    await setMusicTrackVolume(next / 100)
  }, [])

  const playTrackAtIndex = useCallback(async (nextTrack: string, shouldPlay: boolean) => {
    setSelectedTrack(nextTrack)
    if (!shouldPlay) return
    await playMusicTrack(activePlaylistId, nextTrack)
    setPlaybackTrackName(nextTrack)
    setTrackPositionMs(0)
    setPlaying(true)
    setPaused(false)
  }, [])

  const handleStepTrack = useCallback(async (direction: -1 | 1, shouldPlay = false) => {
    if (activePlaylistTracks.length === 0) return
    const nextIndex = currentIndex >= 0
      ? (currentIndex + direction + activePlaylistTracks.length) % activePlaylistTracks.length
      : (direction > 0 ? 0 : activePlaylistTracks.length - 1)
    const nextTrack = activePlaylistTracks[nextIndex]
    const shouldStart = shouldPlay || playing || paused
    await playTrackAtIndex(nextTrack, shouldStart)
  }, [activePlaylistTracks, currentIndex, paused, playTrackAtIndex, playing])

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
    void syncLibrary()
    return () => {
      setHoveredTrack(null)
    }
  }, [open, syncLibrary])

  useEffect(() => {
    if (open) return
    setHoveredTrack(null)
    setIsVolumeOpen(false)
    setIsPlaylistMenuOpen(false)
    setIsCreatingPlaylist(false)
    setPlaylistDraftName('')
    setTrackMenu(null)
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
      const duration = await getMusicTrackDuration(activePlaylistId, selectedTrack)
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
  }, [activePlaylistId, open, paused, playing, selectedTrack])

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
      setVolumePercent(Math.round((state.volume ?? 1) * 100))
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

  useEffect(() => {
    if (!open || !isVolumeOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (volumeControlRef.current?.contains(target)) return
      setIsVolumeOpen(false)
    }
    window.addEventListener('pointerdown', handlePointerDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [isVolumeOpen, open])

  useEffect(() => {
    if (!open || !isVolumeOpen) return
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      const delta = event.deltaY > 0 ? -5 : 5
      void handleChangeVolume(currentVolume + delta)
    }
    window.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      window.removeEventListener('wheel', handleWheel)
    }
  }, [currentVolume, handleChangeVolume, isVolumeOpen, open])

  useEffect(() => {
    if (!open || !isPlaylistMenuOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (playlistMenuRef.current?.contains(target)) return
      setIsPlaylistMenuOpen(false)
    }
    window.addEventListener('pointerdown', handlePointerDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [isPlaylistMenuOpen, open])

  useEffect(() => {
    if (!open || !trackMenu) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (trackMenuRef.current?.contains(target)) return
      closeTrackMenu()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeTrackMenu()
      }
    }
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeTrackMenu, open, trackMenu])

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
              <span className="music-player-now-title">
                {locale === 'en-US' ? 'Now Playing' : '当前曲目'}
              </span>
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
                variant="tertiary"
                className="music-player-control-btn"
                icon={<StopTrackIcon />}
                onClick={() => { void handleStop() }}
                disabled={!playing && !paused}
                aria-label={locale === 'en-US' ? 'Stop' : '停止'}
                title={locale === 'en-US' ? 'Stop' : '停止'}
              />
              <Button
                variant="secondary"
                className="music-player-control-btn"
                icon={<PrevTrackIcon />}
                onClick={() => { void handleStepTrack(-1) }}
                disabled={activePlaylistTracks.length === 0}
                aria-label={locale === 'en-US' ? 'Previous track' : '上一首'}
                title={locale === 'en-US' ? 'Previous track' : '上一首'}
              />
              {playing && !paused ? (
                <Button
                  variant="secondary"
                  className="music-player-control-btn"
                  icon={<PauseTrackIcon />}
                  onClick={() => { void handlePause() }}
                  disabled={activePlaylistTracks.length === 0}
                  aria-label={locale === 'en-US' ? 'Pause' : '暂停'}
                  title={locale === 'en-US' ? 'Pause' : '暂停'}
                />
              ) : (
                <Button
                  className="music-player-control-btn"
                  icon={<PlayTrackIcon />}
                  onClick={() => { void handlePlay() }}
                  disabled={activePlaylistTracks.length === 0}
                  aria-label={paused ? (locale === 'en-US' ? 'Resume' : '继续') : (locale === 'en-US' ? 'Play' : '播放')}
                  title={paused ? (locale === 'en-US' ? 'Resume' : '继续') : (locale === 'en-US' ? 'Play' : '播放')}
                />
              )}
              <Button
                variant="secondary"
                className="music-player-control-btn"
                icon={<NextTrackIcon />}
                onClick={() => { void handleStepTrack(1) }}
                disabled={activePlaylistTracks.length === 0}
                aria-label={locale === 'en-US' ? 'Next track' : '下一首'}
                title={locale === 'en-US' ? 'Next track' : '下一首'}
              />
              <div className="music-player-volume-control" ref={volumeControlRef}>
                <button
                  type="button"
                  className="music-player-volume-toggle"
                  onClick={handleToggleVolumePanel}
                  aria-label={locale === 'en-US' ? 'Volume' : '音量'}
                  title={locale === 'en-US' ? 'Volume' : '音量'}
                >
                  {isMuted ? <MuteVolumeIcon /> : <VolumeIcon />}
                </button>
                {isVolumeOpen ? (
                  <div className="music-player-volume-popover" role="dialog" aria-label={locale === 'en-US' ? 'Volume control' : '音量控制'}>
                    <input
                      className="music-player-volume-input"
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={currentVolume}
                      onChange={(event) => {
                        void handleChangeVolume(Number(event.currentTarget.value))
                      }}
                      aria-label={locale === 'en-US' ? 'Volume' : '音量'}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <section className="music-player-library-card">
            <div className="music-player-library-header">
              <div className="music-player-library-title-row">
                <div className="music-player-library-actions" ref={playlistMenuRef}>
                  <button
                    className="music-player-library-switcher"
                    type="button"
                    onClick={() => setIsPlaylistMenuOpen((current) => !current)}
                    aria-haspopup="menu"
                    aria-expanded={isPlaylistMenuOpen}
                  >
                    <span className="music-player-library-switcher-name">
                      {activePlaylist?.name ?? (locale === 'en-US' ? 'Default Category' : '默认分类')}
                    </span>
                    <span className="music-player-library-switcher-caret" aria-hidden="true">▾</span>
                  </button>
                  <button
                    className="music-player-library-add"
                    type="button"
                    onClick={() => { void handleImportTrack() }}
                    aria-label={locale === 'en-US' ? 'Import track' : '导入音频'}
                  >
                    +
                  </button>
                  {isPlaylistMenuOpen ? (
                    <div className="music-player-playlist-popover" role="menu" aria-label={locale === 'en-US' ? 'Categories' : '分类'}>
                      <div className="music-player-playlist-list">
                        {playlistItems.map((playlist) => {
                          const isActive = playlist.id === activePlaylistId
                          const count = playlist.trackFiles.length
                          return (
                            <button
                              key={playlist.id}
                              type="button"
                              className={['music-player-playlist-item', isActive ? 'active' : ''].filter(Boolean).join(' ')}
                              onClick={() => { void handleSelectPlaylist(playlist.id) }}
                            >
                              <span className="music-player-playlist-item-name">{playlist.name}</span>
                              <span className="music-player-playlist-item-count">{count}</span>
                            </button>
                          )
                        })}
                      </div>
                      <button
                        type="button"
                        className="music-player-playlist-new"
                        onClick={handleOpenCreatePlaylist}
                      >
                        + {locale === 'en-US' ? 'New playlist' : '新建列表'}
                      </button>
                      {isCreatingPlaylist ? (
                        <div className="music-player-playlist-new-form">
                          <input
                            className="music-player-playlist-new-input"
                            value={playlistDraftName}
                            onChange={(event) => setPlaylistDraftName(event.currentTarget.value)}
                            placeholder={locale === 'en-US' ? 'Playlist name' : '列表名称'}
                            autoFocus
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                void handleCreatePlaylist()
                              } else if (event.key === 'Escape') {
                                event.preventDefault()
                                handleCancelCreatePlaylist()
                              }
                            }}
                          />
                          <div className="music-player-playlist-new-actions">
                            <button
                              type="button"
                              className="music-player-playlist-new-confirm"
                              onClick={() => { void handleCreatePlaylist() }}
                            >
                              {locale === 'en-US' ? 'Create' : '创建'}
                            </button>
                            <button
                              type="button"
                              className="music-player-playlist-new-cancel"
                              onClick={handleCancelCreatePlaylist}
                            >
                              {locale === 'en-US' ? 'Cancel' : '取消'}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="music-player-library-list">
              {activePlaylistTracks.length === 0 ? (
                <div className="music-player-empty">
                  {locale === 'en-US'
                    ? 'No audio files yet. Import one to start.'
                    : '还没有音频文件，先导入一个开始播放。'}
                </div>
              ) : activePlaylistTracks.map((fileName) => {
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
                    onContextMenu={(event) => handleOpenTrackMenu(event, fileName)}
                    onDoubleClick={() => {
                      void playMusicTrack(activePlaylistId, fileName)
                      setSelectedTrack(fileName)
                      setPlaybackTrackName(fileName)
                      setTrackPositionMs(0)
                      setPlaying(true)
                      setPaused(false)
                      lastAutoAdvanceTrackRef.current = null
                    }}
                  >
                    <span className="music-player-track-name">{stripAudioExtension(fileName)}</span>
                  </button>
                )
              })}
            </div>
            {trackMenu && typeof document !== 'undefined' ? createPortal(
              <div
                ref={trackMenuRef}
                className="music-player-track-menu"
                style={{ left: `${trackMenu.x}px`, top: `${trackMenu.y}px` }}
                role="menu"
                aria-label={locale === 'en-US' ? 'Track actions' : '歌曲操作'}
              >
                {trackMenu.mode === 'actions' ? (
                  <>
                    <button type="button" className="music-player-track-menu-item" onClick={handleOpenMoveTrackMenu}>
                      {locale === 'en-US' ? 'Move to another list' : '移动到其他列表'}
                    </button>
                    <button type="button" className="music-player-track-menu-item danger" onClick={() => { void handleDeleteTrack() }}>
                      {locale === 'en-US' ? 'Delete track' : '删除歌曲'}
                    </button>
                  </>
                ) : (
                  <>
                    <div className="music-player-track-menu-targets">
                      {playlistItems
                        .filter((playlist) => playlist.id !== activePlaylistId)
                        .map((playlist) => (
                          <button
                            key={playlist.id}
                            type="button"
                            className="music-player-track-menu-item"
                            onClick={() => { void handleMoveTrackToPlaylist(playlist.id) }}
                          >
                            <span>{playlist.name}</span>
                            <span className="music-player-track-menu-count">{playlist.trackFiles.length}</span>
                          </button>
                        ))}
                    </div>
                    {playlistItems.filter((playlist) => playlist.id !== activePlaylistId).length === 0 ? (
                      <div className="music-player-track-menu-empty">
                        {locale === 'en-US' ? 'No other list' : '没有其他列表'}
                      </div>
                    ) : null}
                  </>
                )}
              </div>, document.body
            ) : null}
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

function createPlaylistId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `playlist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createDefaultPlaylistStore(trackFiles: string[]): MusicPlaylistStore {
  const now = new Date().toISOString()
  return {
    activePlaylistId: 'default',
    playlists: [{
      id: 'default',
      name: '默认列表',
      trackFiles: [...trackFiles],
      createdAt: now,
      updatedAt: now,
    }],
  }
}

function clonePlaylistStore(store: MusicPlaylistStore): MusicPlaylistStore {
  return {
    activePlaylistId: store.activePlaylistId,
    playlists: store.playlists.map((playlist) => ({
      ...playlist,
      trackFiles: [...playlist.trackFiles],
    })),
  }
}

function resolveActivePlaylistId(store: MusicPlaylistStore): string {
  if (store.playlists.some((playlist) => playlist.id === store.activePlaylistId)) {
    return store.activePlaylistId
  }
  return store.playlists[0]?.id ?? 'default'
}

function clampMenuCoordinate(value: number, menuSize: number, viewportSize: number): number {
  const max = Math.max(8, viewportSize - menuSize - 8)
  return Math.max(8, Math.min(value, max))
}

function normalizePlaylistStore(store: MusicPlaylistStore | null): MusicPlaylistStore {
  if (!store || store.playlists.length === 0) {
    return createDefaultPlaylistStore([])
  }
  const nextStore = clonePlaylistStore(store)
  if (!nextStore.playlists.some((playlist) => playlist.id === nextStore.activePlaylistId)) {
    nextStore.activePlaylistId = nextStore.playlists[0]?.id ?? 'default'
  }
  return nextStore
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

function VolumeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9h4l5-4v14l-5-4H4z" />
      <path d="M16.5 8.5a4 4 0 0 1 0 7" />
      <path d="M18.8 6.2a7 7 0 0 1 0 11.6" />
    </svg>
  )
}

function MuteVolumeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9h4l5-4v14l-5-4H4z" />
      <path d="M16 9l5 6" />
      <path d="M21 9l-5 6" />
    </svg>
  )
}
