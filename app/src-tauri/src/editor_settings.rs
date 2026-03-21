use crate::{
    default_editor_settings, editor_settings_path, err_payload, new_trace_id, ok, ErrorCode,
    ResultPayload,
};
use std::path::PathBuf;
use tauri::AppHandle;
use tokio::fs;

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
            if cfg.ai_chat.is_none() {
                cfg.ai_chat = default_cfg.ai_chat.clone();
                changed = true;
            }
            if cfg.theme.is_none() {
                cfg.theme = default_cfg.theme.clone();
                changed = true;
            }
            if cfg.word_export.is_none() {
                cfg.word_export = default_cfg.word_export.clone();
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

            // 为 ai_chat 填充新增字段的默认值，避免写回时丢失
            if let Some(ref mut chat) = cfg.ai_chat {
                if let Some(ref default_chat) = default_cfg.ai_chat {
                    if chat.max_visible_messages_dialog.is_none() {
                        chat.max_visible_messages_dialog = default_chat.max_visible_messages_dialog;
                        changed = true;
                    }
                    if chat.max_visible_messages_pane.is_none() {
                        chat.max_visible_messages_pane = default_chat.max_visible_messages_pane;
                        changed = true;
                    }
                }
            }

            if let Some(ref mut theme) = cfg.theme {
                if let Some(ref default_theme) = default_cfg.theme {
                    if theme.mode.is_none() {
                        theme.mode = default_theme.mode.clone();
                        changed = true;
                    }
                    if theme.custom_theme_id.is_none() {
                        theme.custom_theme_id = default_theme.custom_theme_id.clone();
                        changed = true;
                    }
                    if theme.editor_background.is_none() {
                        theme.editor_background = default_theme.editor_background.clone();
                        changed = true;
                    }
                }
            }

            if let Some(ref mut theme) = cfg.theme {
                if let Some(ref default_theme) = default_cfg.theme {
                    if let Some(ref mut editor_background) = theme.editor_background {
                        if let Some(ref default_editor_background) = default_theme.editor_background {
                            if editor_background.enabled.is_none() {
                                editor_background.enabled = default_editor_background.enabled;
                                changed = true;
                            }
                            if editor_background.path.is_none() {
                                editor_background.path = default_editor_background.path.clone();
                                changed = true;
                            }
                            if editor_background.opacity.is_none() {
                                editor_background.opacity = default_editor_background.opacity;
                                changed = true;
                            }
                            if editor_background.overlay_opacity.is_none() {
                                editor_background.overlay_opacity =
                                    default_editor_background.overlay_opacity;
                                changed = true;
                            }
                            if editor_background.blur_px.is_none() {
                                editor_background.blur_px = default_editor_background.blur_px;
                                changed = true;
                            }
                            if editor_background.brightness.is_none() {
                                editor_background.brightness = default_editor_background.brightness;
                                changed = true;
                            }
                            if editor_background.size.is_none() {
                                editor_background.size = default_editor_background.size.clone();
                                changed = true;
                            }
                            if editor_background.position_x.is_none() {
                                editor_background.position_x = default_editor_background.position_x;
                                changed = true;
                            }
                            if editor_background.position_y.is_none() {
                                editor_background.position_y = default_editor_background.position_y;
                                changed = true;
                            }
                        }
                    }
                }
            }

            // 为 word_export 填充新增字段的默认值，避免写回时丢失
            if let Some(ref mut word_export) = cfg.word_export {
                if let Some(ref default_word_export) = default_cfg.word_export {
                    if word_export.body_font_family.is_none() {
                        word_export.body_font_family = default_word_export.body_font_family.clone();
                        changed = true;
                    }
                    if word_export.body_font_size_pt.is_none() {
                        word_export.body_font_size_pt = default_word_export.body_font_size_pt;
                        changed = true;
                    }
                    if word_export.heading_font_family.is_none() {
                        word_export.heading_font_family =
                            default_word_export.heading_font_family.clone();
                        changed = true;
                    }
                    if word_export.heading1_size_pt.is_none() {
                        word_export.heading1_size_pt = default_word_export.heading1_size_pt;
                        changed = true;
                    }
                    if word_export.heading2_size_pt.is_none() {
                        word_export.heading2_size_pt = default_word_export.heading2_size_pt;
                        changed = true;
                    }
                    if word_export.heading3_size_pt.is_none() {
                        word_export.heading3_size_pt = default_word_export.heading3_size_pt;
                        changed = true;
                    }
                    if word_export.paragraph_spacing_after_pt.is_none() {
                        word_export.paragraph_spacing_after_pt =
                            default_word_export.paragraph_spacing_after_pt;
                        changed = true;
                    }
                    if word_export.line_spacing.is_none() {
                        word_export.line_spacing = default_word_export.line_spacing;
                        changed = true;
                    }
                    if word_export.code_font_size_pt.is_none() {
                        word_export.code_font_size_pt = default_word_export.code_font_size_pt;
                        changed = true;
                    }
                    if word_export.page_margin_cm.is_none() {
                        word_export.page_margin_cm = default_word_export.page_margin_cm;
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

#[tauri::command]
pub async fn save_editor_settings(
    app: AppHandle,
    cfg: crate::EditorSettingsCfg,
) -> ResultPayload<()> {
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

    let bytes = match serde_json::to_vec_pretty(&cfg) {
        Ok(v) => v,
        Err(err) => {
            return err_payload(
                ErrorCode::UNKNOWN,
                format!("序列化 editor_settings 失败: {err}"),
                trace,
            );
        }
    };

    match fs::write(&path, bytes).await {
        Ok(()) => ok((), trace),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("保存 editor_settings 失败: {err}"),
            trace,
        ),
    }
}
