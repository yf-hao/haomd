use crate::ai_sessions::AiChatMessageCfg;
use crate::haomd_paths::haomd_data_root_dir;
use crate::{err_payload, new_trace_id, ok, ErrorCode, ResultPayload};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::AppHandle;
use tokio::fs;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PdfChatSessionCfg {
    pub id: String,
    #[serde(default)]
    pub source_path: Option<String>,
    #[serde(default)]
    pub pdf_hash: Option<String>,
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

fn pdf_sessions_dir(app: &AppHandle) -> std::io::Result<PathBuf> {
    Ok(haomd_data_root_dir(app)?.join("pdf"))
}

fn pdf_sessions_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    Ok(pdf_sessions_dir(app)?.join("pdf_sessions.json"))
}

async fn read_pdf_sessions(app: &AppHandle) -> std::io::Result<Vec<PdfChatSessionCfg>> {
    let path = pdf_sessions_path(app)?;
    match fs::read(&path).await {
        Ok(bytes) => {
            Ok(serde_json::from_slice::<Vec<PdfChatSessionCfg>>(&bytes).unwrap_or_default())
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(err) => Err(err),
    }
}

async fn write_pdf_sessions(
    app: &AppHandle,
    sessions: &[PdfChatSessionCfg],
) -> std::io::Result<()> {
    let path = pdf_sessions_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    let bytes = serde_json::to_vec_pretty(sessions)?;
    fs::write(&path, bytes).await
}

#[tauri::command]
pub async fn load_pdf_sessions(app: AppHandle) -> ResultPayload<Vec<PdfChatSessionCfg>> {
    let trace = new_trace_id();
    match read_pdf_sessions(&app).await {
        Ok(sessions) => ok(sessions, trace),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("读取 pdf_sessions 失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
pub async fn load_pdf_session(
    app: AppHandle,
    id: String,
) -> ResultPayload<Option<PdfChatSessionCfg>> {
    let trace = new_trace_id();
    match read_pdf_sessions(&app).await {
        Ok(sessions) => ok(sessions.into_iter().find(|session| session.id == id), trace),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("读取 pdf_session 失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
pub async fn save_pdf_session(app: AppHandle, session: PdfChatSessionCfg) -> ResultPayload<()> {
    let trace = new_trace_id();
    match read_pdf_sessions(&app).await {
        Ok(mut sessions) => {
            if let Some(pos) = sessions.iter().position(|item| item.id == session.id) {
                sessions[pos] = session;
            } else {
                sessions.push(session);
            }

            match write_pdf_sessions(&app, &sessions).await {
                Ok(()) => ok((), trace),
                Err(err) => err_payload(
                    ErrorCode::IoError,
                    format!("写入 pdf_sessions 失败: {err}"),
                    trace,
                ),
            }
        }
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("读取 pdf_sessions 失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
pub async fn delete_pdf_session(app: AppHandle, id: String) -> ResultPayload<()> {
    let trace = new_trace_id();
    match read_pdf_sessions(&app).await {
        Ok(mut sessions) => {
            let before = sessions.len();
            sessions.retain(|session| session.id != id);
            if sessions.len() == before {
                return ok((), trace);
            }

            match write_pdf_sessions(&app, &sessions).await {
                Ok(()) => ok((), trace),
                Err(err) => err_payload(
                    ErrorCode::IoError,
                    format!("删除 pdf_session 失败: {err}"),
                    trace,
                ),
            }
        }
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("读取 pdf_sessions 失败: {err}"),
            trace,
        ),
    }
}
