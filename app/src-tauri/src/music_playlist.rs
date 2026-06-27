use crate::music_paths::ensure_music_root_dir;
use crate::{err_payload, new_trace_id, ok, ErrorCode, ResultPayload};
use chrono::Utc;
use rand::random;
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
    serde_json::from_str::<T>(&content)
        .map_err(|err| std::io::Error::new(std::io::ErrorKind::InvalidData, err.to_string()))
}

async fn write_json<T>(path: &Path, data: &T) -> std::io::Result<()>
where
    T: Serialize,
{
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    let json = serde_json::to_string_pretty(data)?;
    let tmp_path = path.with_extension(format!(
        "json.tmp-{}-{}",
        std::process::id(),
        random::<u64>()
    ));
    fs::write(&tmp_path, json).await?;
    match fs::rename(&tmp_path, path).await {
        Ok(_) => Ok(()),
        Err(err) => {
            let _ = fs::remove_file(&tmp_path).await;
            Err(err)
        }
    }
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

fn store_summary(store: &MusicPlaylistStore) -> String {
    let playlists = store
        .playlists
        .iter()
        .map(|playlist| {
            format!(
                "{}:{}({})",
                playlist.id,
                playlist.name,
                playlist.track_files.len()
            )
        })
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "active={}, playlists=[{}]",
        store.active_playlist_id, playlists
    )
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
    log::info!("[music][playlist][load] start trace={}", trace);
    if let Err(err) = ensure_music_root_dir(app).await {
        log::error!(
            "[music][playlist][load] ensure root dir failed trace={} err={}",
            trace,
            err
        );
        return err_payload(
            ErrorCode::IoError,
            format!("准备音乐目录失败: {err}"),
            trace,
        );
    }
    let path = match playlist_store_path(app) {
        Ok(path) => path,
        Err(err) => {
            log::error!(
                "[music][playlist][load] resolve store path failed trace={} err={}",
                trace,
                err
            );
            return err_payload(
                ErrorCode::IoError,
                format!("获取播放列表路径失败: {err}"),
                trace,
            );
        }
    };
    match read_json::<MusicPlaylistStore>(&path).await {
        Ok(store) => {
            let normalized = normalize_store(store);
            log::info!(
                "[music][playlist][load] ok trace={} path={} {}",
                trace,
                path.display(),
                store_summary(&normalized)
            );
            ok(normalized, trace)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            log::info!(
                "[music][playlist][load] not-found trace={} path={} fallback=default",
                trace,
                path.display()
            );
            ok(default_playlist_store(), trace)
        }
        Err(err) if err.kind() == std::io::ErrorKind::InvalidData => {
            log::error!(
                "[music][playlist][load] invalid-data trace={} path={} err={}",
                trace,
                path.display(),
                err
            );
            err_payload(
                ErrorCode::IoError,
                format!("读取播放列表失败: {err}"),
                trace,
            )
        }
        Err(err) => {
            log::error!(
                "[music][playlist][load] failed trace={} path={} err={}",
                trace,
                path.display(),
                err
            );
            err_payload(
                ErrorCode::IoError,
                format!("读取播放列表失败: {err}"),
                trace,
            )
        }
    }
}

pub async fn save_music_playlist_store_impl(
    app: &AppHandle,
    store: MusicPlaylistStore,
) -> ResultPayload<()> {
    let trace = new_trace_id();
    log::info!(
        "[music][playlist][save] start trace={} {}",
        trace,
        store_summary(&store)
    );
    if let Err(err) = ensure_music_root_dir(app).await {
        log::error!(
            "[music][playlist][save] ensure root dir failed trace={} err={}",
            trace,
            err
        );
        return err_payload(
            ErrorCode::IoError,
            format!("准备音乐目录失败: {err}"),
            trace,
        );
    }
    let path = match playlist_store_path(app) {
        Ok(path) => path,
        Err(err) => {
            log::error!(
                "[music][playlist][save] resolve store path failed trace={} err={}",
                trace,
                err
            );
            return err_payload(
                ErrorCode::IoError,
                format!("获取播放列表路径失败: {err}"),
                trace,
            );
        }
    };
    let normalized = normalize_store(store);
    log::info!(
        "[music][playlist][save] write path={} trace={} {}",
        path.display(),
        trace,
        store_summary(&normalized)
    );
    match write_json(&path, &normalized).await {
        Ok(_) => {
            log::info!(
                "[music][playlist][save] ok trace={} path={}",
                trace,
                path.display()
            );
            ok((), trace)
        }
        Err(err) => {
            log::error!(
                "[music][playlist][save] failed trace={} path={} err={}",
                trace,
                path.display(),
                err
            );
            err_payload(
                ErrorCode::IoError,
                format!("保存播放列表失败: {err}"),
                trace,
            )
        }
    }
}

