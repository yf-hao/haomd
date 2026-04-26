use crate::{
    err_payload, new_trace_id, ok, word::WordExportStyleSettingsCfg,
    word::WordExportStyleSettingsResolved, ErrorCode, ResultPayload,
};
use image::ImageFormat;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tokio::fs;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiCompressionCfg {
    #[serde(default)]
    pub min_messages_to_compress: Option<u32>,
    #[serde(default)]
    pub keep_recent_rounds: Option<u32>,
    #[serde(default)]
    pub max_messages_after_compress: Option<u32>,
    #[serde(default)]
    pub max_messages_per_summary_batch: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HugeDocCfg {
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub line_threshold: Option<u32>,
    #[serde(default)]
    pub chunk_context_lines: Option<u32>,
    #[serde(default)]
    pub chunk_max_lines: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiChatUiCfg {
    #[serde(default)]
    pub max_visible_messages_dialog: Option<u32>,
    #[serde(default)]
    pub max_visible_messages_pane: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ThemeEditorBackgroundCfg {
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub opacity: Option<f32>,
    #[serde(default)]
    pub overlay_opacity: Option<f32>,
    #[serde(default)]
    pub blur_px: Option<f32>,
    #[serde(default)]
    pub brightness: Option<f32>,
    #[serde(default)]
    pub size: Option<String>,
    #[serde(default)]
    pub position_x: Option<f32>,
    #[serde(default)]
    pub position_y: Option<f32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ThemeSettingsCfg {
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub custom_theme_id: Option<String>,
    #[serde(default)]
    pub workspace_background: Option<ThemeEditorBackgroundCfg>,
    #[serde(default)]
    pub workspace_background_include_sidebar: Option<bool>,
    #[serde(default)]
    pub editor_background: Option<ThemeEditorBackgroundCfg>,
    #[serde(default)]
    pub preview_background: Option<ThemeEditorBackgroundCfg>,
    #[serde(default)]
    pub ai_chat_background: Option<ThemeEditorBackgroundCfg>,
    #[serde(default)]
    pub sidebar_background: Option<ThemeEditorBackgroundCfg>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UiTypographySettingsCfg {
    #[serde(default)]
    pub app_font_size: Option<f32>,
    #[serde(default)]
    pub settings_font_size: Option<f32>,
    #[serde(default)]
    pub sidebar_font_size: Option<f32>,
    #[serde(default)]
    pub tab_bar_font_size: Option<f32>,
    #[serde(default)]
    pub status_bar_font_size: Option<f32>,
    #[serde(default)]
    pub editor_font_size: Option<f32>,
    #[serde(default)]
    pub preview_font_size: Option<f32>,
    #[serde(default)]
    pub ai_chat_message_font_size: Option<f32>,
    #[serde(default)]
    pub ai_chat_input_font_size: Option<f32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WebDavBackupSettingsCfg {
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub remote_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupSettingsCfg {
    #[serde(default)]
    pub webdav: Option<WebDavBackupSettingsCfg>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchSettingsCfg {
    #[serde(default)]
    pub parallel_scan_enabled: Option<bool>,
    #[serde(default)]
    pub parallel_scan_workers: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EditorSettingsCfg {
    #[serde(default)]
    pub ai_compression: Option<AiCompressionCfg>,
    #[serde(default)]
    pub huge_doc: Option<HugeDocCfg>,
    #[serde(default)]
    pub ai_chat: Option<AiChatUiCfg>,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub theme: Option<ThemeSettingsCfg>,
    #[serde(default)]
    pub ui_typography: Option<UiTypographySettingsCfg>,
    #[serde(default)]
    pub word_export: Option<WordExportStyleSettingsCfg>,
    #[serde(default)]
    pub backup: Option<BackupSettingsCfg>,
    #[serde(default)]
    pub search: Option<SearchSettingsCfg>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

pub fn default_editor_settings() -> EditorSettingsCfg {
    EditorSettingsCfg {
        ai_compression: Some(AiCompressionCfg {
            min_messages_to_compress: Some(80),
            keep_recent_rounds: Some(8),
            max_messages_after_compress: Some(200),
            max_messages_per_summary_batch: Some(200),
        }),
        huge_doc: Some(HugeDocCfg {
            enabled: Some(true),
            line_threshold: Some(1000),
            chunk_context_lines: Some(200),
            chunk_max_lines: Some(400),
        }),
        ai_chat: Some(AiChatUiCfg {
            max_visible_messages_dialog: Some(10),
            max_visible_messages_pane: Some(10),
        }),
        language: Some("system".to_string()),
        theme: Some(default_theme_settings_cfg()),
        ui_typography: Some(default_ui_typography_settings_cfg()),
        word_export: Some(default_word_export_style_settings_cfg()),
        backup: Some(BackupSettingsCfg {
            webdav: Some(WebDavBackupSettingsCfg {
                enabled: Some(false),
                url: Some(String::new()),
                username: Some(String::new()),
                password: Some(String::new()),
                remote_path: Some(String::new()),
            }),
        }),
        search: Some(SearchSettingsCfg {
            parallel_scan_enabled: Some(true),
            parallel_scan_workers: None,
        }),
        extra: HashMap::new(),
    }
}

pub fn default_theme_settings_cfg() -> ThemeSettingsCfg {
    ThemeSettingsCfg {
        mode: Some("system".to_string()),
        custom_theme_id: None,
        workspace_background: Some(ThemeEditorBackgroundCfg {
            enabled: Some(false),
            path: None,
            opacity: Some(0.22),
            overlay_opacity: Some(0.12),
            blur_px: Some(2.0),
            brightness: Some(100.0),
            size: Some("height-fill".to_string()),
            position_x: Some(50.0),
            position_y: Some(50.0),
        }),
        workspace_background_include_sidebar: Some(false),
        editor_background: Some(ThemeEditorBackgroundCfg {
            enabled: Some(false),
            path: None,
            opacity: Some(0.3),
            overlay_opacity: Some(0.0),
            blur_px: Some(1.0),
            brightness: Some(100.0),
            size: Some("height-fill".to_string()),
            position_x: Some(50.0),
            position_y: Some(50.0),
        }),
        preview_background: Some(ThemeEditorBackgroundCfg {
            enabled: Some(false),
            path: None,
            opacity: Some(0.22),
            overlay_opacity: Some(0.12),
            blur_px: Some(2.0),
            brightness: Some(100.0),
            size: Some("height-fill".to_string()),
            position_x: Some(50.0),
            position_y: Some(50.0),
        }),
        ai_chat_background: Some(ThemeEditorBackgroundCfg {
            enabled: Some(false),
            path: None,
            opacity: Some(0.3),
            overlay_opacity: Some(0.0),
            blur_px: Some(1.0),
            brightness: Some(100.0),
            size: Some("height-fill".to_string()),
            position_x: Some(50.0),
            position_y: Some(50.0),
        }),
        sidebar_background: Some(ThemeEditorBackgroundCfg {
            enabled: Some(false),
            path: None,
            opacity: Some(0.2),
            overlay_opacity: Some(0.16),
            blur_px: Some(2.0),
            brightness: Some(100.0),
            size: Some("height-fill".to_string()),
            position_x: Some(50.0),
            position_y: Some(50.0),
        }),
    }
}

pub fn default_ui_typography_settings_cfg() -> UiTypographySettingsCfg {
    UiTypographySettingsCfg {
        app_font_size: Some(13.0),
        settings_font_size: Some(13.0),
        sidebar_font_size: Some(13.0),
        tab_bar_font_size: Some(13.0),
        status_bar_font_size: Some(12.0),
        editor_font_size: Some(14.0),
        preview_font_size: Some(15.0),
        ai_chat_message_font_size: Some(13.0),
        ai_chat_input_font_size: Some(13.0),
    }
}

pub fn default_word_export_style_settings_cfg() -> WordExportStyleSettingsCfg {
    WordExportStyleSettingsCfg {
        body_font_family: Some("Times New Roman".to_string()),
        body_font_size_pt: Some(12.0),
        heading_font_family: Some("Calibri".to_string()),
        heading1_size_pt: Some(16.0),
        heading2_size_pt: Some(15.0),
        heading3_size_pt: Some(14.0),
        paragraph_spacing_after_pt: Some(8.0),
        line_spacing: Some(1.25),
        code_font_size_pt: Some(10.5),
        page_margin_cm: Some(2.54),
        enable_inkscape_for_word_export: Some(false),
        mermaid_export_format: Some("png".to_string()),
        inkscape_fallback: Some("ask".to_string()),
        selected_word_template_id: None,
    }
}

pub fn resolve_word_export_style_settings(
    cfg: Option<&WordExportStyleSettingsCfg>,
) -> WordExportStyleSettingsResolved {
    let default_cfg = default_word_export_style_settings_cfg();
    let cfg = cfg.cloned().unwrap_or(default_cfg.clone());
    let body_font_family = cfg
        .body_font_family
        .filter(|v| !v.trim().is_empty())
        .or(default_cfg.body_font_family)
        .unwrap_or_else(|| "Times New Roman".to_string());
    let heading_font_family = cfg
        .heading_font_family
        .filter(|v| !v.trim().is_empty())
        .or(default_cfg.heading_font_family)
        .unwrap_or_else(|| "Calibri".to_string());

    WordExportStyleSettingsResolved {
        body_font_family,
        body_font_size_half_points: pt_to_half_points(
            cfg.body_font_size_pt
                .or(default_cfg.body_font_size_pt)
                .unwrap_or(12.0),
        ),
        heading_font_family,
        heading1_size_half_points: pt_to_half_points(
            cfg.heading1_size_pt
                .or(default_cfg.heading1_size_pt)
                .unwrap_or(16.0),
        ),
        heading2_size_half_points: pt_to_half_points(
            cfg.heading2_size_pt
                .or(default_cfg.heading2_size_pt)
                .unwrap_or(14.0),
        ),
        heading3_size_half_points: pt_to_half_points(
            cfg.heading3_size_pt
                .or(default_cfg.heading3_size_pt)
                .unwrap_or(13.0),
        ),
        paragraph_spacing_after_twips: pt_to_twips(
            cfg.paragraph_spacing_after_pt
                .or(default_cfg.paragraph_spacing_after_pt)
                .unwrap_or(8.0),
        ),
        line_spacing_twips: line_spacing_to_twips(
            cfg.line_spacing
                .or(default_cfg.line_spacing)
                .unwrap_or(1.25),
        ),
        code_font_size_half_points: pt_to_half_points(
            cfg.code_font_size_pt
                .or(default_cfg.code_font_size_pt)
                .unwrap_or(10.0),
        ),
        page_margin_twips: cm_to_twips(
            cfg.page_margin_cm
                .or(default_cfg.page_margin_cm)
                .unwrap_or(2.54),
        ),
    }
}

pub(crate) fn pt_to_half_points(value: f32) -> u32 {
    (value.clamp(8.0, 48.0) * 2.0).round() as u32
}

pub(crate) fn pt_to_twips(value: f32) -> u32 {
    (value.clamp(0.0, 72.0) * 20.0).round() as u32
}

pub(crate) fn line_spacing_to_twips(value: f32) -> u32 {
    (value.clamp(1.0, 3.0) * 240.0).round() as u32
}

pub(crate) fn cm_to_twips(value: f32) -> u32 {
    ((value.clamp(1.0, 5.0) / 2.54) * 1440.0).round() as u32
}

pub fn editor_settings_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    if let Ok(mut dir) = app.path().config_dir() {
        dir.push("haomd");
        std::fs::create_dir_all(&dir)?;
        return Ok(dir.join("editor_settings.json"));
    }

    let dir = std::env::current_dir()?;
    Ok(dir.join("editor_settings.json"))
}

pub fn editor_backgrounds_dir(app: &AppHandle) -> std::io::Result<PathBuf> {
    if let Ok(mut dir) = app.path().config_dir() {
        dir.push("haomd");
        dir.push("editor-backgrounds");
        std::fs::create_dir_all(&dir)?;
        return Ok(dir);
    }

    let dir = std::env::current_dir()?.join("editor-backgrounds");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn should_cleanup_managed_editor_background(
    backgrounds_dir: &Path,
    previous_path: &Path,
    new_path: &Path,
) -> bool {
    if previous_path == new_path {
        return false;
    }
    previous_path.starts_with(backgrounds_dir) && previous_path.is_file()
}

pub(crate) fn clamp_image_to_long_edge(width: u32, height: u32, max_long_edge: u32) -> (u32, u32) {
    if width == 0 || height == 0 || max_long_edge == 0 {
        return (width.max(1), height.max(1));
    }

    let long_edge = width.max(height);
    if long_edge <= max_long_edge {
        return (width, height);
    }

    let scale = max_long_edge as f32 / long_edge as f32;
    let next_width = ((width as f32) * scale).round().max(1.0) as u32;
    let next_height = ((height as f32) * scale).round().max(1.0) as u32;
    (next_width, next_height)
}

fn sanitize_file_stem(input: &str) -> String {
    let sanitized: String = input
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect();
    let collapsed = sanitized.trim_matches('_').to_string();
    if collapsed.is_empty() {
        "background".to_string()
    } else {
        collapsed
    }
}

pub fn import_editor_background_image_sync(
    backgrounds_dir: &Path,
    source_path: &Path,
) -> Result<PathBuf, String> {
    let bytes = std::fs::read(source_path).map_err(|err| format!("读取图片失败: {err}"))?;
    let original = image::load_from_memory(&bytes).map_err(|err| format!("解析图片失败: {err}"))?;
    let (width, height) = (original.width(), original.height());
    let (target_width, target_height) = clamp_image_to_long_edge(width, height, 1080);
    let processed = if target_width == width && target_height == height {
        original
    } else {
        original.resize(
            target_width,
            target_height,
            image::imageops::FilterType::Lanczos3,
        )
    };

    let stem = source_path
        .file_stem()
        .and_then(|value| value.to_str())
        .map(sanitize_file_stem)
        .unwrap_or_else(|| "background".to_string());
    let digest = crate::hash_bytes(&bytes);
    let output_ext = source_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .map(|value| match value.as_str() {
            "jpeg" => "jpg".to_string(),
            "png" | "jpg" | "gif" | "bmp" | "webp" => value,
            _ => "png".to_string(),
        })
        .unwrap_or_else(|| "png".to_string());
    let output_format = match output_ext.as_str() {
        "png" => ImageFormat::Png,
        "jpg" => ImageFormat::Jpeg,
        "gif" => ImageFormat::Gif,
        "bmp" => ImageFormat::Bmp,
        "webp" => ImageFormat::WebP,
        _ => ImageFormat::Png,
    };
    let file_name = format!("{stem}-{}.{}", &digest[..12], output_ext);
    let output_path = backgrounds_dir.join(file_name);

    processed
        .save_with_format(&output_path, output_format)
        .map_err(|err| format!("保存导入图片失败: {err}"))?;

    Ok(output_path)
}

#[tauri::command]
async fn load_editor_settings_cfg(app: &AppHandle) -> Result<EditorSettingsCfg, String> {
    let path: PathBuf = match editor_settings_path(&app) {
        Ok(p) => p,
        Err(err) => return Err(format!("获取 editor_settings 路径失败: {err}")),
    };

    match fs::read(&path).await {
        Ok(bytes) => {
            let mut cfg: EditorSettingsCfg =
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
            if cfg.language.is_none() {
                cfg.language = default_cfg.language.clone();
                changed = true;
            }
            if cfg.theme.is_none() {
                cfg.theme = default_cfg.theme.clone();
                changed = true;
            }
            if cfg.ui_typography.is_none() {
                cfg.ui_typography = default_cfg.ui_typography.clone();
                changed = true;
            }
            if cfg.word_export.is_none() {
                cfg.word_export = default_cfg.word_export.clone();
                changed = true;
            }
            if cfg.search.is_none() {
                cfg.search = default_cfg.search.clone();
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

            if let Some(ref mut typography) = cfg.ui_typography {
                if let Some(ref default_typography) = default_cfg.ui_typography {
                    if typography.app_font_size.is_none() {
                        typography.app_font_size = default_typography.app_font_size;
                        changed = true;
                    }
                    if typography.settings_font_size.is_none() {
                        typography.settings_font_size = default_typography.settings_font_size;
                        changed = true;
                    }
                    if typography.sidebar_font_size.is_none() {
                        typography.sidebar_font_size = default_typography.sidebar_font_size;
                        changed = true;
                    }
                    if typography.tab_bar_font_size.is_none() {
                        typography.tab_bar_font_size = default_typography.tab_bar_font_size;
                        changed = true;
                    }
                    if typography.status_bar_font_size.is_none() {
                        typography.status_bar_font_size = default_typography.status_bar_font_size;
                        changed = true;
                    }
                    if typography.editor_font_size.is_none() {
                        typography.editor_font_size = default_typography.editor_font_size;
                        changed = true;
                    }
                    if typography.preview_font_size.is_none() {
                        typography.preview_font_size = default_typography.preview_font_size;
                        changed = true;
                    }
                    if typography.ai_chat_message_font_size.is_none() {
                        typography.ai_chat_message_font_size =
                            default_typography.ai_chat_message_font_size;
                        changed = true;
                    }
                    if typography.ai_chat_input_font_size.is_none() {
                        typography.ai_chat_input_font_size =
                            default_typography.ai_chat_input_font_size;
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
                    if theme.workspace_background.is_none() {
                        theme.workspace_background = default_theme.workspace_background.clone();
                        changed = true;
                    }
                    if theme.workspace_background_include_sidebar.is_none() {
                        theme.workspace_background_include_sidebar =
                            default_theme.workspace_background_include_sidebar;
                        changed = true;
                    }
                    if theme.editor_background.is_none() {
                        theme.editor_background = default_theme.editor_background.clone();
                        changed = true;
                    }
                    if theme.preview_background.is_none() {
                        theme.preview_background = default_theme.preview_background.clone();
                        changed = true;
                    }
                    if theme.ai_chat_background.is_none() {
                        theme.ai_chat_background = default_theme.ai_chat_background.clone();
                        changed = true;
                    }
                    if theme.sidebar_background.is_none() {
                        theme.sidebar_background = default_theme.sidebar_background.clone();
                        changed = true;
                    }
                }
            }

            if let Some(ref mut theme) = cfg.theme {
                if let Some(ref default_theme) = default_cfg.theme {
                    if let Some(ref mut workspace_background) = theme.workspace_background {
                        if let Some(ref default_workspace_background) =
                            default_theme.workspace_background
                        {
                            if workspace_background.enabled.is_none() {
                                workspace_background.enabled = default_workspace_background.enabled;
                                changed = true;
                            }
                            if workspace_background.path.is_none() {
                                workspace_background.path =
                                    default_workspace_background.path.clone();
                                changed = true;
                            }
                            if workspace_background.opacity.is_none() {
                                workspace_background.opacity = default_workspace_background.opacity;
                                changed = true;
                            }
                            if workspace_background.overlay_opacity.is_none() {
                                workspace_background.overlay_opacity =
                                    default_workspace_background.overlay_opacity;
                                changed = true;
                            }
                            if workspace_background.blur_px.is_none() {
                                workspace_background.blur_px = default_workspace_background.blur_px;
                                changed = true;
                            }
                            if workspace_background.brightness.is_none() {
                                workspace_background.brightness =
                                    default_workspace_background.brightness;
                                changed = true;
                            }
                            if workspace_background.size.is_none() {
                                workspace_background.size =
                                    default_workspace_background.size.clone();
                                changed = true;
                            }
                            if workspace_background.position_x.is_none() {
                                workspace_background.position_x =
                                    default_workspace_background.position_x;
                                changed = true;
                            }
                            if workspace_background.position_y.is_none() {
                                workspace_background.position_y =
                                    default_workspace_background.position_y;
                                changed = true;
                            }
                        }
                    }
                    if let Some(ref mut editor_background) = theme.editor_background {
                        if let Some(ref default_editor_background) = default_theme.editor_background
                        {
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
                    if let Some(ref mut preview_background) = theme.preview_background {
                        if let Some(ref default_preview_background) =
                            default_theme.preview_background
                        {
                            if preview_background.enabled.is_none() {
                                preview_background.enabled = default_preview_background.enabled;
                                changed = true;
                            }
                            if preview_background.path.is_none() {
                                preview_background.path = default_preview_background.path.clone();
                                changed = true;
                            }
                            if preview_background.opacity.is_none() {
                                preview_background.opacity = default_preview_background.opacity;
                                changed = true;
                            }
                            if preview_background.overlay_opacity.is_none() {
                                preview_background.overlay_opacity =
                                    default_preview_background.overlay_opacity;
                                changed = true;
                            }
                            if preview_background.blur_px.is_none() {
                                preview_background.blur_px = default_preview_background.blur_px;
                                changed = true;
                            }
                            if preview_background.brightness.is_none() {
                                preview_background.brightness =
                                    default_preview_background.brightness;
                                changed = true;
                            }
                            if preview_background.size.is_none() {
                                preview_background.size = default_preview_background.size.clone();
                                changed = true;
                            }
                            if preview_background.position_x.is_none() {
                                preview_background.position_x =
                                    default_preview_background.position_x;
                                changed = true;
                            }
                            if preview_background.position_y.is_none() {
                                preview_background.position_y =
                                    default_preview_background.position_y;
                                changed = true;
                            }
                        }
                    }
                    if let Some(ref mut ai_chat_background) = theme.ai_chat_background {
                        if let Some(ref default_ai_chat_background) =
                            default_theme.ai_chat_background
                        {
                            if ai_chat_background.enabled.is_none() {
                                ai_chat_background.enabled = default_ai_chat_background.enabled;
                                changed = true;
                            }
                            if ai_chat_background.path.is_none() {
                                ai_chat_background.path = default_ai_chat_background.path.clone();
                                changed = true;
                            }
                            if ai_chat_background.opacity.is_none() {
                                ai_chat_background.opacity = default_ai_chat_background.opacity;
                                changed = true;
                            }
                            if ai_chat_background.overlay_opacity.is_none() {
                                ai_chat_background.overlay_opacity =
                                    default_ai_chat_background.overlay_opacity;
                                changed = true;
                            }
                            if ai_chat_background.blur_px.is_none() {
                                ai_chat_background.blur_px = default_ai_chat_background.blur_px;
                                changed = true;
                            }
                            if ai_chat_background.brightness.is_none() {
                                ai_chat_background.brightness =
                                    default_ai_chat_background.brightness;
                                changed = true;
                            }
                            if ai_chat_background.size.is_none() {
                                ai_chat_background.size = default_ai_chat_background.size.clone();
                                changed = true;
                            }
                            if ai_chat_background.position_x.is_none() {
                                ai_chat_background.position_x =
                                    default_ai_chat_background.position_x;
                                changed = true;
                            }
                            if ai_chat_background.position_y.is_none() {
                                ai_chat_background.position_y =
                                    default_ai_chat_background.position_y;
                                changed = true;
                            }
                        }
                    }
                    if let Some(ref mut sidebar_background) = theme.sidebar_background {
                        if let Some(ref default_sidebar_background) =
                            default_theme.sidebar_background
                        {
                            if sidebar_background.enabled.is_none() {
                                sidebar_background.enabled = default_sidebar_background.enabled;
                                changed = true;
                            }
                            if sidebar_background.path.is_none() {
                                sidebar_background.path = default_sidebar_background.path.clone();
                                changed = true;
                            }
                            if sidebar_background.opacity.is_none() {
                                sidebar_background.opacity = default_sidebar_background.opacity;
                                changed = true;
                            }
                            if sidebar_background.overlay_opacity.is_none() {
                                sidebar_background.overlay_opacity =
                                    default_sidebar_background.overlay_opacity;
                                changed = true;
                            }
                            if sidebar_background.blur_px.is_none() {
                                sidebar_background.blur_px = default_sidebar_background.blur_px;
                                changed = true;
                            }
                            if sidebar_background.brightness.is_none() {
                                sidebar_background.brightness =
                                    default_sidebar_background.brightness;
                                changed = true;
                            }
                            if sidebar_background.size.is_none() {
                                sidebar_background.size = default_sidebar_background.size.clone();
                                changed = true;
                            }
                            if sidebar_background.position_x.is_none() {
                                sidebar_background.position_x =
                                    default_sidebar_background.position_x;
                                changed = true;
                            }
                            if sidebar_background.position_y.is_none() {
                                sidebar_background.position_y =
                                    default_sidebar_background.position_y;
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

            if let Some(ref mut search) = cfg.search {
                if let Some(ref default_search) = default_cfg.search {
                    if search.parallel_scan_enabled.is_none() {
                        search.parallel_scan_enabled = default_search.parallel_scan_enabled;
                        changed = true;
                    }
                    if search.parallel_scan_workers.is_none() {
                        search.parallel_scan_workers = default_search.parallel_scan_workers;
                        changed = true;
                    }
                }
            }

            if changed {
                if let Ok(bytes) = serde_json::to_vec_pretty(&cfg) {
                    let _ = fs::write(&path, bytes).await;
                }
            }

            Ok(cfg)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            let cfg = default_editor_settings();
            if let Ok(bytes) = serde_json::to_vec_pretty(&cfg) {
                let _ = fs::write(&path, bytes).await;
            }
            Ok(cfg)
        }
        Err(err) => Err(format!("读取 editor_settings 失败: {err}")),
    }
}

pub async fn load_search_settings_cfg(app: &AppHandle) -> SearchSettingsCfg {
    let default_cfg = default_editor_settings().search.unwrap_or(SearchSettingsCfg {
        parallel_scan_enabled: Some(true),
        parallel_scan_workers: None,
    });
    match load_editor_settings_cfg(app).await {
        Ok(cfg) => cfg.search.unwrap_or(default_cfg),
        Err(_) => default_cfg,
    }
}

#[tauri::command]
pub async fn load_editor_settings(app: AppHandle) -> ResultPayload<EditorSettingsCfg> {
    let trace = new_trace_id();
    match load_editor_settings_cfg(&app).await {
        Ok(cfg) => ok(cfg, trace),
        Err(message) => err_payload(
            ErrorCode::IoError,
            message,
            trace,
        ),
    }
}

#[tauri::command]
pub async fn save_editor_settings(app: AppHandle, cfg: EditorSettingsCfg) -> ResultPayload<()> {
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
        Ok(()) => {
            crate::refresh_app_menu(&app).await;
            ok((), trace)
        }
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("保存 editor_settings 失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
pub async fn pick_editor_background_image(
    app: AppHandle,
    current_path: Option<String>,
) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<String>>();
    let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));

    app.dialog()
        .file()
        .set_title("Choose Background Image")
        .add_filter("Images", &["png", "jpg", "jpeg", "webp", "gif", "bmp"])
        .pick_file(move |file_path| {
            let selected = file_path.and_then(|path| {
                path.as_path()
                    .map(|value| value.to_string_lossy().to_string())
            });
            if let Ok(mut guard) = tx.lock() {
                if let Some(sender) = guard.take() {
                    let _ = sender.send(selected);
                }
            }
        });

    let selected = rx
        .await
        .map_err(|err| format!("等待图片选择结果失败: {err}"))?;

    let Some(selected) = selected else {
        return Ok(None);
    };

    let backgrounds_dir =
        editor_backgrounds_dir(&app).map_err(|err| format!("创建背景图目录失败: {err}"))?;
    let source_path = PathBuf::from(selected);
    let previous_path = current_path
        .as_deref()
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty());
    let imported = tokio::task::spawn_blocking(move || {
        let imported = import_editor_background_image_sync(&backgrounds_dir, &source_path)?;
        if let Some(previous_path) = previous_path {
            if should_cleanup_managed_editor_background(&backgrounds_dir, &previous_path, &imported)
            {
                let _ = std::fs::remove_file(&previous_path);
            }
        }
        Ok::<PathBuf, String>(imported)
    })
    .await
    .map_err(|err| format!("导入背景图任务失败: {err}"))??;

    Ok(Some(imported.to_string_lossy().to_string()))
}
