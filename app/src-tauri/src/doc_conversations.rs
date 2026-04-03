use crate::{err_payload, new_trace_id, ok, ErrorCode, ResultPayload};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tokio::fs;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DocConversationMessageMetaCfg {
    #[serde(default)]
    pub provider_type: Option<String>,
    #[serde(default)]
    pub model_name: Option<String>,
    #[serde(default)]
    pub has_image: Option<bool>,
    #[serde(default)]
    pub tokens_used: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DocConversationMessageCfg {
    pub id: String,
    pub doc_path: String,
    pub timestamp: i64,
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub meta: Option<DocConversationMessageMetaCfg>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DocConversationRecordCfg {
    pub doc_path: String,
    pub session_id: String,
    pub last_active_at: i64,
    #[serde(default)]
    pub dify_conversation_id: Option<String>,
    #[serde(default)]
    pub dify_provider_conversations: Option<HashMap<String, String>>,
    #[serde(default)]
    pub messages: Vec<DocConversationMessageCfg>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConversationIndexEntryCfg {
    pub doc_path: String,
    pub session_id: String,
    pub last_active_at: i64,
    pub has_dify_conversation: bool,
    pub message_count: usize,
}

fn ai_conversations_dir(app: &AppHandle) -> std::io::Result<PathBuf> {
    if let Ok(mut dir) = app.path().config_dir() {
        dir.push("haomd");
        dir.push("ai-conversations");
        std::fs::create_dir_all(&dir)?;
        Ok(dir)
    } else {
        let mut dir = std::env::current_dir()?;
        dir.push("ai-conversations");
        std::fs::create_dir_all(&dir)?;
        Ok(dir)
    }
}

fn ai_conversations_data_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    let mut dir = ai_conversations_dir(app)?;
    dir.push("conversations_data.json");
    Ok(dir)
}

fn ai_conversations_index_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    let mut dir = ai_conversations_dir(app)?;
    dir.push("conversations_index.json");
    Ok(dir)
}

async fn read_doc_conversations(app: &AppHandle) -> std::io::Result<Vec<DocConversationRecordCfg>> {
    let path = ai_conversations_data_path(app)?;
    match fs::read(&path).await {
        Ok(bytes) => {
            let records: Vec<DocConversationRecordCfg> =
                serde_json::from_slice(&bytes).unwrap_or_default();
            Ok(records)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(err) => Err(err),
    }
}

async fn write_doc_conversations(
    app: &AppHandle,
    records: &[DocConversationRecordCfg],
) -> std::io::Result<()> {
    let data_path = ai_conversations_data_path(app)?;
    let data_bytes = serde_json::to_vec_pretty(records)?;
    fs::write(&data_path, data_bytes).await?;

    let index_entries: Vec<ConversationIndexEntryCfg> = records
        .iter()
        .map(|rec| ConversationIndexEntryCfg {
            doc_path: rec.doc_path.clone(),
            session_id: rec.session_id.clone(),
            last_active_at: rec.last_active_at,
            has_dify_conversation: rec
                .dify_conversation_id
                .as_ref()
                .map(|s| !s.is_empty())
                .unwrap_or(false)
                || rec
                    .dify_provider_conversations
                    .as_ref()
                    .map(|m| !m.is_empty())
                    .unwrap_or(false),
            message_count: rec.messages.len(),
        })
        .collect();

    let index_path = ai_conversations_index_path(app)?;
    let index_bytes = serde_json::to_vec_pretty(&index_entries)?;
    fs::write(&index_path, index_bytes).await?;

    Ok(())
}

#[tauri::command]
pub async fn load_doc_conversations(
    app: AppHandle,
) -> ResultPayload<Vec<DocConversationRecordCfg>> {
    let trace = new_trace_id();
    match read_doc_conversations(&app).await {
        Ok(records) => ok(records, trace),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("读取 conversations_data 失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
pub async fn save_doc_conversations(
    app: AppHandle,
    records: Vec<DocConversationRecordCfg>,
) -> ResultPayload<()> {
    let trace = new_trace_id();
    match write_doc_conversations(&app, &records).await {
        Ok(()) => ok((), trace),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("写入 conversations_data 失败: {err}"),
            trace,
        ),
    }
}
