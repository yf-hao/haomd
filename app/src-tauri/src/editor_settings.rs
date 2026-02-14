use tokio::fs;
use std::path::PathBuf;
use crate::{editor_settings_path, default_editor_settings, ResultPayload, ErrorCode, new_trace_id, ok, err_payload};
use tauri::AppHandle;

#[tauri::command]
pub async fn load_editor_settings(app: AppHandle) -> ResultPayload<crate::EditorSettingsCfg> {
  let trace = new_trace_id();
  let path: PathBuf = match editor_settings_path(&app) {
    Ok(p) => p,
    Err(err) => {
      return err_payload(
        ErrorCode::IoError,
        format!("获取 editor_settings 路径失败: {err}"),
        trace,
      );
    }
  };

  match fs::read(&path).await {
    Ok(bytes) => {
      let mut cfg: crate::EditorSettingsCfg = serde_json::from_slice(&bytes).unwrap_or_else(|_| default_editor_settings());
      let mut changed = false;
      if cfg.ai_compression.is_none() {
        cfg.ai_compression = default_editor_settings().ai_compression;
        changed = true;
      }
      if changed {
        if let Ok(bytes) = serde_json::to_vec_pretty(&cfg) {
          let _ = fs::write(&path, bytes).await;
        }
      }
      ok(cfg, trace)
    }
    Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
      let cfg = default_editor_settings();
      if let Ok(bytes) = serde_json::to_vec_pretty(&cfg) {
        let _ = fs::write(&path, bytes).await;
      }
      ok(cfg, trace)
    }
    Err(err) => err_payload(
      ErrorCode::IoError,
      format!("读取 editor_settings 失败: {err}"),
      trace,
    ),
  }
}
