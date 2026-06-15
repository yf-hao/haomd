use crate::music_paths::{ensure_music_root_dir, music_root_dir};
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

fn sound_dir(app: &AppHandle) -> std::io::Result<PathBuf> {
    Ok(music_root_dir(app)?.join("sounds"))
}

const AUDIO_EXTENSIONS: &[&str] = &[
    "wav",
    "mp3",
    "ogg",
    "oga",
    "flac",
    "aac",
    "m4a",
    "m4b",
    "aiff",
    "aif",
    "webm",
    "wma",
];

fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| AUDIO_EXTENSIONS.iter().any(|candidate| ext.eq_ignore_ascii_case(candidate)))
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
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "音频文件名无效"));
    }
    Ok(file_name)
}

pub async fn ensure_music_sound_available(app: &AppHandle, file_name: &str) -> std::io::Result<PathBuf> {
    let dir = sound_dir(app)?;
    fs::create_dir_all(&dir).await?;
    Ok(dir.join(file_name))
}

#[tauri::command]
pub async fn list_music_sound_files(app: AppHandle) -> ResultPayload<Vec<String>> {
    let trace = new_trace_id();
    if let Err(err) = ensure_music_root_dir(&app).await {
        return err_payload(ErrorCode::IoError, format!("准备音乐目录失败: {err}"), trace);
    }

    let entries = collect_sound_files(&sound_dir(&app).unwrap_or_default())
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

async fn collect_sound_files(dir: &PathBuf) -> std::io::Result<Vec<(String, std::time::SystemTime)>> {
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

#[tauri::command]
pub async fn import_music_sound(
    app: AppHandle,
    source_path: String,
) -> ResultPayload<MusicSoundRecord> {
    let trace = new_trace_id();
    if let Err(err) = ensure_music_root_dir(&app).await {
        return err_payload(ErrorCode::IoError, format!("准备音乐目录失败: {err}"), trace);
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
    let file_name = match normalize_sound_file_name(&source) {
        Ok(name) => name,
        Err(err) => return err_payload(ErrorCode::InvalidPath, format!("音频文件名无效: {err}"), trace),
    };
    let dir = match sound_dir(&app) {
        Ok(dir) => dir,
        Err(err) => return err_payload(ErrorCode::IoError, format!("获取音乐音频目录失败: {err}"), trace),
    };
    if let Err(err) = fs::create_dir_all(&dir).await {
        return err_payload(ErrorCode::IoError, format!("创建音乐音频目录失败: {err}"), trace);
    }
    let target = dir.join(&file_name);
    if let Err(err) = fs::copy(&source, &target).await {
        return err_payload(ErrorCode::IoError, format!("导入音乐音频失败: {err}"), trace);
    }
    ok(
        MusicSoundRecord {
            file_name,
            target_path: target.to_string_lossy().into_owned(),
        },
        trace,
    )
}