pub async fn update_music_playlist_tracks_impl(
    app: &AppHandle,
    playlist_id: &str,
    track_files: Vec<String>,
) -> ResultPayload<()> {
    let trace = new_trace_id();
    log::info!(
        "[music][playlist][update-tracks] start trace={} playlist_id={} track_count={}",
        trace,
        playlist_id,
        track_files.len()
    );
    let loaded = load_music_playlist_store_impl(app).await;
    let mut store = match loaded {
        ResultPayload::Ok { data, .. } => data,
        ResultPayload::Err { error } => {
            log::error!(
                "[music][playlist][update-tracks] load failed trace={} playlist_id={} err={:?}",
                trace,
                playlist_id,
                error
            );
            return ResultPayload::Err { error };
        }
    };
    let Some(playlist) = store
        .playlists
        .iter_mut()
        .find(|item| item.id == playlist_id)
    else {
        log::warn!(
            "[music][playlist][update-tracks] missing trace={} playlist_id={}",
            trace,
            playlist_id
        );
        return err_payload(
            ErrorCode::InvalidPath,
            format!("未找到播放列表: {playlist_id}"),
            trace,
        );
    };
    playlist.track_files = track_files;
    playlist.updated_at = Utc::now().to_rfc3339();
    log::info!(
        "[music][playlist][update-tracks] updated trace={} playlist_id={} track_count={}",
        trace,
        playlist_id,
        playlist.track_files.len()
    );
    match save_music_playlist_store_impl(app, store).await {
        ResultPayload::Ok { .. } => {
            log::info!(
                "[music][playlist][update-tracks] ok trace={} playlist_id={}",
                trace,
                playlist_id
            );
            ok((), trace)
        }
        ResultPayload::Err { error } => ResultPayload::Err { error },
    }
}

pub async fn ensure_music_playlist_record_exists_impl(
    app: &AppHandle,
    playlist_id: &str,
) -> ResultPayload<()> {
    let trace = new_trace_id();
    log::info!(
        "[music][playlist][ensure] start trace={} playlist_id={}",
        trace,
        playlist_id
    );
    let loaded = load_music_playlist_store_impl(app).await;
    let store = match loaded {
        ResultPayload::Ok { data, .. } => data,
        ResultPayload::Err { error } => {
            log::error!(
                "[music][playlist][ensure] load failed trace={} playlist_id={} err={:?}",
                trace,
                playlist_id,
                error
            );
            return ResultPayload::Err { error };
        }
    };
    if !store.playlists.iter().any(|item| item.id == playlist_id) {
        log::warn!(
            "[music][playlist][ensure] missing trace={} playlist_id={}",
            trace,
            playlist_id
        );
        return err_payload(
            ErrorCode::InvalidPath,
            format!("未找到播放列表: {playlist_id}"),
            trace,
        );
    }
    log::info!(
        "[music][playlist][ensure] ok trace={} playlist_id={}",
        trace,
        playlist_id
    );
    ok((), trace)
}

pub async fn rename_music_playlist_impl(
    app: &AppHandle,
    playlist_id: &str,
    new_name: &str,
) -> ResultPayload<()> {
    let trace = new_trace_id();
    let new_name = new_name.trim();
    log::info!(
        "[music][playlist][rename] start trace={} playlist_id={} new_name={}",
        trace,
        playlist_id,
        new_name
    );
    if new_name.is_empty() {
        return err_payload(
            ErrorCode::InvalidPath,
            "播放列表名称不能为空".to_string(),
            trace,
        );
    }

    let loaded = load_music_playlist_store_impl(app).await;
    let mut store = match loaded {
        ResultPayload::Ok { data, .. } => data,
        ResultPayload::Err { error } => {
            log::error!(
                "[music][playlist][rename] load failed trace={} playlist_id={} err={:?}",
                trace,
                playlist_id,
                error
            );
            return ResultPayload::Err { error };
        }
    };
    let Some(playlist) = store
        .playlists
        .iter_mut()
        .find(|item| item.id == playlist_id)
    else {
        log::warn!(
            "[music][playlist][rename] missing trace={} playlist_id={}",
            trace,
            playlist_id
        );
        return err_payload(
            ErrorCode::InvalidPath,
            format!("未找到播放列表: {playlist_id}"),
            trace,
        );
    };
    playlist.name = new_name.to_string();
    playlist.updated_at = Utc::now().to_rfc3339();
    log::info!(
        "[music][playlist][rename] updated trace={} playlist_id={} new_name={}",
        trace,
        playlist_id,
        new_name
    );
    match save_music_playlist_store_impl(app, store).await {
        ResultPayload::Ok { .. } => {
            log::info!(
                "[music][playlist][rename] ok trace={} playlist_id={}",
                trace,
                playlist_id
            );
            ok((), trace)
        }
        ResultPayload::Err { error } => ResultPayload::Err { error },
    }
}

