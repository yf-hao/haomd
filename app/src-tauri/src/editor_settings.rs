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
      let mut cfg: crate::EditorSettingsCfg =
        serde_json::from_slice(&bytes).unwrap_or_else(|_| default_editor_settings());
      let default_cfg = default_editor_settings();
      let mut changed = false;

      if cfg.ai_compression.is_none() {
        cfg.ai_compression = default_cfg.ai_compression.clone();
        changed = true;
      }
      if cfg.huge_doc.is_none() {
        cfg.huge_doc = default_cfg.huge_doc.clone();
        changed = true;
      }

      // 为 huge_doc 填充新增字段的默认值，避免写回时丢失
      if let Some(ref mut huge) = cfg.huge_doc {
        if let Some(ref default_huge) = default_cfg.huge_doc {
          if huge.enabled.is_none() {
            huge.enabled = default_huge.enabled;
            changed = true;
          }
          if huge.line_threshold.is_none() {
            huge.line_threshold = default_huge.line_threshold;
            changed = true;
          }
          if huge.chunk_context_lines.is_none() {
            huge.chunk_context_lines = default_huge.chunk_context_lines;
            changed = true;
          }
          if huge.chunk_max_lines.is_none() {
            huge.chunk_max_lines = default_huge.chunk_max_lines;
            changed = true;
          }
        }
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
