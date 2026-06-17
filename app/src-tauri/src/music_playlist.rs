use crate::music_paths::ensure_music_root_dir;
use crate::{err_payload, new_trace_id, ok, ErrorCode, ResultPayload};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tokio::fs;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MusicPlaylistRecord {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub track_files: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MusicPlaylistStore {
    pub active_playlist_id: String,
    #[serde(default)]
    pub playlists: Vec<MusicPlaylistRecord>,
}

fn playlist_store_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    Ok(crate::haomd_paths::haomd_data_root_dir(app)?
        .join("music")
        .join("playlists.json"))
}

async fn read_json<T>(path: &Path) -> std::io::Result<T>
where
    T: for<'de> Deserialize<'de>,
{
    let content = fs::read_to_string(path).await?;
    serde_json::from_str::<T>(&content).map_err(|err| std::io::Error::other(err.to_string()))
}

async fn write_json<T>(path: &Path, data: &T) -> std::io::Result<()>
where
    T: Serialize,
{
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    let json = serde_json::to_string_pretty(data)?;
    fs::write(path, json).await
}

fn default_playlist_store() -> MusicPlaylistStore {
    let now = Utc::now().to_rfc3339();
    let playlist = MusicPlaylistRecord {
        id: "default".to_string(),
        name: "默认列表".to_string(),
        track_files: vec![],
        created_at: now.clone(),
        updated_at: now,
    };
    MusicPlaylistStore {
        active_playlist_id: playlist.id.clone(),
        playlists: vec![playlist],
    }
}

fn normalize_store(mut store: MusicPlaylistStore) -> MusicPlaylistStore {
    if store.playlists.is_empty() {
        return default_playlist_store();
    }
    if !store
        .playlists
        .iter()
        .any(|playlist| playlist.id == store.active_playlist_id)
    {
        store.active_playlist_id = store.playlists[0].id.clone();
    }
    store
}

pub async fn load_music_playlist_store_impl(app: &AppHandle) -> ResultPayload<MusicPlaylistStore> {
    let trace = new_trace_id();
    if let Err(err) = ensure_music_root_dir(app).await {
        return err_payload(
            ErrorCode::IoError,
            format!("准备音乐目录失败: {err}"),
            trace,
        );
    }
    let path = match playlist_store_path(app) {
        Ok(path) => path,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取播放列表路径失败: {err}"),
                trace,
            )
        }
    };
    match read_json::<MusicPlaylistStore>(&path).await {
        Ok(store) => ok(normalize_store(store), trace),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            ok(default_playlist_store(), trace)
        }
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("读取播放列表失败: {err}"),
            trace,
        ),
    }
}

pub async fn save_music_playlist_store_impl(
    app: &AppHandle,
    store: MusicPlaylistStore,
) -> ResultPayload<()> {
    let trace = new_trace_id();
    if let Err(err) = ensure_music_root_dir(app).await {
        return err_payload(
            ErrorCode::IoError,
            format!("准备音乐目录失败: {err}"),
            trace,
        );
    }
    let path = match playlist_store_path(app) {
        Ok(path) => path,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取播放列表路径失败: {err}"),
                trace,
            )
        }
    };
    let normalized = normalize_store(store);
    match write_json(&path, &normalized).await {
        Ok(_) => ok((), trace),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("保存播放列表失败: {err}"),
            trace,
        ),
    }
}

pub async fn update_music_playlist_tracks_impl(
    app: &AppHandle,
    playlist_id: &str,
    track_files: Vec<String>,
) -> ResultPayload<()> {
    let trace = new_trace_id();
    let loaded = load_music_playlist_store_impl(app).await;
    let mut store = match loaded {
        ResultPayload::Ok { data, .. } => data,
        ResultPayload::Err { error } => {
            return ResultPayload::Err { error };
        }
    };
    let Some(playlist) = store
        .playlists
        .iter_mut()
        .find(|item| item.id == playlist_id)
    else {
        return err_payload(
            ErrorCode::InvalidPath,
            format!("未找到播放列表: {playlist_id}"),
            trace,
        );
    };
    playlist.track_files = track_files;
    playlist.updated_at = Utc::now().to_rfc3339();
    match save_music_playlist_store_impl(app, store).await {
        ResultPayload::Ok { .. } => ok((), trace),
        ResultPayload::Err { error } => ResultPayload::Err { error },
    }
}

pub async fn ensure_music_playlist_record_exists_impl(
    app: &AppHandle,
    playlist_id: &str,
) -> ResultPayload<()> {
    let trace = new_trace_id();
    let loaded = load_music_playlist_store_impl(app).await;
    let mut store = match loaded {
        ResultPayload::Ok { data, .. } => data,
        ResultPayload::Err { error } => {
            return ResultPayload::Err { error };
        }
    };
    if !store.playlists.iter().any(|item| item.id == playlist_id) {
        let now = Utc::now().to_rfc3339();
        store.playlists.push(MusicPlaylistRecord {
            id: playlist_id.to_string(),
            name: playlist_id.to_string(),
            track_files: vec![],
            created_at: now.clone(),
            updated_at: now,
        });
    }
    match save_music_playlist_store_impl(app, store).await {
        ResultPayload::Ok { .. } => ok((), trace),
        ResultPayload::Err { error } => ResultPayload::Err { error },
    }
}

#[tauri::command]
pub async fn load_music_playlist_store(app: AppHandle) -> ResultPayload<MusicPlaylistStore> {
    load_music_playlist_store_impl(&app).await
}

#[tauri::command]
pub async fn save_music_playlist_store(
    app: AppHandle,
    store: MusicPlaylistStore,
) -> ResultPayload<()> {
    save_music_playlist_store_impl(&app, store).await
}
