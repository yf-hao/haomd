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
      console.log('[music][playlists][load] ok', {
        activePlaylistId: resp.Ok.data.activePlaylistId,
        playlistCount: resp.Ok.data.playlists.length,
      })
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
    console.log('[music][playlists][save] start', {
      activePlaylistId: store.activePlaylistId,
      playlistCount: store.playlists.length,
      playlistIds: store.playlists.map((playlist) => playlist.id),
    })
    const resp = await invoke<BackendResult<null>>('save_music_playlist_store', { store })
    if ('Err' in resp) {
      console.error('[music] save_music_playlist_store backend error', resp.Err.error)
    } else {
      console.log('[music][playlists][save] ok', {
        activePlaylistId: store.activePlaylistId,
        playlistCount: store.playlists.length,
      })
    }
  } catch (error) {
    console.error('[music] save_music_playlist_store failed', error)
  }
}

export async function renameMusicPlaylist(playlistId: string, newName: string): Promise<boolean> {
  if (!isTauriEnv()) return true
  try {
    console.log('[music][playlists][rename] start', { playlistId, newName })
    const resp = await invoke<BackendResult<null>>('rename_music_playlist', { playlistId, newName })
    if ('Err' in resp) {
      console.error('[music] rename_music_playlist backend error', resp.Err.error)
      return false
    }
    return true
  } catch (error) {
    console.error('[music] rename_music_playlist failed', error)
    return false
  }
}

export async function deleteMusicPlaylist(playlistId: string): Promise<boolean> {
  if (!isTauriEnv()) return true
  try {
    console.log('[music][playlists][delete] start', { playlistId })
    const resp = await invoke<BackendResult<null>>('delete_music_playlist', { playlistId })
    if ('Err' in resp) {
      console.error('[music] delete_music_playlist backend error', resp.Err.error)
      return false
    }
    return true
  } catch (error) {
    console.error('[music] delete_music_playlist failed', error)
    return false
  }
}
