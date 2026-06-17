use crate::haomd_paths::haomd_data_root_dir;
use std::path::PathBuf;
use tauri::AppHandle;
use tokio::fs;

pub fn music_root_dir(app: &AppHandle) -> std::io::Result<PathBuf> {
    Ok(haomd_data_root_dir(app)?.join("music"))
}

pub fn music_playlists_root_dir(app: &AppHandle) -> std::io::Result<PathBuf> {
    Ok(music_root_dir(app)?.join("playlists"))
}

pub fn music_playlist_dir(app: &AppHandle, playlist_id: &str) -> std::io::Result<PathBuf> {
    Ok(music_playlists_root_dir(app)?.join(playlist_id))
}

pub fn music_playlist_tracks_dir(app: &AppHandle, playlist_id: &str) -> std::io::Result<PathBuf> {
    Ok(music_playlist_dir(app, playlist_id)?.join("tracks"))
}

pub async fn ensure_music_root_dir(app: &AppHandle) -> std::io::Result<PathBuf> {
    let root = music_root_dir(app)?;
    fs::create_dir_all(&root).await?;
    Ok(root)
}

pub async fn ensure_music_playlist_dir(app: &AppHandle, playlist_id: &str) -> std::io::Result<PathBuf> {
    let dir = music_playlist_dir(app, playlist_id)?;
    fs::create_dir_all(&dir).await?;
    Ok(dir)
}

pub async fn ensure_music_playlist_tracks_dir(app: &AppHandle, playlist_id: &str) -> std::io::Result<PathBuf> {
    let dir = music_playlist_tracks_dir(app, playlist_id)?;
    fs::create_dir_all(&dir).await?;
    Ok(dir)
}
