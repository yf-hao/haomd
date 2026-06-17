use crate::music_paths::{
    ensure_music_playlist_dir, ensure_music_playlist_tracks_dir, music_playlist_tracks_dir,
};
use crate::music_playlist::{
    ensure_music_playlist_record_exists_impl, update_music_playlist_tracks_impl,
};
use crate::{err_payload, new_trace_id, ok, ErrorCode, ResultPayload};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tokio::fs;
use url::Url;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MusicSoundRecord {
    pub file_name: String,
    pub target_path: String,
}

const AUDIO_EXTENSIONS: &[&str] = &[
    "wav", "mp3", "ogg", "oga", "flac", "aac", "m4a", "m4b", "aiff", "aif", "webm", "wma",
];

fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            AUDIO_EXTENSIONS
                .iter()
                .any(|candidate| ext.eq_ignore_ascii_case(candidate))
        })
        .unwrap_or(false)
}

fn normalize_source_path(source_path: &str) -> std::io::Result<PathBuf> {
    let trimmed = source_path.trim();
    if trimmed.is_empty() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "缺少音频文件路径",
        ));
    }

    if let Ok(url) = Url::parse(trimmed) {
        if url.scheme() == "file" {
            return url.to_file_path().map_err(|_| {
                std::io::Error::new(std::io::ErrorKind::InvalidInput, "音频文件路径无效")
            });
        }
    }

    Ok(PathBuf::from(trimmed))
}

fn normalize_sound_file_name(source_path: &Path) -> std::io::Result<String> {
    let file_name = source_path
        .file_name()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "音频文件名无效"))?;
    let file_name = file_name.to_string_lossy().trim().to_string();
    if file_name.is_empty() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "音频文件名无效",
        ));
    }
    Ok(file_name)
}

fn normalize_playlist_id(playlist_id: &str) -> std::io::Result<String> {
    let normalized = playlist_id.trim();
    if normalized.is_empty() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "播放列表 ID 无效",
        ));
    }
    Ok(normalized.to_string())
}

fn playlist_tracks_dir(app: &AppHandle, playlist_id: &str) -> std::io::Result<PathBuf> {
    music_playlist_tracks_dir(app, playlist_id)
}

async fn collect_sound_files(
    dir: &PathBuf,
) -> std::io::Result<Vec<(String, std::time::SystemTime)>> {
    let mut list = Vec::new();
    let Ok(mut reader) = fs::read_dir(dir).await else {
        return Ok(list);
    };
    while let Some(entry) = reader.next_entry().await? {
        let path = entry.path();
        if !path.is_file() || !is_audio_file(&path) {
            continue;
        }
        let file_name = match path.file_name().and_then(|name| name.to_str()) {
            Some(name) if !name.trim().is_empty() => name.trim().to_string(),
            _ => continue,
        };
        let modified = entry
            .metadata()
            .await
            .ok()
            .and_then(|meta| meta.modified().ok())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        list.push((file_name, modified));
    }
    list.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| b.0.cmp(&a.0)));
    Ok(list)
}

pub async fn ensure_music_sound_available(
    app: &AppHandle,
    playlist_id: &str,
    file_name: &str,
) -> std::io::Result<PathBuf> {
    let playlist_id = normalize_playlist_id(playlist_id)?;
    let dir = ensure_music_playlist_tracks_dir(app, &playlist_id).await?;
    Ok(dir.join(file_name))
}

#[tauri::command]
pub async fn list_music_sound_files(
    app: AppHandle,
    playlist_id: String,
) -> ResultPayload<Vec<String>> {
    let trace = new_trace_id();
    let playlist_id = match normalize_playlist_id(&playlist_id) {
        Ok(id) => id,
        Err(err) => {
            return err_payload(
                ErrorCode::InvalidPath,
                format!("播放列表 ID 无效: {err}"),
                trace,
            )
        }
    };
    match ensure_music_playlist_record_exists_impl(&app, &playlist_id).await {
        ResultPayload::Ok { .. } => {}
        ResultPayload::Err { error } => return ResultPayload::Err { error },
    }
    if let Err(err) = ensure_music_playlist_dir(&app, &playlist_id).await {
        return err_payload(
            ErrorCode::IoError,
            format!("准备音乐目录失败: {err}"),
            trace,
        );
    }

    let entries = collect_sound_files(&playlist_tracks_dir(&app, &playlist_id).unwrap_or_default())
        .await
        .unwrap_or_default();
    let mut deduped = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (file_name, _) in entries {
        if seen.insert(file_name.clone()) {
            deduped.push(file_name);
        }
    }
    ok(deduped, trace)
}

