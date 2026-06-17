use crate::haomd_paths::haomd_config_file;
use crate::{err_payload, new_trace_id, ok, ErrorCode, ResultPayload};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::AppHandle;
use tokio::fs;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct BackupScopeSettingsCfg {
    #[serde(default)]
    pub music: bool,
    #[serde(default)]
    pub documents: bool,
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
        Ok(()) => ok((), trace),
        Err(message) => err_payload(ErrorCode::IoError, message, trace),
    }
}