pub async fn delete_music_playlist_impl(app: &AppHandle, playlist_id: &str) -> ResultPayload<()> {
    let trace = new_trace_id();
    let playlist_id = playlist_id.trim();
    log::info!(
        "[music][playlist][delete] start trace={} playlist_id={}",
        trace,
        playlist_id
    );
    if playlist_id.is_empty() {
        return err_payload(
            ErrorCode::InvalidPath,
            "播放列表 ID 无效".to_string(),
            trace,
        );
    }
    if playlist_id == "default" {
        return err_payload(
            ErrorCode::InvalidPath,
            "默认列表不能删除".to_string(),
            trace,
        );
    }

    let loaded = load_music_playlist_store_impl(app).await;
    let mut store = match loaded {
        ResultPayload::Ok { data, .. } => data,
        ResultPayload::Err { error } => {
            log::error!(
                "[music][playlist][delete] load failed trace={} playlist_id={} err={:?}",
                trace,
                playlist_id,
                error
            );
            return ResultPayload::Err { error };
        }
    };
    let Some(index) = store
        .playlists
        .iter()
        .position(|item| item.id == playlist_id)
    else {
        log::warn!(
            "[music][playlist][delete] missing trace={} playlist_id={}",
            trace,
            playlist_id
        );
        return err_payload(
            ErrorCode::InvalidPath,
            format!("未找到播放列表: {playlist_id}"),
            trace,
        );
    };

    let removed = store.playlists.remove(index);
    if store.active_playlist_id == removed.id {
        store.active_playlist_id = store
            .playlists
            .first()
            .map(|playlist| playlist.id.clone())
            .unwrap_or_else(|| "default".to_string());
    }

    match save_music_playlist_store_impl(app, store).await {
        ResultPayload::Ok { .. } => {
            log::info!(
                "[music][playlist][delete] store updated trace={} playlist_id={}",
                trace,
                playlist_id
            );
        }
        ResultPayload::Err { error } => {
            log::error!(
                "[music][playlist][delete] save failed trace={} playlist_id={} err={:?}",
                trace,
                playlist_id,
                error
            );
            return ResultPayload::Err { error };
        }
    }

    let dir = match crate::music_paths::music_playlist_dir(app, playlist_id) {
        Ok(dir) => dir,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取播放列表目录失败: {err}"),
                trace,
            );
        }
    };
    match fs::remove_dir_all(&dir).await {
        Ok(_) => {
            log::info!(
                "[music][playlist][delete] dir removed trace={} playlist_id={} path={}",
                trace,
                playlist_id,
                dir.display()
            );
            ok((), trace)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            log::warn!(
                "[music][playlist][delete] dir missing trace={} playlist_id={} path={}",
                trace,
                playlist_id,
                dir.display()
            );
            ok((), trace)
        }
        Err(err) => {
            log::error!(
                "[music][playlist][delete] dir remove failed trace={} playlist_id={} path={} err={}",
                trace,
                playlist_id,
                dir.display(),
                err
            );
            err_payload(
                ErrorCode::IoError,
                format!("删除播放列表目录失败: {err}"),
                trace,
            )
        }
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

#[tauri::command]
pub async fn rename_music_playlist(
    app: AppHandle,
    playlist_id: String,
    new_name: String,
) -> ResultPayload<()> {
    rename_music_playlist_impl(&app, &playlist_id, &new_name).await
}

#[tauri::command]
pub async fn delete_music_playlist(app: AppHandle, playlist_id: String) -> ResultPayload<()> {
    delete_music_playlist_impl(&app, &playlist_id).await
}
