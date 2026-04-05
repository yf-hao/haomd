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

// ─── Naming conversation record ─────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiNamingConvCfg {
    /// Map of provider_id → Dify conversation_id used for session titling
    #[serde(default)]
    pub conv_ids: std::collections::HashMap<String, String>,
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

fn naming_conv_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    if let Ok(mut dir) = app.path().config_dir() {
        dir.push("haomd");
        std::fs::create_dir_all(&dir)?;
        Ok(dir.join("ai-naming-conv.json"))
    } else {
        Ok(std::env::current_dir()?.join("ai-naming-conv.json"))
    }
}

fn sessions_index_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    let mut dir = ai_sessions_dir(app)?;
    dir.push("sessions_index.json");
    Ok(dir)
}

fn session_file_name(id: &str) -> String {
    let hex = id
        .as_bytes()
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect::<String>();
    format!("{hex}.json")
}

fn session_data_path(app: &AppHandle, id: &str) -> std::io::Result<PathBuf> {
    let mut dir = ai_sessions_dir(app)?;
    dir.push(session_file_name(id));
    Ok(dir)
}

// ─── Internal read / write helpers ──────────────────────────────────

async fn read_session_index(app: &AppHandle) -> std::io::Result<Vec<AiChatSessionIndexEntry>> {
    let path = sessions_index_path(app)?;
    match fs::read(&path).await {
        Ok(bytes) => {
            let entries: Vec<AiChatSessionIndexEntry> =
                serde_json::from_slice(&bytes).unwrap_or_default();
            Ok(entries)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(err) => Err(err),
    }
}

async fn write_session_index(
    app: &AppHandle,
    entries: &[AiChatSessionIndexEntry],
) -> std::io::Result<()> {
    let index_path = sessions_index_path(app)?;
    let index_bytes = serde_json::to_vec_pretty(entries)?;
    fs::write(&index_path, index_bytes).await?;
    Ok(())
}

async fn read_session(app: &AppHandle, id: &str) -> std::io::Result<Option<AiChatSessionCfg>> {
    let path = session_data_path(app, id)?;
    match fs::read(&path).await {
        Ok(bytes) => {
            let session: AiChatSessionCfg =
                serde_json::from_slice(&bytes).unwrap_or(AiChatSessionCfg {
                    id: id.to_string(),
                    title: None,
                    entry_mode: None,
                    messages: vec![],
                    provider_type: None,
                    active_role_id: None,
                    created_at: 0,
                    updated_at: 0,
                });
            Ok(Some(session))
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err),
    }
}

async fn write_session(app: &AppHandle, session: &AiChatSessionCfg) -> std::io::Result<()> {
    let path = session_data_path(app, &session.id)?;
    let bytes = serde_json::to_vec_pretty(session)?;
    fs::write(&path, bytes).await?;
    Ok(())
}

// ─── Tauri commands ─────────────────────────────────────────────────

#[tauri::command]
pub async fn load_ai_sessions_index(app: AppHandle) -> ResultPayload<Vec<AiChatSessionIndexEntry>> {
    let trace = new_trace_id();
    match read_session_index(&app).await {
        Ok(entries) => ok(entries, trace),
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
    match read_session(&app, &id).await {
        Ok(found) => ok(found, trace),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("读取 session 失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
pub async fn save_ai_session(app: AppHandle, session: AiChatSessionCfg) -> ResultPayload<()> {
    let trace = new_trace_id();
    match write_session(&app, &session).await {
        Ok(()) => match read_session_index(&app).await {
            Ok(mut entries) => {
                let next_entry = AiChatSessionIndexEntry {
                    id: session.id.clone(),
                    title: session.title.clone(),
                    message_count: session.messages.len(),
                    created_at: session.created_at,
                    updated_at: session.updated_at,
                };

                if let Some(pos) = entries.iter().position(|s| s.id == session.id) {
                    entries[pos] = next_entry;
                } else {
                    entries.push(next_entry);
                }

                match write_session_index(&app, &entries).await {
                    Ok(()) => ok((), trace),
                    Err(err) => err_payload(
                        ErrorCode::IoError,
                        format!("写入 sessions_index 失败: {err}"),
                        trace,
                    ),
                }
            }
            Err(err) => err_payload(
                ErrorCode::IoError,
                format!("读取 sessions_index 失败: {err}"),
                trace,
            ),
        },
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("写入 session 失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
pub async fn delete_ai_session(app: AppHandle, id: String) -> ResultPayload<()> {
    let trace = new_trace_id();
    let session_path = match session_data_path(&app, &id) {
        Ok(path) => path,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取 session 路径失败: {err}"),
                trace,
            );
        }
    };

    let remove_result = fs::remove_file(&session_path).await;
    if let Err(err) = remove_result {
        if err.kind() != std::io::ErrorKind::NotFound {
            return err_payload(
                ErrorCode::IoError,
                format!("删除 session 文件失败: {err}"),
                trace,
            );
        }
    }

    match read_session_index(&app).await {
        Ok(mut entries) => {
            entries.retain(|s| s.id != id);
            match write_session_index(&app, &entries).await {
                Ok(()) => ok((), trace),
                Err(err) => err_payload(
                    ErrorCode::IoError,
                    format!("写入 sessions_index 失败: {err}"),
                    trace,
                ),
            }
        }
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("读取 sessions_index 失败: {err}"),
            trace,
        ),
    }
}

// ─── Naming conversation persistence ────────────────────────────────

#[tauri::command]
pub async fn load_ai_naming_conv(app: AppHandle) -> ResultPayload<AiNamingConvCfg> {
    let trace = new_trace_id();
    let path = match naming_conv_path(&app) {
        Ok(p) => p,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取 naming_conv 路径失败: {err}"),
                trace,
            );
        }
    };
    match fs::read(&path).await {
        Ok(bytes) => {
            let cfg: AiNamingConvCfg = serde_json::from_slice(&bytes).unwrap_or_default();
            ok(cfg, trace)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            ok(AiNamingConvCfg::default(), trace)
        }
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("读取 naming_conv 失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
pub async fn save_ai_naming_conv(app: AppHandle, cfg: AiNamingConvCfg) -> ResultPayload<()> {
    let trace = new_trace_id();
    let path = match naming_conv_path(&app) {
        Ok(p) => p,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取 naming_conv 路径失败: {err}"),
                trace,
            );
        }
    };
    match serde_json::to_vec_pretty(&cfg) {
        Ok(bytes) => match fs::write(&path, bytes).await {
            Ok(()) => ok((), trace),
            Err(err) => err_payload(
                ErrorCode::IoError,
                format!("写入 naming_conv 失败: {err}"),
                trace,
            ),
        },
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("序列化 naming_conv 失败: {err}"),
            trace,
        ),
    }
}
