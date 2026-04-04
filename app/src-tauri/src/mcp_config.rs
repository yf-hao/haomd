use crate::{err_payload, new_trace_id, ok, ErrorCode, ResultPayload};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tokio::fs;

// ─── Data structures ────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct McpGroupCfg {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub order: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct McpServerCfg {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub group_id: Option<String>,
    #[serde(default)]
    pub enabled: bool,
    /// "stdio" | "sse" | "streamable-http"
    pub transport: String,
    // stdio fields
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Option<Vec<String>>,
    #[serde(default)]
    pub env: Option<HashMap<String, String>>,
    // sse fields
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub headers: Option<HashMap<String, String>>,
    #[serde(default)]
    pub order: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpSettingsCfg {
    #[serde(default)]
    pub groups: Vec<McpGroupCfg>,
    #[serde(default)]
    pub servers: Vec<McpServerCfg>,
}

// ─── File path ──────────────────────────────────────────────────────

pub(crate) fn mcp_settings_path_pub(app: &AppHandle) -> std::io::Result<PathBuf> {
    mcp_settings_path(app)
}

fn mcp_settings_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    if let Ok(mut dir) = app.path().config_dir() {
        dir.push("haomd");
        std::fs::create_dir_all(&dir)?;
        return Ok(dir.join("mcp_settings.json"));
    }
    let dir = std::env::current_dir()?;
    Ok(dir.join("mcp_settings.json"))
}

// ─── Tauri commands ─────────────────────────────────────────────────

#[tauri::command]
pub async fn load_mcp_settings(app: AppHandle) -> ResultPayload<McpSettingsCfg> {
    let trace = new_trace_id();
    let path = match mcp_settings_path(&app) {
        Ok(p) => p,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取 mcp_settings 路径失败: {err}"),
                trace,
            );
        }
    };

    match fs::read(&path).await {
        Ok(bytes) => {
            let cfg: McpSettingsCfg =
                serde_json::from_slice(&bytes).unwrap_or_default();
            ok(cfg, trace)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            ok(McpSettingsCfg::default(), trace)
        }
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("读取 mcp_settings 失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
pub async fn save_mcp_settings(app: AppHandle, cfg: McpSettingsCfg) -> ResultPayload<()> {
    let trace = new_trace_id();
    let path = match mcp_settings_path(&app) {
        Ok(p) => p,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取 mcp_settings 路径失败: {err}"),
                trace,
            );
        }
    };

    let bytes = match serde_json::to_vec_pretty(&cfg) {
        Ok(b) => b,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("序列化 mcp_settings 失败: {err}"),
                trace,
            );
        }
    };

    match fs::write(&path, bytes).await {
        Ok(()) => ok((), trace),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("写入 mcp_settings 失败: {err}"),
            trace,
        ),
    }
}
