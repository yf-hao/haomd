import { invoke } from '@tauri-apps/api/core'
import type { BackendResult } from '../../platform/backendTypes'
import { isTauriEnv } from '../../platform/runtime'

export type MusicPlaylistRecord = {
  id: string
  name: string
  trackFiles: string[]
  createdAt: string
  updatedAt: string
}

export type MusicPlaylistStore = {
  activePlaylistId: string
  playlists: MusicPlaylistRecord[]
}

export async function loadMusicPlaylistStore(): Promise<MusicPlaylistStore | null> {
  if (!isTauriEnv()) return null
  try {
    const resp = await invoke<BackendResult<MusicPlaylistStore>>('load_music_playlist_store')
    if ('Ok' in resp) {
      return resp.Ok.data
    }
    console.error('[music] load_music_playlist_store backend error', resp.Err.error)
    return null
  } catch (error) {
    console.error('[music] load_music_playlist_store failed', error)
    return null
  }
}

export async function saveMusicPlaylistStore(store: MusicPlaylistStore): Promise<void> {
  if (!isTauriEnv()) return
  try {
    const resp = await invoke<BackendResult<null>>('save_music_playlist_store', { store })
    if ('Err' in resp) {
      console.error('[music] save_music_playlist_store backend error', resp.Err.error)
    }
  } catch (error) {
    console.error('[music] save_music_playlist_store failed', error)
  }
}

