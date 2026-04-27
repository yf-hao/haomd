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

/// 存放路径：~/Library/Application Support/com.yfhao.haomd/notes_config.json
pub fn notes_config_path<R: Runtime>(app: &AppHandle<R>) -> std::io::Result<PathBuf> {
    if let Ok(mut dir) = app.path().config_dir() {
        dir.push(app.config().identifier.as_str());
        std::fs::create_dir_all(&dir)?;
        return Ok(dir.join("notes_config.json"));
    }
    let dir = std::env::current_dir()?;
    Ok(dir.join("notes_config.json"))
}

#[tauri::command]
pub async fn load_notes_config(app: AppHandle) -> ResultPayload<NotesConfigData> {
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

    if !path.exists() {
        return ok(NotesConfigData::default(), trace);
    }

    match fs::read_to_string(&path).await {
        Ok(content) => match serde_json::from_str::<NotesConfigData>(&content) {
            Ok(cfg) => ok(cfg, trace),
            Err(err) => err_payload(
                ErrorCode::IoError,
                format!("解析 notes_config 失败: {err}"),
                trace,
            ),
        },
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
            Ok(_) => ok((), trace),
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