#[tauri::command]
pub async fn import_music_sound(
    app: AppHandle,
    playlist_id: String,
    source_path: String,
) -> ResultPayload<MusicSoundRecord> {
    let trace = new_trace_id();
    let playlist_id = match normalize_playlist_id(&playlist_id) {
        Ok(id) => id,
        Err(err) => {
            return err_payload(
                ErrorCode::InvalidPath,
                format!("播放列表 ID 无效: {err}"),
                trace,
            )
        }
    };
    match ensure_music_playlist_record_exists_impl(&app, &playlist_id).await {
        ResultPayload::Ok { .. } => {}
        ResultPayload::Err { error } => return ResultPayload::Err { error },
    }
    if let Err(err) = ensure_music_playlist_dir(&app, &playlist_id).await {
        return err_payload(
            ErrorCode::IoError,
            format!("准备音乐目录失败: {err}"),
            trace,
        );
    }
    let source = match normalize_source_path(&source_path) {
        Ok(path) => path,
        Err(err) => {
            return err_payload(
                ErrorCode::InvalidPath,
                format!("缺少或无效的音频文件路径: {err}"),
                trace,
            )
        }
    };
    if !source.exists() {
        return err_payload(ErrorCode::InvalidPath, "音频文件不存在".to_string(), trace);
    }
    if !is_audio_file(&source) {
        return err_payload(ErrorCode::InvalidPath, "请选择音频文件".to_string(), trace);
    }
    let file_name = match normalize_sound_file_name(&source) {
        Ok(name) => name,
        Err(err) => {
            return err_payload(
                ErrorCode::InvalidPath,
                format!("音频文件名无效: {err}"),
                trace,
            )
        }
    };
    let dir = match ensure_music_playlist_tracks_dir(&app, &playlist_id).await {
        Ok(dir) => dir,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取音乐音频目录失败: {err}"),
                trace,
            )
        }
    };
    let target = dir.join(&file_name);
    if let Err(err) = fs::copy(&source, &target).await {
        return err_payload(
            ErrorCode::IoError,
            format!("导入音乐音频失败: {err}"),
            trace,
        );
    }
    match sync_playlist_tracks(&app, &playlist_id).await {
        ResultPayload::Ok { .. } => ok(
            MusicSoundRecord {
                file_name,
                target_path: target.to_string_lossy().into_owned(),
            },
            trace,
        ),
        ResultPayload::Err { error } => ResultPayload::Err { error },
    }
}

#[tauri::command]
pub async fn delete_music_sound(
    app: AppHandle,
    playlist_id: String,
    file_name: String,
) -> ResultPayload<()> {
    let trace = new_trace_id();
    let playlist_id = match normalize_playlist_id(&playlist_id) {
        Ok(id) => id,
        Err(err) => {
            return err_payload(
                ErrorCode::InvalidPath,
                format!("播放列表 ID 无效: {err}"),
                trace,
            )
        }
    };
    match ensure_music_playlist_record_exists_impl(&app, &playlist_id).await {
        ResultPayload::Ok { .. } => {}
        ResultPayload::Err { error } => return ResultPayload::Err { error },
    }
    let dir = match ensure_music_playlist_tracks_dir(&app, &playlist_id).await {
        Ok(dir) => dir,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取音乐音频目录失败: {err}"),
                trace,
            )
        }
    };
    let target = dir.join(&file_name);
    match fs::remove_file(&target).await {
        Ok(_) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("删除音乐文件失败: {err}"),
                trace,
            )
        }
    }
    match sync_playlist_tracks(&app, &playlist_id).await {
        ResultPayload::Ok { .. } => ok((), trace),
        ResultPayload::Err { error } => ResultPayload::Err { error },
    }
}

#[tauri::command]
pub async fn move_music_sound(
    app: AppHandle,
    source_playlist_id: String,
    target_playlist_id: String,
    file_name: String,
) -> ResultPayload<()> {
    let trace = new_trace_id();
    let source_playlist_id = match normalize_playlist_id(&source_playlist_id) {
        Ok(id) => id,
        Err(err) => {
            return err_payload(
                ErrorCode::InvalidPath,
                format!("源播放列表 ID 无效: {err}"),
                trace,
            )
        }
    };
    let target_playlist_id = match normalize_playlist_id(&target_playlist_id) {
        Ok(id) => id,
        Err(err) => {
            return err_payload(
                ErrorCode::InvalidPath,
                format!("目标播放列表 ID 无效: {err}"),
                trace,
            )
        }
    };
    if source_playlist_id == target_playlist_id {
        return ok((), trace);
    }
    match ensure_music_playlist_record_exists_impl(&app, &source_playlist_id).await {
        ResultPayload::Ok { .. } => {}
        ResultPayload::Err { error } => return ResultPayload::Err { error },
    }
    match ensure_music_playlist_record_exists_impl(&app, &target_playlist_id).await {
        ResultPayload::Ok { .. } => {}
        ResultPayload::Err { error } => return ResultPayload::Err { error },
    }

    let source_dir = match ensure_music_playlist_tracks_dir(&app, &source_playlist_id).await {
        Ok(dir) => dir,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取源音乐目录失败: {err}"),
                trace,
            )
        }
    };
    let target_dir = match ensure_music_playlist_tracks_dir(&app, &target_playlist_id).await {
        Ok(dir) => dir,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取目标音乐目录失败: {err}"),
                trace,
            )
        }
    };
    let source = source_dir.join(&file_name);
    let target = target_dir.join(&file_name);
    if let Err(err) = fs::copy(&source, &target).await {
        return err_payload(
            ErrorCode::IoError,
            format!("移动音乐文件失败: {err}"),
            trace,
        );
    }
    match fs::remove_file(&source).await {
        Ok(_) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("删除源音乐文件失败: {err}"),
                trace,
            )
        }
    }
    let _ = sync_playlist_tracks(&app, &source_playlist_id).await;
    match sync_playlist_tracks(&app, &target_playlist_id).await {
        ResultPayload::Ok { .. } => ok((), trace),
        ResultPayload::Err { error } => ResultPayload::Err { error },
    }
}

async fn sync_playlist_tracks(app: &AppHandle, playlist_id: &str) -> ResultPayload<()> {
    let trace = new_trace_id();
    let entries =
        match collect_sound_files(&playlist_tracks_dir(app, playlist_id).unwrap_or_default()).await
        {
            Ok(entries) => entries,
            Err(err) => {
                return err_payload(
                    ErrorCode::IoError,
                    format!("读取音乐目录失败: {err}"),
                    trace,
                );
            }
        };
    let track_files = entries
        .into_iter()
        .map(|(name, _)| name)
        .collect::<Vec<_>>();
    update_music_playlist_tracks_impl(app, playlist_id, track_files).await
}
