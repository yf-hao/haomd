import { invoke } from '@tauri-apps/api/core'
import type { BackendResult } from '../../platform/backendTypes'
import { isTauriEnv } from '../../platform/runtime'

export type ImportedMusicSound = {
  fileName: string
  targetPath: string
}

export async function loadMusicSoundFiles(): Promise<string[]> {
  if (!isTauriEnv()) return []
  try {
    const resp = await invoke<BackendResult<string[]>>('list_music_sound_files')
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
  const files = await loadMusicSoundFiles()
  return files[0] ?? null
}

export async function importMusicSound(sourcePath: string): Promise<string | null> {
  if (!isTauriEnv()) return null
  try {
    const resp = await invoke<BackendResult<ImportedMusicSound>>('import_music_sound', { sourcePath })
    if ('Ok' in resp) return resp.Ok.data.fileName
    console.error('[music] import_music_sound backend error', resp.Err.error)
    return null
  } catch (error) {
    console.error('[music] import_music_sound failed', error)
    return null
  }
}
