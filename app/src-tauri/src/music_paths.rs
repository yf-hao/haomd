use crate::haomd_paths::haomd_data_root_dir;
use std::path::PathBuf;
use tauri::AppHandle;
use tokio::fs;

pub fn music_root_dir(app: &AppHandle) -> std::io::Result<PathBuf> {
    Ok(haomd_data_root_dir(app)?.join("music"))
}

pub async fn ensure_music_root_dir(app: &AppHandle) -> std::io::Result<PathBuf> {
    let root = music_root_dir(app)?;
    fs::create_dir_all(&root).await?;
    Ok(root)
}
