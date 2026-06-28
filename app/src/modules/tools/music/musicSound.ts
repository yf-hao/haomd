import { invoke } from '@tauri-apps/api/core'
import type { BackendResult } from '../../platform/backendTypes'
import { isTauriEnv } from '../../platform/runtime'

export type ImportedMusicSound = {
  fileName: string
  targetPath: string
}

export async function loadMusicSoundFiles(playlistId: string): Promise<string[]> {
  if (!isTauriEnv()) return []
  try {
    const resp = await invoke<BackendResult<string[]>>('list_music_sound_files', { playlistId })
    if ('Ok' in resp) {
      return resp.Ok.data
    }
    console.error('[music] list_music_sound_files backend error', resp.Err.error)
    return []
  } catch (error) {
    console.error('[music] list_music_sound_files failed', error)
    return []
  }
}

export async function loadLatestMusicSoundFile(): Promise<string | null> {
  const files = await loadMusicSoundFiles('default')
  return files[0] ?? null
}

export async function importMusicSound(playlistId: string, sourcePath: string): Promise<string | null> {
  if (!isTauriEnv()) return null
  try {
    const resp = await invoke<BackendResult<ImportedMusicSound>>('import_music_sound', { playlistId, sourcePath })
    if ('Ok' in resp) return resp.Ok.data.fileName
    console.error('[music] import_music_sound backend error', resp.Err.error)
    return null
  } catch (error) {
    console.error('[music] import_music_sound failed', error)
    return null
  }
}

export async function importMusicSounds(playlistId: string, sourcePaths: string[]): Promise<string[]> {
  if (!isTauriEnv()) return []
  try {
    const resp = await invoke<BackendResult<ImportedMusicSound[]>>('import_music_sounds', {
      playlistId,
      sourcePaths,
    })
    if ('Ok' in resp) {
      return resp.Ok.data.map((item) => item.fileName)
    }
    console.error('[music] import_music_sounds backend error', resp.Err.error)
    return []
  } catch (error) {
    console.error('[music] import_music_sounds failed', error)
    return []
  }
}

export async function deleteMusicSound(playlistId: string, fileName: string): Promise<boolean> {
  if (!isTauriEnv()) return false
  try {
    const resp = await invoke<BackendResult<null>>('delete_music_sound', { playlistId, fileName })
    if ('Err' in resp) {
      console.error('[music] delete_music_sound backend error', resp.Err.error)
      return false
    }
    return true
  } catch (error) {
    console.error('[music] delete_music_sound failed', error)
    return false
  }
}

export async function moveMusicSound(sourcePlaylistId: string, targetPlaylistId: string, fileName: string): Promise<boolean> {
  if (!isTauriEnv()) return false
  try {
    const resp = await invoke<BackendResult<null>>('move_music_sound', {
      sourcePlaylistId,
      targetPlaylistId,
      fileName,
    })
    if ('Err' in resp) {
      console.error('[music] move_music_sound backend error', resp.Err.error)
      return false
    }
    return true
  } catch (error) {
    console.error('[music] move_music_sound failed', error)
    return false
  }
}
