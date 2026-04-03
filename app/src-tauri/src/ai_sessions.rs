use crate::{err_payload, new_trace_id, ok, ErrorCode, ResultPayload};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tokio::fs;

// ─── Data structures ────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiChatMessageCfg {
    pub id: String,
    pub role: String,
    pub content: String,
    pub timestamp: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiChatSessionCfg {
    pub id: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub entry_mode: Option<String>,
    #[serde(default)]
    pub messages: Vec<AiChatMessageCfg>,
    #[serde(default)]
    pub provider_type: Option<String>,
    #[serde(default)]
    pub active_role_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiChatSessionIndexEntry {
    pub id: String,
    #[serde(default)]
    pub title: Option<String>,
    pub message_count: usize,
    pub created_at: i64,
    pub updated_at: i64,
}

// ─── File paths ─────────────────────────────────────────────────────

fn ai_sessions_dir(app: &AppHandle) -> std::io::Result<PathBuf> {
    if let Ok(mut dir) = app.path().config_dir() {
        dir.push("haomd");
        dir.push("ai-sessions");
        std::fs::create_dir_all(&dir)?;
        Ok(dir)
    } else {
        let mut dir = std::env::current_dir()?;
        dir.push("ai-sessions");
        std::fs::create_dir_all(&dir)?;
        Ok(dir)
    }
}

fn sessions_data_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    let mut dir = ai_sessions_dir(app)?;
    dir.push("sessions_data.json");
    Ok(dir)
}

fn sessions_index_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    let mut dir = ai_sessions_dir(app)?;
    dir.push("sessions_index.json");
    Ok(dir)
}

// ─── Internal read / write helpers ──────────────────────────────────

async fn read_all_sessions(app: &AppHandle) -> std::io::Result<Vec<AiChatSessionCfg>> {
    let path = sessions_data_path(app)?;
    match fs::read(&path).await {
        Ok(bytes) => {
            let records: Vec<AiChatSessionCfg> =
                serde_json::from_slice(&bytes).unwrap_or_default();
            Ok(records)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(err) => Err(err),
    }
}

async fn write_all_sessions(
    app: &AppHandle,
    records: &[AiChatSessionCfg],
) -> std::io::Result<()> {
    // Write full data
    let data_path = sessions_data_path(app)?;
    let data_bytes = serde_json::to_vec_pretty(records)?;
    fs::write(&data_path, data_bytes).await?;

    // Write lightweight index
    let index_entries: Vec<AiChatSessionIndexEntry> = records
        .iter()
        .map(|s| AiChatSessionIndexEntry {
            id: s.id.clone(),
            title: s.title.clone(),
            message_count: s.messages.len(),
            created_at: s.created_at,
            updated_at: s.updated_at,
        })
        .collect();

    let index_path = sessions_index_path(app)?;
    let index_bytes = serde_json::to_vec_pretty(&index_entries)?;
    fs::write(&index_path, index_bytes).await?;

    Ok(())
}

// ─── Tauri commands ─────────────────────────────────────────────────

#[tauri::command]
pub async fn load_ai_sessions_index(
    app: AppHandle,
) -> ResultPayload<Vec<AiChatSessionIndexEntry>> {
    let trace = new_trace_id();
    // Try to read index file first for fast loading
    let index_path = match sessions_index_path(&app) {
        Ok(p) => p,
        Err(err) => {
            return err_payload(ErrorCode::IoError, format!("获取 ai-sessions 路径失败: {err}"), trace);
        }
    };

    match fs::read(&index_path).await {
        Ok(bytes) => {
            let entries: Vec<AiChatSessionIndexEntry> =
                serde_json::from_slice(&bytes).unwrap_or_default();
            ok(entries, trace)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => ok(vec![], trace),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("读取 sessions_index 失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
pub async fn load_ai_session(
    app: AppHandle,
    id: String,
) -> ResultPayload<Option<AiChatSessionCfg>> {
    let trace = new_trace_id();
    match read_all_sessions(&app).await {
        Ok(records) => {
            let found = records.into_iter().find(|s| s.id == id);
            ok(found, trace)
        }
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("读取 sessions_data 失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
pub async fn save_ai_session(
    app: AppHandle,
    session: AiChatSessionCfg,
) -> ResultPayload<()> {
    let trace = new_trace_id();
    match read_all_sessions(&app).await {
        Ok(mut records) => {
            // Upsert: replace existing or append new
            if let Some(pos) = records.iter().position(|s| s.id == session.id) {
                records[pos] = session;
            } else {
                records.push(session);
            }
            match write_all_sessions(&app, &records).await {
                Ok(()) => ok((), trace),
                Err(err) => err_payload(
                    ErrorCode::IoError,
                    format!("写入 sessions_data 失败: {err}"),
                    trace,
                ),
            }
        }
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("读取 sessions_data 失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
pub async fn delete_ai_session(
    app: AppHandle,
    id: String,
) -> ResultPayload<()> {
    let trace = new_trace_id();
    match read_all_sessions(&app).await {
        Ok(mut records) => {
            records.retain(|s| s.id != id);
            match write_all_sessions(&app, &records).await {
                Ok(()) => ok((), trace),
                Err(err) => err_payload(
                    ErrorCode::IoError,
                    format!("写入 sessions_data 失败: {err}"),
                    trace,
                ),
            }
        }
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("读取 sessions_data 失败: {err}"),
            trace,
        ),
    }
}
