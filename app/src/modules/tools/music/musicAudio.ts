import { invoke } from '@tauri-apps/api/core'
import type { BackendResult } from '../../platform/backendTypes'
import { isTauriEnv } from '../../platform/runtime'

export type MusicTrackState = {
  playlistId: string | null
  fileName: string | null
  playing: boolean
  paused: boolean
  pausedByAlarm: boolean
  positionMs: number
  durationMs: number | null
  volume: number
}

export async function restoreMusicTrackState(state: MusicTrackState): Promise<void> {
  if (!isTauriEnv()) return
  if (!state.playlistId || !state.fileName) return
  try {
    const resp = await invoke<BackendResult<null>>('restore_music_track', {
      playlistId: state.playlistId,
      musicSoundFile: state.fileName,
      positionMs: Math.max(0, Math.floor(state.positionMs)),
      volume: state.volume,
      shouldPlay: state.playing && !state.paused && !state.pausedByAlarm,
      pausedByAlarm: state.pausedByAlarm,
    })
    if ('Err' in resp) {
      console.error('[music] restore_music_track backend error', resp.Err.error)
    }
  } catch (error) {
    console.error('[music] restore_music_track failed', error)
  }
}

export async function saveMusicSession(state: MusicTrackState): Promise<void> {
  if (!isTauriEnv()) return
  try {
    const resp = await invoke<BackendResult<null>>('save_music_session', { state })
    if ('Err' in resp) {
      console.error('[music] save_music_session backend error', resp.Err.error)
    }
  } catch (error) {
    console.error('[music] save_music_session failed', error)
  }
}

export async function playMusicTrack(playlistId: string, musicSoundFile: string): Promise<void> {
  if (!isTauriEnv()) return
  try {
    const resp = await invoke<BackendResult<null>>('play_music_track', {
      playlistId,
      musicSoundFile,
    })
    if ('Err' in resp) {
      console.error('[music] play_music_track backend error', resp.Err.error)
    }
  } catch (error) {
    console.error('[music] play_music_track failed', error)
  }
}

export async function getMusicTrackState(): Promise<MusicTrackState | null> {
  if (!isTauriEnv()) return null
  try {
    const resp = await invoke<BackendResult<MusicTrackState>>('get_music_track_state')
    if ('Ok' in resp) {
      return resp.Ok.data
    }
    console.error('[music] get_music_track_state backend error', resp.Err.error)
    return null
  } catch (error) {
    console.error('[music] get_music_track_state failed', error)
    return null
  }
}

export async function getMusicTrackDuration(playlistId: string, musicSoundFile: string): Promise<number | null> {
  if (!isTauriEnv()) return null
  try {
    const resp = await invoke<BackendResult<number | null>>('get_music_track_duration', {
      playlistId,
      musicSoundFile,
    })
    if ('Ok' in resp) {
      return resp.Ok.data
    }
    console.error('[music] get_music_track_duration backend error', resp.Err.error)
    return null
  } catch (error) {
    console.error('[music] get_music_track_duration failed', error)
    return null
  }
}

export async function seekMusicTrack(positionMs: number): Promise<void> {
  if (!isTauriEnv()) return
  try {
    const resp = await invoke<BackendResult<null>>('seek_music_track', {
      positionMs,
    })
    if ('Err' in resp) {
      console.error('[music] seek_music_track backend error', resp.Err.error)
    }
  } catch (error) {
    console.error('[music] seek_music_track failed', error)
  }
}

export async function setMusicTrackVolume(volume: number): Promise<void> {
  if (!isTauriEnv()) return
  try {
    const resp = await invoke<BackendResult<null>>('set_music_track_volume', {
      volume,
    })
    if ('Err' in resp) {
      console.error('[music] set_music_track_volume backend error', resp.Err.error)
    }
  } catch (error) {
    console.error('[music] set_music_track_volume failed', error)
  }
}

export async function pauseMusicTrack(): Promise<void> {
  if (!isTauriEnv()) return
  try {
    const resp = await invoke<BackendResult<null>>('pause_music_track')
    if ('Err' in resp) {
      console.error('[music] pause_music_track backend error', resp.Err.error)
    }
  } catch (error) {
    console.error('[music] pause_music_track failed', error)
  }
}

export async function pauseMusicTrackByAlarm(): Promise<void> {
  if (!isTauriEnv()) return
  try {
    const resp = await invoke<BackendResult<null>>('pause_music_track_by_alarm')
    if ('Err' in resp) {
      console.error('[music] pause_music_track_by_alarm backend error', resp.Err.error)
    }
  } catch (error) {
    console.error('[music] pause_music_track_by_alarm failed', error)
  }
}

export async function resumeMusicTrack(): Promise<void> {
  if (!isTauriEnv()) return
  try {
    const resp = await invoke<BackendResult<null>>('resume_music_track')
    if ('Err' in resp) {
      console.error('[music] resume_music_track backend error', resp.Err.error)
    }
  } catch (error) {
    console.error('[music] resume_music_track failed', error)
  }
}

export async function stopMusicTrack(): Promise<void> {
  if (!isTauriEnv()) return
  try {
    const resp = await invoke<BackendResult<null>>('stop_music_track')
    if ('Err' in resp) {
      console.error('[music] stop_music_track backend error', resp.Err.error)
    }
  } catch (error) {
    console.error('[music] stop_music_track failed', error)
  }
}
