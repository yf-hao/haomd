use crate::haomd_paths::haomd_config_file;
use crate::webdav_change_tracker::WebDavChangeTracker;
use crate::{err_payload, new_trace_id, ok, ErrorCode, ResultPayload};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};
use tokio::fs;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct NotesConfigData {
    pub notes_directory: Option<String>,
}

/// 存放路径：~/Library/Application Support/haomd/notes_config.json
pub fn notes_config_path<R: Runtime>(app: &AppHandle<R>) -> std::io::Result<PathBuf> {
    haomd_config_file(app, "notes_config.json")
}

pub async fn load_notes_config_data(app: &AppHandle) -> std::io::Result<NotesConfigData> {
    let path = notes_config_path(app)?;
    if !path.exists() {
        return Ok(NotesConfigData::default());
    }
    let content = fs::read_to_string(&path).await?;
    Ok(serde_json::from_str::<NotesConfigData>(&content).unwrap_or_default())
}

#[tauri::command]
pub async fn load_notes_config(app: AppHandle) -> ResultPayload<NotesConfigData> {
    let trace = new_trace_id();
    match load_notes_config_data(&app).await {
        Ok(cfg) => ok(cfg, trace),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("读取 notes_config 失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
pub async fn save_notes_config(app: AppHandle, cfg: NotesConfigData) -> ResultPayload<()> {
    let trace = new_trace_id();
    let path = match notes_config_path(&app) {
        Ok(p) => p,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取 notes_config 路径失败: {err}"),
                trace,
            )
        }
    };

    match serde_json::to_string_pretty(&cfg) {
        Ok(json) => match fs::write(&path, json).await {
            Ok(_) => {
                if let Some(tracker) = app.try_state::<WebDavChangeTracker>() {
                    let tracker = (*tracker).clone();
                    let app_handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(err) = tracker.refresh_watch_roots(app_handle).await {
                            eprintln!("[backup] WebDAV change tracker refresh failed: {err}");
                        }
                    });
                }
                ok((), trace)
            }
            Err(err) => err_payload(
                ErrorCode::IoError,
                format!("写入 notes_config 失败: {err}"),
                trace,
            ),
        },
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("序列化 notes_config 失败: {err}"),
            trace,
        ),
    }
}
