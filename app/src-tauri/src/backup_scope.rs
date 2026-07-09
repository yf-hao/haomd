use crate::haomd_paths::haomd_config_file;
use crate::webdav_change_tracker::WebDavChangeTracker;
use crate::{err_payload, new_trace_id, ok, ErrorCode, ResultPayload};
use serde::{Deserialize, Deserializer, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tokio::fs;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct BackupDocumentsScopeCfg {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub selected_roots: Vec<String>,
    #[serde(skip)]
    pub legacy_all_roots: bool,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum BackupDocumentsScopeInput {
    Detailed(BackupDocumentsScopeCfg),
    Legacy(bool),
}

fn deserialize_documents_scope<'de, D>(deserializer: D) -> Result<BackupDocumentsScopeCfg, D::Error>
where
    D: Deserializer<'de>,
{
    let input = BackupDocumentsScopeInput::deserialize(deserializer)?;
    Ok(match input {
        BackupDocumentsScopeInput::Detailed(cfg) => cfg,
        BackupDocumentsScopeInput::Legacy(enabled) => BackupDocumentsScopeCfg {
            enabled,
            selected_roots: Vec::new(),
            legacy_all_roots: enabled,
        },
    })
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct BackupScopeSettingsCfg {
    #[serde(default)]
    pub music: bool,
    #[serde(default, deserialize_with = "deserialize_documents_scope")]
    pub documents: BackupDocumentsScopeCfg,
    #[serde(default)]
    pub alarm: bool,
    #[serde(default)]
    pub notes: bool,
}

fn backup_scope_settings_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    haomd_config_file(app, ".backup_scope.json")
}

pub fn default_backup_scope_settings() -> BackupScopeSettingsCfg {
    BackupScopeSettingsCfg::default()
}

pub async fn load_backup_scope_settings_cfg(
    app: &AppHandle,
) -> Result<BackupScopeSettingsCfg, String> {
    let path = backup_scope_settings_path(app)
        .map_err(|err| format!("获取 backup_scope 路径失败: {err}"))?;
    match fs::read_to_string(&path).await {
        Ok(content) => {
            serde_json::from_str(&content).map_err(|err| format!("解析 backup_scope 失败: {err}"))
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            Ok(default_backup_scope_settings())
        }
        Err(err) => Err(format!("读取 backup_scope 失败: {err}")),
    }
}

pub async fn save_backup_scope_settings_cfg(
    app: &AppHandle,
    cfg: &BackupScopeSettingsCfg,
) -> Result<(), String> {
    if cfg.documents.enabled
        && !cfg.documents.legacy_all_roots
        && !cfg
            .documents
            .selected_roots
            .iter()
            .any(|root| !root.trim().is_empty())
    {
        return Err("请选择至少一个 Documents 目录".to_string());
    }

    let path = backup_scope_settings_path(app)
        .map_err(|err| format!("获取 backup_scope 路径失败: {err}"))?;
    let json = serde_json::to_string_pretty(cfg)
        .map_err(|err| format!("序列化 backup_scope 失败: {err}"))?;
    fs::write(&path, json)
        .await
        .map_err(|err| format!("写入 backup_scope 失败: {err}"))
}

#[tauri::command]
pub async fn load_backup_scope_settings(app: AppHandle) -> ResultPayload<BackupScopeSettingsCfg> {
    let trace = new_trace_id();
    match load_backup_scope_settings_cfg(&app).await {
        Ok(cfg) => ok(cfg, trace),
        Err(message) => err_payload(ErrorCode::IoError, message, trace),
    }
}

#[tauri::command]
pub async fn save_backup_scope_settings(
    app: AppHandle,
    cfg: BackupScopeSettingsCfg,
) -> ResultPayload<()> {
    let trace = new_trace_id();
    match save_backup_scope_settings_cfg(&app, &cfg).await {
        Ok(()) => {
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
        Err(message) => err_payload(ErrorCode::IoError, message, trace),
    }
}
