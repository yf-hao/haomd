use std::collections::HashMap;
use std::io::Cursor;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

mod editor_settings;
mod font_catalog;
mod fs_types;

use arboard::Clipboard;
use chrono::Local;
use fs_types::{ErrorCode, FilePayload, RecentFile, ResultPayload, ServiceError, WriteResult};
use image::{DynamicImage, ImageBuffer, ImageFormat, Rgba};
use log::info;
use once_cell::sync::Lazy;
use percent_encoding::percent_decode_str;
use quick_xml::events::Event;
use quick_xml::Reader;
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::http::{Request, Response};
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, UriSchemeContext};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tokio::fs;
use tokio::sync::Mutex;
use zip::write::SimpleFileOptions;
use zip::CompressionMethod;
use zip::ZipWriter;

#[cfg(target_os = "macos")]
use tauri::RunEvent;
#[cfg(target_os = "macos")]
use url::Url;

const MAX_FILE_BYTES: u64 = 500 * 1024 * 1024; // 500MB
const MAX_RECENT_ITEMS: usize = 100; // 最近文件最大条数
const RECENT_PAGE_SIZE: usize = 20; // Open Recent 子菜单每页显示条数

static FILE_LOCKS: Lazy<Mutex<HashMap<String, std::sync::Arc<Mutex<()>>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

// 最近文件原生菜单映射：菜单项 id -> 文件路径
static RECENT_MENU_MAP: Lazy<std::sync::Mutex<HashMap<String, RecentMenuPayload>>> =
    Lazy::new(|| std::sync::Mutex::new(HashMap::new()));

// 最近文件分页状态：当前页（从 0 开始）
static RECENT_PAGE: Lazy<std::sync::Mutex<u32>> = Lazy::new(|| std::sync::Mutex::new(0));
static PENDING_EXTERNAL_OPEN_ITEMS: Lazy<std::sync::Mutex<Vec<ExternalOpenItem>>> =
    Lazy::new(|| std::sync::Mutex::new(Vec::new()));

const RECENT_MENU_PREFIX: &str = "recent_item_";

fn new_trace_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    format!("trace_{}", nanos)
}

fn left_aligned_math_paragraph_style() -> WordParagraphStyleCfg {
    WordParagraphStyleCfg {
        align: Some("left".to_string()),
        line_height: None,
        spacing_after_pt: None,
        background_color: None,
        border_color: None,
        border_top_color: None,
        border_right_color: None,
        border_bottom_color: None,
        border_left_color: None,
    }
}

fn service_error(
    code: ErrorCode,
    message: impl Into<String>,
    trace_id: Option<String>,
) -> ServiceError {
    ServiceError {
        code,
        message: message.into(),
        trace_id,
    }
}

fn ok<T>(data: T, trace_id: String) -> ResultPayload<T> {
    ResultPayload::Ok {
        data,
        trace_id: Some(trace_id),
    }
}

fn err_payload<T>(
    code: ErrorCode,
    message: impl Into<String>,
    trace_id: String,
) -> ResultPayload<T> {
    ResultPayload::Err {
        error: service_error(code, message, Some(trace_id)),
    }
}

fn normalize_path(input: &str) -> Result<PathBuf, ServiceError> {
    if input.trim().is_empty() {
        return Err(service_error(ErrorCode::InvalidPath, "路径不能为空", None));
    }

    let mut path = PathBuf::from(input);
    if path.is_relative() {
        let cwd = std::env::current_dir().map_err(|e| {
            service_error(ErrorCode::IoError, format!("获取当前目录失败: {e}"), None)
        })?;
        path = cwd.join(path);
    }

    let mut normalized = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::ParentDir => {
                normalized.pop();
            }
            Component::CurDir => {}
            Component::Prefix(_) | Component::RootDir => normalized.push(comp),
            Component::Normal(c) => normalized.push(c),
        }
    }

    if normalized.components().next().is_none() {
        return Err(service_error(ErrorCode::InvalidPath, "路径非法", None));
    }

    Ok(normalized)
}

async fn file_lock(path: &Path) -> std::sync::Arc<Mutex<()>> {
    let key = path.to_string_lossy().to_string();
    let mut map = FILE_LOCKS.lock().await;
    map.entry(key)
        .or_insert_with(|| std::sync::Arc::new(Mutex::new(())))
        .clone()
}

fn hash_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn mtime_ms(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn recent_store_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    // 优先使用应用配置目录，避免落在 src-tauri 下被 dev 进程当作源码变更
    if let Ok(mut dir) = app.path().config_dir() {
        dir.push("haomd");
        std::fs::create_dir_all(&dir)?;
        return Ok(dir.join("recent.json"));
    }

    // 兜底：退回到当前工作目录
    let dir = std::env::current_dir()?;
    Ok(dir.join("recent.json"))
}

fn pdf_recent_store_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    // 与 recent.json 相同策略：优先使用应用配置目录
    if let Ok(mut dir) = app.path().config_dir() {
        dir.push("haomd");
        std::fs::create_dir_all(&dir)?;
        return Ok(dir.join("pdf_recent.json"));
    }

    // 兜底：退回到当前工作目录
    let dir = std::env::current_dir()?;
    Ok(dir.join("pdf_recent.json"))
}

fn pdf_folders_store_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    // 与 pdf_recent.json 相同策略：优先使用配置目录
    if let Ok(mut dir) = app.path().config_dir() {
        dir.push("haomd");
        std::fs::create_dir_all(&dir)?;
        return Ok(dir.join("pdf_folders.json"));
    }

    // 兜底：退回到当前工作目录
    let dir = std::env::current_dir()?;
    Ok(dir.join("pdf_folders.json"))
}

fn file_virtual_folders_store_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    // 与 recent.json 相同策略：优先使用配置目录
    if let Ok(mut dir) = app.path().config_dir() {
        dir.push("haomd");
        std::fs::create_dir_all(&dir)?;
        return Ok(dir.join("file_virtual_folders.json"));
    }

    // 兜底：退回到当前工作目录
    let dir = std::env::current_dir()?;
    Ok(dir.join("file_virtual_folders.json"))
}

fn file_virtual_assignments_store_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    // 与 recent.json 相同策略：优先使用配置目录
    if let Ok(mut dir) = app.path().config_dir() {
        dir.push("haomd");
        std::fs::create_dir_all(&dir)?;
        return Ok(dir.join("file_virtual_assignments.json"));
    }

    // 兜底：退回到当前工作目录
    let dir = std::env::current_dir()?;
    Ok(dir.join("file_virtual_assignments.json"))
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SidebarState {
    root: Option<String>,
    expanded_paths: Vec<String>,
    #[serde(default)]
    standalone_files: Vec<String>,
    #[serde(default)]
    folder_roots: Vec<String>,
    #[serde(default)]
    highlighted_files: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ExternalOpenItem {
    path: String,
    is_folder: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WordDocPayloadCfg {
    title: String,
    blocks: Vec<WordBlockCfg>,
    assets: Vec<WordAssetCfg>,
    #[serde(default)]
    #[serde(rename = "styleSettings")]
    style_settings: Option<WordExportStyleSettingsCfg>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WordTemplateFillBindingCfg {
    field: String,
    placeholder: String,
    #[serde(rename = "type")]
    binding_type: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WordTemplateConfigCfg {
    template_id: String,
    name: Option<String>,
    bindings: Vec<WordTemplateFillBindingCfg>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type", rename_all = "lowercase")]
enum WordBlockCfg {
    Heading {
        level: u8,
        text: Vec<WordInlineRunCfg>,
        #[serde(default)]
        style: Option<WordParagraphStyleCfg>,
    },
    Paragraph {
        text: Vec<WordInlineRunCfg>,
        #[serde(default)]
        style: Option<WordParagraphStyleCfg>,
    },
    Blockquote {
        children: Vec<WordBlockCfg>,
    },
    Math {
        content: String,
        #[serde(default)]
        #[serde(rename = "mathMl")]
        math_ml: Option<String>,
    },
    Code {
        language: Option<String>,
        content: String,
    },
    List {
        ordered: bool,
        items: Vec<Vec<WordBlockCfg>>,
    },
    Table {
        rows: Vec<WordTableRowCfg>,
        #[serde(default)]
        style: Option<WordTableStyleCfg>,
    },
    Image {
        #[serde(rename = "assetId")]
        asset_id: String,
        alt: Option<String>,
        #[serde(rename = "widthPx")]
        width_px: Option<u32>,
        #[serde(rename = "heightPx")]
        height_px: Option<u32>,
        #[serde(default)]
        #[serde(rename = "widthPercent")]
        width_percent: Option<f32>,
        #[serde(default)]
        #[serde(rename = "maxWidthPercent")]
        max_width_percent: Option<f32>,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WordParagraphStyleCfg {
    #[serde(default)]
    align: Option<String>,
    #[serde(default)]
    line_height: Option<f32>,
    #[serde(default)]
    spacing_after_pt: Option<f32>,
    #[serde(default)]
    background_color: Option<String>,
    #[serde(default)]
    border_color: Option<String>,
    #[serde(default)]
    border_top_color: Option<String>,
    #[serde(default)]
    border_right_color: Option<String>,
    #[serde(default)]
    border_bottom_color: Option<String>,
    #[serde(default)]
    border_left_color: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WordTableRowCfg {
    cells: Vec<WordTableCellCfg>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WordTableStyleCfg {
    #[serde(default)]
    align: Option<String>,
    #[serde(default)]
    width_percent: Option<f32>,
    #[serde(default)]
    width_px: Option<u32>,
    #[serde(default)]
    max_width_percent: Option<f32>,
    #[serde(default)]
    layout: Option<String>,
    #[serde(default)]
    column_widths: Option<Vec<WordTableColumnWidthCfg>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WordTableColumnWidthCfg {
    #[serde(default)]
    width_percent: Option<f32>,
    #[serde(default)]
    width_px: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WordTableCellStyleCfg {
    #[serde(default)]
    background_color: Option<String>,
    #[serde(default)]
    align: Option<String>,
    #[serde(default)]
    border_color: Option<String>,
    #[serde(default)]
    border_top_color: Option<String>,
    #[serde(default)]
    border_right_color: Option<String>,
    #[serde(default)]
    border_bottom_color: Option<String>,
    #[serde(default)]
    border_left_color: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WordTableCellCfg {
    blocks: Vec<WordBlockCfg>,
    #[serde(default)]
    style: Option<WordTableCellStyleCfg>,
    #[serde(default)]
    #[serde(rename = "colSpan")]
    col_span: Option<u32>,
    #[serde(default)]
    #[serde(rename = "rowSpan")]
    row_span: Option<u32>,
    #[serde(default)]
    #[serde(rename = "mergeContinue")]
    merge_continue: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type", rename_all = "lowercase")]
enum WordInlineRunCfg {
    Text {
        value: String,
        #[serde(default)]
        bold: Option<bool>,
        #[serde(default)]
        italic: Option<bool>,
        #[serde(default)]
        code: Option<bool>,
        #[serde(default)]
        strike: Option<bool>,
        #[serde(default)]
        underline: Option<bool>,
        #[serde(default)]
        color: Option<String>,
        #[serde(default)]
        background_color: Option<String>,
        #[serde(default)]
        font_size_pt: Option<f32>,
        #[serde(default)]
        font_family: Option<String>,
    },
    Math {
        value: String,
        #[serde(default)]
        #[serde(rename = "mathMl")]
        math_ml: Option<String>,
    },
    Link {
        value: String,
        href: String,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum WordAssetCfg {
    Image {
        id: String,
        #[serde(rename = "sourcePath")]
        source_path: String,
        #[serde(default)]
        #[serde(rename = "mimeType")]
        mime_type: Option<String>,
        #[serde(default)]
        #[serde(rename = "widthPx")]
        width_px: Option<u32>,
        #[serde(default)]
        #[serde(rename = "heightPx")]
        height_px: Option<u32>,
    },
    EmbeddedImage {
        id: String,
        #[serde(rename = "fileName")]
        file_name: String,
        #[serde(rename = "mimeType")]
        mime_type: String,
        #[serde(rename = "base64Data")]
        base64_data: String,
        #[serde(default)]
        #[serde(rename = "widthPx")]
        width_px: Option<u32>,
        #[serde(default)]
        #[serde(rename = "heightPx")]
        height_px: Option<u32>,
    },
}

#[derive(Debug, Clone)]
struct WordAssetRuntime {
    rel_id: String,
    target: String,
    width_px: u32,
    height_px: u32,
}

#[derive(Debug, Clone)]
struct WordExportStyleSettingsResolved {
    body_font_family: String,
    body_font_size_half_points: u32,
    heading_font_family: String,
    heading1_size_half_points: u32,
    heading2_size_half_points: u32,
    heading3_size_half_points: u32,
    paragraph_spacing_after_twips: u32,
    line_spacing_twips: u32,
    code_font_size_half_points: u32,
    page_margin_twips: u32,
}

#[derive(Debug)]
struct WordRenderState {
    next_rel_id: u32,
    next_doc_pr_id: u32,
    image_assets: std::collections::HashMap<String, WordAssetRuntime>,
    hyperlinks: Vec<(String, String)>,
    style_settings: WordExportStyleSettingsResolved,
}

impl Default for WordRenderState {
    fn default() -> Self {
        Self {
            next_rel_id: 0,
            next_doc_pr_id: 0,
            image_assets: std::collections::HashMap::new(),
            hyperlinks: Vec::new(),
            style_settings: resolve_word_export_style_settings(None),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct AiProviderModelCfg {
    id: String,
    #[serde(default)]
    max_tokens: Option<u32>,
    #[serde(default)]
    vision_mode: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct AiProviderCfg {
    id: String,
    name: String,
    base_url: String,
    api_key: String,
    models: Vec<AiProviderModelCfg>,
    #[serde(default)]
    default_model_id: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    provider_type: Option<String>,
    #[serde(default)]
    vision_mode: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct AiSettingsCfg {
    providers: Vec<AiProviderCfg>,
    #[serde(default)]
    default_provider_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct PromptRoleCfg {
    id: String,
    name: String,
    #[serde(default)]
    description: Option<String>,
    prompt: String,
    #[serde(default)]
    is_default: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct PromptSettingsCfg {
    roles: Vec<PromptRoleCfg>,
    #[serde(default)]
    default_role_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct AgentProviderCfg {
    id: String,
    name: String,
    base_url: String,
    api_key: String,
    #[serde(default)]
    platform: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct AgentSettingsCfg {
    providers: Vec<AgentProviderCfg>,
    #[serde(default)]
    default_provider_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ClipboardImageResult {
    file_name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AiCompressionCfg {
    #[serde(default)]
    min_messages_to_compress: Option<u32>,
    #[serde(default)]
    keep_recent_rounds: Option<u32>,
    #[serde(default)]
    max_messages_after_compress: Option<u32>,
    #[serde(default)]
    max_messages_per_summary_batch: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct HugeDocCfg {
    #[serde(default)]
    enabled: Option<bool>,
    #[serde(default)]
    line_threshold: Option<u32>,
    #[serde(default)]
    chunk_context_lines: Option<u32>,
    #[serde(default)]
    chunk_max_lines: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AiChatUiCfg {
    #[serde(default)]
    max_visible_messages_dialog: Option<u32>,
    #[serde(default)]
    max_visible_messages_pane: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ThemeEditorBackgroundCfg {
    #[serde(default)]
    enabled: Option<bool>,
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    opacity: Option<f32>,
    #[serde(default)]
    overlay_opacity: Option<f32>,
    #[serde(default)]
    blur_px: Option<f32>,
    #[serde(default)]
    brightness: Option<f32>,
    #[serde(default)]
    size: Option<String>,
    #[serde(default)]
    position_x: Option<f32>,
    #[serde(default)]
    position_y: Option<f32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ThemeSettingsCfg {
    #[serde(default)]
    mode: Option<String>,
    #[serde(default)]
    custom_theme_id: Option<String>,
    #[serde(default)]
    workspace_background: Option<ThemeEditorBackgroundCfg>,
    #[serde(default)]
    workspace_background_include_sidebar: Option<bool>,
    #[serde(default)]
    editor_background: Option<ThemeEditorBackgroundCfg>,
    #[serde(default)]
    preview_background: Option<ThemeEditorBackgroundCfg>,
    #[serde(default)]
    ai_chat_background: Option<ThemeEditorBackgroundCfg>,
    #[serde(default)]
    sidebar_background: Option<ThemeEditorBackgroundCfg>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct UiTypographySettingsCfg {
    #[serde(default)]
    app_font_size: Option<f32>,
    #[serde(default)]
    settings_font_size: Option<f32>,
    #[serde(default)]
    sidebar_font_size: Option<f32>,
    #[serde(default)]
    tab_bar_font_size: Option<f32>,
    #[serde(default)]
    status_bar_font_size: Option<f32>,
    #[serde(default)]
    editor_font_size: Option<f32>,
    #[serde(default)]
    preview_font_size: Option<f32>,
    #[serde(default)]
    ai_chat_message_font_size: Option<f32>,
    #[serde(default)]
    ai_chat_input_font_size: Option<f32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WordExportStyleSettingsCfg {
    #[serde(default)]
    body_font_family: Option<String>,
    #[serde(default)]
    body_font_size_pt: Option<f32>,
    #[serde(default)]
    heading_font_family: Option<String>,
    #[serde(default)]
    heading1_size_pt: Option<f32>,
    #[serde(default)]
    heading2_size_pt: Option<f32>,
    #[serde(default)]
    heading3_size_pt: Option<f32>,
    #[serde(default)]
    paragraph_spacing_after_pt: Option<f32>,
    #[serde(default)]
    line_spacing: Option<f32>,
    #[serde(default)]
    code_font_size_pt: Option<f32>,
    #[serde(default)]
    page_margin_cm: Option<f32>,
    #[serde(default)]
    enable_inkscape_for_word_export: Option<bool>,
    #[serde(default)]
    mermaid_export_format: Option<String>,
    #[serde(default)]
    inkscape_fallback: Option<String>,
    #[serde(default)]
    selected_word_template_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WordTemplateEntry {
    id: String,
    name: String,
    dir: String,
    docx_path: String,
    json_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EditorSettingsCfg {
    #[serde(default)]
    ai_compression: Option<AiCompressionCfg>,
    #[serde(default)]
    huge_doc: Option<HugeDocCfg>,
    #[serde(default)]
    ai_chat: Option<AiChatUiCfg>,
    #[serde(default)]
    language: Option<String>,
    #[serde(default)]
    theme: Option<ThemeSettingsCfg>,
    #[serde(default)]
    ui_typography: Option<UiTypographySettingsCfg>,
    #[serde(default)]
    word_export: Option<WordExportStyleSettingsCfg>,
    /// 预留扩展位：保存未来新增的配置项，避免在写回文件时丢失
    #[serde(flatten)]
    extra: std::collections::HashMap<String, serde_json::Value>,
}

fn default_editor_settings() -> EditorSettingsCfg {
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
        extra: std::collections::HashMap::new(),
    }
}

fn default_theme_settings_cfg() -> ThemeSettingsCfg {
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

fn default_word_export_style_settings_cfg() -> WordExportStyleSettingsCfg {
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

fn default_ui_typography_settings_cfg() -> UiTypographySettingsCfg {
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

fn resolve_word_export_style_settings(
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

fn pt_to_half_points(value: f32) -> u32 {
    (value.clamp(8.0, 48.0) * 2.0).round() as u32
}

fn pt_to_twips(value: f32) -> u32 {
    (value.clamp(0.0, 72.0) * 20.0).round() as u32
}

fn line_spacing_to_twips(value: f32) -> u32 {
    (value.clamp(1.0, 3.0) * 240.0).round() as u32
}

fn cm_to_twips(value: f32) -> u32 {
    ((value.clamp(1.0, 5.0) / 2.54) * 1440.0).round() as u32
}

// 内置默认 AI 配置，来源于 src-tauri/ai_settings.default.json
static DEFAULT_AI_SETTINGS_JSON: &str = include_str!("../ai_settings.default.json");

fn sidebar_state_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    // 与 recent.json 相同策略：优先使用配置目录
    if let Ok(mut dir) = app.path().config_dir() {
        dir.push("haomd");
        std::fs::create_dir_all(&dir)?;
        return Ok(dir.join("sidebar_state.json"));
    }

    // 兜底：退回到当前工作目录
    let dir = std::env::current_dir()?;
    Ok(dir.join("sidebar_state.json"))
}

fn ai_settings_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    if let Ok(mut dir) = app.path().config_dir() {
        dir.push("haomd");
        std::fs::create_dir_all(&dir)?;
        return Ok(dir.join("ai_settings.json"));
    }

    let dir = std::env::current_dir()?;
    Ok(dir.join("ai_settings.json"))
}

fn prompt_settings_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    if let Ok(mut dir) = app.path().config_dir() {
        dir.push("haomd");
        std::fs::create_dir_all(&dir)?;
        return Ok(dir.join("prompt_settings.json"));
    }

    let dir = std::env::current_dir()?;
    Ok(dir.join("prompt_settings.json"))
}

fn agent_settings_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    if let Ok(mut dir) = app.path().config_dir() {
        dir.push("haomd");
        std::fs::create_dir_all(&dir)?;
        return Ok(dir.join("agent_providers.json"));
    }

    let dir = std::env::current_dir()?;
    Ok(dir.join("agent_providers.json"))
}

fn editor_settings_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    if let Ok(mut dir) = app.path().config_dir() {
        dir.push("haomd");
        std::fs::create_dir_all(&dir)?;
        return Ok(dir.join("editor_settings.json"));
    }

    let dir = std::env::current_dir()?;
    Ok(dir.join("editor_settings.json"))
}

fn editor_backgrounds_dir(app: &AppHandle) -> std::io::Result<PathBuf> {
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

fn should_cleanup_managed_editor_background(
    backgrounds_dir: &Path,
    previous_path: &Path,
    new_path: &Path,
) -> bool {
    if previous_path == new_path {
        return false;
    }
    previous_path.starts_with(backgrounds_dir) && previous_path.is_file()
}

fn clamp_image_to_long_edge(width: u32, height: u32, max_long_edge: u32) -> (u32, u32) {
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

fn import_editor_background_image_sync(
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
    let digest = hash_bytes(&bytes);
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

async fn read_sidebar_state(app: &AppHandle) -> std::io::Result<SidebarState> {
    let path = sidebar_state_path(app)?;
    match fs::read(&path).await {
        Ok(bytes) => {
            let state: SidebarState = serde_json::from_slice(&bytes).unwrap_or(SidebarState {
                root: None,
                expanded_paths: Vec::new(),
                standalone_files: Vec::new(),
                folder_roots: Vec::new(),
                highlighted_files: Vec::new(),
            });
            Ok(state)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(SidebarState {
            root: None,
            expanded_paths: Vec::new(),
            standalone_files: Vec::new(),
            folder_roots: Vec::new(),
            highlighted_files: Vec::new(),
        }),
        Err(err) => Err(err),
    }
}

async fn write_sidebar_state(app: &AppHandle, state: &SidebarState) -> std::io::Result<()> {
    let path = sidebar_state_path(app)?;
    let bytes = serde_json::to_vec_pretty(state)?;
    fs::write(path, bytes).await
}

async fn read_recent_store(app: &AppHandle) -> std::io::Result<Vec<RecentFile>> {
    let path = recent_store_path(app)?;
    match fs::read(&path).await {
        Ok(bytes) => {
            let items: Vec<RecentFile> = serde_json::from_slice(&bytes).unwrap_or_default();
            Ok(items)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(err) => Err(err),
    }
}

async fn write_recent_store(app: &AppHandle, items: &[RecentFile]) -> std::io::Result<()> {
    let path = recent_store_path(app)?;
    let bytes = serde_json::to_vec_pretty(items)?;
    fs::write(path, bytes).await
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct PdfRecentEntry {
    path: String,
    display_name: String,
    last_opened_at: u64,
    #[serde(default)]
    folder_id: Option<String>,
}

async fn read_pdf_recent_store(app: &AppHandle) -> std::io::Result<Vec<PdfRecentEntry>> {
    let path = pdf_recent_store_path(app)?;
    match fs::read(&path).await {
        Ok(bytes) => {
            let items: Vec<PdfRecentEntry> = serde_json::from_slice(&bytes).unwrap_or_default();
            Ok(items)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(err) => Err(err),
    }
}

async fn write_pdf_recent_store(app: &AppHandle, items: &[PdfRecentEntry]) -> std::io::Result<()> {
    let path = pdf_recent_store_path(app)?;
    let bytes = serde_json::to_vec_pretty(items)?;
    fs::write(path, bytes).await
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct PdfFolder {
    id: String,
    name: String,
}

async fn read_pdf_folders_store(app: &AppHandle) -> std::io::Result<Vec<PdfFolder>> {
    let path = pdf_folders_store_path(app)?;
    match fs::read(&path).await {
        Ok(bytes) => {
            let items: Vec<PdfFolder> = serde_json::from_slice(&bytes).unwrap_or_default();
            Ok(items)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(err) => Err(err),
    }
}

async fn write_pdf_folders_store(app: &AppHandle, items: &[PdfFolder]) -> std::io::Result<()> {
    let path = pdf_folders_store_path(app)?;
    let bytes = serde_json::to_vec_pretty(items)?;
    fs::write(path, bytes).await
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct FileVirtualFolder {
    id: String,
    name: String,
    order: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct FileVirtualAssignment {
    path: String,
    folder_id: Option<String>,
    updated_at: u64,
}

async fn read_file_virtual_folders_store(
    app: &AppHandle,
) -> std::io::Result<Vec<FileVirtualFolder>> {
    let path = file_virtual_folders_store_path(app)?;
    match fs::read(&path).await {
        Ok(bytes) => {
            let items: Vec<FileVirtualFolder> = serde_json::from_slice(&bytes).unwrap_or_default();
            log::info!(
                "[tauri][FilesVirtual] read_file_virtual_folders_store: path={:?}, count={}",
                &path,
                items.len()
            );
            Ok(items)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            log::info!(
                "[tauri][FilesVirtual] read_file_virtual_folders_store: path={:?} not found, return empty",
                &path
            );
            Ok(vec![])
        }
        Err(err) => Err(err),
    }
}

async fn write_file_virtual_folders_store(
    app: &AppHandle,
    items: &[FileVirtualFolder],
) -> std::io::Result<()> {
    let path = file_virtual_folders_store_path(app)?;
    log::info!(
        "[tauri][FilesVirtual] write_file_virtual_folders_store: path={:?}, count={}",
        &path,
        items.len()
    );
    let bytes = serde_json::to_vec_pretty(items)?;
    fs::write(path, bytes).await
}

async fn read_file_virtual_assignments_store(
    app: &AppHandle,
) -> std::io::Result<Vec<FileVirtualAssignment>> {
    let path = file_virtual_assignments_store_path(app)?;
    match fs::read(&path).await {
        Ok(bytes) => {
            let items: Vec<FileVirtualAssignment> =
                serde_json::from_slice(&bytes).unwrap_or_default();
            log::info!(
                "[tauri][FilesVirtual] read_file_virtual_assignments_store: path={:?}, count={}",
                &path,
                items.len()
            );
            Ok(items)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            log::info!(
                "[tauri][FilesVirtual] read_file_virtual_assignments_store: path={:?} not found, return empty",
                &path
            );
            Ok(vec![])
        }
        Err(err) => Err(err),
    }
}

async fn write_file_virtual_assignments_store(
    app: &AppHandle,
    items: &[FileVirtualAssignment],
) -> std::io::Result<()> {
    let path = file_virtual_assignments_store_path(app)?;
    log::info!(
        "[tauri][FilesVirtual] write_file_virtual_assignments_store: path={:?}, count={}",
        &path,
        items.len()
    );
    let bytes = serde_json::to_vec_pretty(items)?;
    fs::write(path, bytes).await
}

async fn upsert_pdf_recent(app: &AppHandle, path: &str) -> std::io::Result<()> {
    let mut list = read_pdf_recent_store(app).await?;

    let display_name = std::path::Path::new(path)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();

    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    if let Some(item) = list.iter_mut().find(|item| item.path == path) {
        item.display_name = display_name.clone();
        item.last_opened_at = now_ms;
        // 保留已有的 folder_id，不在这里修改分类
    } else {
        list.push(PdfRecentEntry {
            path: path.to_string(),
            display_name,
            last_opened_at: now_ms,
            folder_id: None,
        });
    }

    // 按最近使用时间降序排序
    list.sort_by(|a, b| b.last_opened_at.cmp(&a.last_opened_at));

    // 截断到最大条数
    if list.len() > MAX_RECENT_ITEMS {
        list.truncate(MAX_RECENT_ITEMS);
    }

    write_pdf_recent_store(app, &list).await
}

async fn delete_pdf_recent(app: &AppHandle, path: &str) -> std::io::Result<()> {
    let mut list = read_pdf_recent_store(app).await?;
    list.retain(|item| item.path != path);
    write_pdf_recent_store(app, &list).await
}

async fn update_recent(app: &AppHandle, path: &str, is_folder: bool) -> std::io::Result<()> {
    let mut list = read_recent_store(app).await?;

    let display_name = std::path::Path::new(path)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();

    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    if let Some(item) = list.iter_mut().find(|item| item.path == path) {
        item.display_name = display_name.clone();
        item.last_opened_at = now_ms;
        item.is_folder = is_folder;
    } else {
        list.push(RecentFile {
            path: path.to_string(),
            display_name,
            last_opened_at: now_ms,
            is_folder,
        });
    }

    // 按最近使用时间降序排序
    list.sort_by(|a, b| b.last_opened_at.cmp(&a.last_opened_at));

    // 截断到最大条数
    if list.len() > MAX_RECENT_ITEMS {
        list.truncate(MAX_RECENT_ITEMS);
    }

    write_recent_store(app, &list).await
}

#[tauri::command]
async fn read_file(
    app: AppHandle,
    path: String,
    trace_id: Option<String>,
) -> ResultPayload<FilePayload> {
    let trace = trace_id.unwrap_or_else(new_trace_id);
    let normalized = match normalize_path(&path) {
        Ok(p) => p,
        Err(e) => return ResultPayload::Err { error: e },
    };

    let meta = match fs::metadata(&normalized).await {
        Ok(m) => m,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return err_payload(ErrorCode::NotFound, "文件不存在", trace)
        }
        Err(err) => {
            return err_payload(ErrorCode::IoError, format!("读取元数据失败: {err}"), trace)
        }
    };

    if meta.len() > MAX_FILE_BYTES {
        return err_payload(ErrorCode::TooLarge, "文件过大，已超过上限", trace);
    }

    let bytes = match fs::read(&normalized).await {
        Ok(b) => b,
        Err(err) => return err_payload(ErrorCode::IoError, format!("读取文件失败: {err}"), trace),
    };

    let content = match String::from_utf8(bytes.clone()) {
        Ok(s) => s,
        Err(_) => return err_payload(ErrorCode::UNSUPPORTED, "仅支持 UTF-8 文本文件", trace),
    };

    let payload = FilePayload {
        path: normalized.to_string_lossy().into_owned(),
        content,
        encoding: "utf-8".into(),
        mtime_ms: mtime_ms(&meta),
        hash: hash_bytes(&bytes),
    };

    info!(
        "action=read_file outcome=ok path={} trace_id={} size={}B",
        payload.path,
        trace,
        meta.len()
    );

    // 兜底：只要后端成功读取文件，就将其写入最近文件列表，并刷新菜单
    if let Err(err) = update_recent(&app, &payload.path, false).await {
        info!(
            "action=log_recent_from_read outcome=err path={} trace_id={} error={}",
            payload.path, trace, err
        );
    } else {
        refresh_app_menu(&app).await;
    }

    ok(payload, trace)
}

#[tauri::command]
async fn read_binary_file(
    _app: AppHandle,
    path: String,
    trace_id: Option<String>,
) -> ResultPayload<Vec<u8>> {
    let trace = trace_id.unwrap_or_else(new_trace_id);
    let normalized = match normalize_path(&path) {
        Ok(p) => p,
        Err(e) => return ResultPayload::Err { error: e },
    };

    let meta = match fs::metadata(&normalized).await {
        Ok(m) => m,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return err_payload(ErrorCode::NotFound, "文件不存在", trace);
        }
        Err(err) => {
            return err_payload(ErrorCode::IoError, format!("读取元数据失败: {err}"), trace)
        }
    };

    if meta.len() > MAX_FILE_BYTES {
        return err_payload(ErrorCode::TooLarge, "文件过大，已超过上限", trace);
    }

    let bytes = match fs::read(&normalized).await {
        Ok(b) => b,
        Err(err) => return err_payload(ErrorCode::IoError, format!("读取文件失败: {err}"), trace),
    };

    // 仅作为 PDF 等二进制读取辅助，不记录最近文件
    ok(bytes, trace)
}

#[tauri::command]
async fn write_file(
    app: AppHandle,
    path: String,
    content: String,
    expected_mtime: Option<u64>,
    expected_hash: Option<String>,
    trace_id: Option<String>,
) -> ResultPayload<WriteResult> {
    let trace = trace_id.unwrap_or_else(new_trace_id);
    let normalized = match normalize_path(&path) {
        Ok(p) => p,
        Err(e) => return ResultPayload::Err { error: e },
    };

    if (content.len() as u64) > MAX_FILE_BYTES {
        return err_payload(ErrorCode::TooLarge, "写入内容超过上限", trace);
    }

    let lock = file_lock(&normalized).await;
    let _guard = lock.lock().await;

    if let Ok(meta) = fs::metadata(&normalized).await {
        if let Some(exp) = expected_mtime {
            let mtime = mtime_ms(&meta);
            if mtime != exp {
                return err_payload(ErrorCode::CONFLICT, "mtime 不匹配，可能存在外部修改", trace);
            }
        }
        if let Some(exp_hash) = expected_hash {
            if let Ok(bytes) = fs::read(&normalized).await {
                let current_hash = hash_bytes(&bytes);
                if current_hash != exp_hash {
                    return err_payload(
                        ErrorCode::CONFLICT,
                        "hash 不匹配，可能存在外部修改",
                        trace,
                    );
                }
            }
        }
    }

    if let Some(parent) = normalized.parent() {
        if let Err(err) = fs::create_dir_all(parent).await {
            return err_payload(ErrorCode::IoError, format!("创建目录失败: {err}"), trace);
        }
    }

    if let Err(err) = fs::write(&normalized, content.as_bytes()).await {
        return err_payload(ErrorCode::IoError, format!("写入失败: {err}"), trace);
    }

    let meta = match fs::metadata(&normalized).await {
        Ok(m) => m,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取写入后元数据失败: {err}"),
                trace,
            )
        }
    };

    let bytes = fs::read(&normalized)
        .await
        .unwrap_or_else(|_| content.as_bytes().to_vec());
    let result = WriteResult {
        path: normalized.to_string_lossy().into_owned(),
        mtime_ms: mtime_ms(&meta),
        hash: hash_bytes(&bytes),
        code: ErrorCode::OK,
        message: None,
    };

    info!(
        "action=write_file outcome=ok path={} trace_id={} size={}B",
        result.path,
        trace,
        meta.len()
    );

    // 写入成功后，自动记录到最近文件，并刷新原生菜单
    if let Err(err) = update_recent(&app, &result.path, false).await {
        info!(
            "action=log_recent_from_write outcome=err path={} trace_id={} error={}",
            result.path, trace, err
        );
    } else {
        refresh_app_menu(&app).await;
    }

    ok(result, trace)
}

#[tauri::command]
async fn write_file_no_recent(
    _app: AppHandle,
    path: String,
    content: String,
    expected_mtime: Option<u64>,
    expected_hash: Option<String>,
    trace_id: Option<String>,
) -> ResultPayload<WriteResult> {
    let trace = trace_id.unwrap_or_else(new_trace_id);
    let normalized = match normalize_path(&path) {
        Ok(p) => p,
        Err(e) => return ResultPayload::Err { error: e },
    };

    if (content.len() as u64) > MAX_FILE_BYTES {
        return err_payload(ErrorCode::TooLarge, "写入内容超过上限", trace);
    }

    let lock = file_lock(&normalized).await;
    let _guard = lock.lock().await;

    if let Ok(meta) = fs::metadata(&normalized).await {
        if let Some(exp) = expected_mtime {
            let mtime = mtime_ms(&meta);
            if mtime != exp {
                return err_payload(ErrorCode::CONFLICT, "mtime 不匹配，可能存在外部修改", trace);
            }
        }
        if let Some(exp_hash) = expected_hash {
            if let Ok(bytes) = fs::read(&normalized).await {
                let current_hash = hash_bytes(&bytes);
                if current_hash != exp_hash {
                    return err_payload(
                        ErrorCode::CONFLICT,
                        "hash 不匹配，可能存在外部修改",
                        trace,
                    );
                }
            }
        }
    }

    if let Some(parent) = normalized.parent() {
        if let Err(err) = fs::create_dir_all(parent).await {
            return err_payload(ErrorCode::IoError, format!("创建目录失败: {err}"), trace);
        }
    }

    if let Err(err) = fs::write(&normalized, content.as_bytes()).await {
        return err_payload(ErrorCode::IoError, format!("写入失败: {err}"), trace);
    }

    let meta = match fs::metadata(&normalized).await {
        Ok(m) => m,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取写入后元数据失败: {err}"),
                trace,
            )
        }
    };

    let bytes = fs::read(&normalized)
        .await
        .unwrap_or_else(|_| content.as_bytes().to_vec());
    let result = WriteResult {
        path: normalized.to_string_lossy().into_owned(),
        mtime_ms: mtime_ms(&meta),
        hash: hash_bytes(&bytes),
        code: ErrorCode::OK,
        message: None,
    };

    info!(
        "action=write_file_no_recent outcome=ok path={} trace_id={} size={}B",
        result.path,
        trace,
        meta.len()
    );

    // 注意：不更新最近文件列表，也不刷新原生菜单
    ok(result, trace)
}

#[tauri::command]
async fn save_text_with_dialog(
    app: AppHandle,
    default_file_name: String,
    content: String,
) -> Result<(), String> {
    let dialog = app.dialog().file().set_title("Save AI History as Markdown");
    let dialog = dialog
        .add_filter("Markdown", &["md"])
        .add_filter("Text", &["txt"])
        .set_file_name(&default_file_name);

    let content_to_write = content.clone();
    dialog.save_file(move |file_path| {
        if let Some(path) = file_path {
            if let Some(path_str) = path.as_path() {
                let path_buf = path_str.to_path_buf();
                if let Some(parent) = path_buf.parent() {
                    if let Err(err) = std::fs::create_dir_all(parent) {
                        log::error!("[save_text_with_dialog] 创建目录失败: {}", err);
                        return;
                    }
                }

                if let Err(err) = std::fs::write(&path_buf, content_to_write.as_bytes()) {
                    log::error!("[save_text_with_dialog] 写入文件失败: {}", err);
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
async fn save_ai_sessions_json_with_dialog(
    app: AppHandle,
    default_file_name: String,
    content: String,
) -> Result<(), String> {
    let dialog = app
        .dialog()
        .file()
        .set_title("Save AI Sessions as JSON")
        .set_file_name(&default_file_name);

    let content_to_write = content.clone();
    dialog.save_file(move |file_path| {
        if let Some(path) = file_path {
            if let Some(path_str) = path.as_path() {
                let path_buf = path_str.to_path_buf();
                if let Some(parent) = path_buf.parent() {
                    if let Err(err) = std::fs::create_dir_all(parent) {
                        log::error!("[save_ai_sessions_json_with_dialog] 创建目录失败: {}", err);
                        return;
                    }
                }

                if let Err(err) = std::fs::write(&path_buf, content_to_write.as_bytes()) {
                    log::error!("[save_ai_sessions_json_with_dialog] 写入文件失败: {}", err);
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
async fn pick_editor_background_image(
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

#[tauri::command]
async fn export_word_docx(payload_json: String, output_path: String) -> Result<(), String> {
    let payload: WordDocPayloadCfg =
        serde_json::from_str(&payload_json).map_err(|e| format!("解析导出数据失败: {e}"))?;
    let output = PathBuf::from(&output_path);
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建输出目录失败: {e}"))?;
    }

    let work_dir = std::env::temp_dir().join(format!(
        "haomd-word-export-{}",
        new_trace_id().replace("trace_", "")
    ));
    if work_dir.exists() {
        let _ = std::fs::remove_dir_all(&work_dir);
    }

    let result = (|| -> Result<(), String> {
        build_word_export_workspace(&work_dir, &payload)?;
        package_docx_workspace(&work_dir, &output)?;
        Ok(())
    })();

    let _ = std::fs::remove_dir_all(&work_dir);
    result
}

#[tauri::command]
async fn fill_docx_template(
    app: AppHandle,
    template_id: String,
    model_json: String,
    rich_blocks_json: String,
    output_path: String,
) -> Result<(), String> {
    let (docx_path, json_path) = resolve_word_template_paths(&app, &template_id)?;
    let template_cfg: WordTemplateConfigCfg = serde_json::from_slice(
        &std::fs::read(&json_path).map_err(|e| format!("读取模板配置失败: {e}"))?,
    )
    .map_err(|e| format!("解析模板配置失败: {e}"))?;
    let model: serde_json::Value =
        serde_json::from_str(&model_json).map_err(|e| format!("解析模板数据失败: {e}"))?;
    let rich_blocks: HashMap<String, Vec<WordBlockCfg>> =
        serde_json::from_str(&rich_blocks_json)
            .map_err(|e| format!("解析模板富文本数据失败: {e}"))?;

    if let Some(parent) = Path::new(&output_path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建输出目录失败: {e}"))?;
    }

    let replacements = build_template_replacements(&template_cfg, &model, &rich_blocks)?;
    rewrite_docx_template(&docx_path, Path::new(&output_path), &replacements)
}

#[tauri::command]
async fn is_inkscape_available() -> Result<bool, String> {
    Ok(find_inkscape_binary().is_some())
}

#[tauri::command]
async fn convert_svg_to_emf(svg_markup: String) -> Result<String, String> {
    let inkscape = find_inkscape_binary().ok_or_else(|| "未检测到 Inkscape".to_string())?;
    let work_dir = std::env::temp_dir().join(format!(
        "haomd-inkscape-{}",
        new_trace_id().replace("trace_", "")
    ));
    std::fs::create_dir_all(&work_dir).map_err(|e| format!("创建 Inkscape 临时目录失败: {e}"))?;

    let input_path = work_dir.join("diagram.svg");
    let output_path = work_dir.join("diagram.emf");

    let result = (|| -> Result<String, String> {
        std::fs::write(&input_path, svg_markup.as_bytes())
            .map_err(|e| format!("写入 SVG 临时文件失败: {e}"))?;

        let output = Command::new(&inkscape)
            .arg(&input_path)
            .arg("--export-type=emf")
            .arg(format!(
                "--export-filename={}",
                output_path.to_string_lossy()
            ))
            .output()
            .map_err(|e| format!("调用 Inkscape 失败: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let detail = if !stderr.is_empty() {
                stderr
            } else if !stdout.is_empty() {
                stdout
            } else {
                format!("退出码: {:?}", output.status.code())
            };
            return Err(format!("Inkscape 转换 EMF 失败: {detail}"));
        }

        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if !stderr.is_empty() {
            log::warn!("[inkscape][emf] {}", stderr);
        }

        let emf_bytes =
            std::fs::read(&output_path).map_err(|e| format!("读取 EMF 输出失败: {e}"))?;
        Ok(base64::encode(emf_bytes))
    })();

    let _ = std::fs::remove_dir_all(&work_dir);
    result
}

#[tauri::command]
async fn convert_svg_to_plain_svg(svg_markup: String) -> Result<String, String> {
    let inkscape = find_inkscape_binary().ok_or_else(|| "未检测到 Inkscape".to_string())?;
    let work_dir = std::env::temp_dir().join(format!(
        "haomd-inkscape-{}",
        new_trace_id().replace("trace_", "")
    ));
    std::fs::create_dir_all(&work_dir).map_err(|e| format!("创建 Inkscape 临时目录失败: {e}"))?;

    let input_path = work_dir.join("diagram.svg");
    let output_path = work_dir.join("diagram-plain.svg");

    let result = (|| -> Result<String, String> {
        std::fs::write(&input_path, svg_markup.as_bytes())
            .map_err(|e| format!("写入 SVG 临时文件失败: {e}"))?;

        let output = Command::new(&inkscape)
            .arg(&input_path)
            .arg("--export-plain-svg")
            .arg(format!(
                "--export-filename={}",
                output_path.to_string_lossy()
            ))
            .output()
            .map_err(|e| format!("调用 Inkscape 失败: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let detail = if !stderr.is_empty() {
                stderr
            } else if !stdout.is_empty() {
                stdout
            } else {
                format!("退出码: {:?}", output.status.code())
            };
            return Err(format!("Inkscape 导出 Plain SVG 失败: {detail}"));
        }

        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if !stderr.is_empty() {
            log::warn!("[inkscape][plain-svg] {}", stderr);
        }

        let svg_bytes =
            std::fs::read(&output_path).map_err(|e| format!("读取 Plain SVG 输出失败: {e}"))?;
        Ok(base64::encode(svg_bytes))
    })();

    let _ = std::fs::remove_dir_all(&work_dir);
    result
}

fn find_inkscape_binary() -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    let mut candidates = Vec::<PathBuf>::new();

    for dir in std::env::split_paths(&path_var) {
        #[cfg(target_os = "windows")]
        {
            candidates.push(dir.join("inkscape.exe"));
            candidates.push(dir.join("inkscape.com"));
        }
        #[cfg(not(target_os = "windows"))]
        {
            candidates.push(dir.join("inkscape"));
        }
    }

    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from(
            "/Applications/Inkscape.app/Contents/MacOS/inkscape",
        ));
        candidates.push(PathBuf::from("/opt/homebrew/bin/inkscape"));
        candidates.push(PathBuf::from("/usr/local/bin/inkscape"));
    }

    #[cfg(target_os = "windows")]
    {
        candidates.push(PathBuf::from(r"C:\Program Files\Inkscape\bin\inkscape.exe"));
        candidates.push(PathBuf::from(r"C:\Program Files\Inkscape\inkscape.exe"));
        candidates.push(PathBuf::from(
            r"C:\Program Files (x86)\Inkscape\bin\inkscape.exe",
        ));
        candidates.push(PathBuf::from(
            r"C:\Program Files (x86)\Inkscape\inkscape.exe",
        ));
    }

    #[cfg(target_os = "linux")]
    {
        candidates.push(PathBuf::from("/usr/bin/inkscape"));
        candidates.push(PathBuf::from("/usr/local/bin/inkscape"));
        candidates.push(PathBuf::from("/snap/bin/inkscape"));
    }

    candidates.into_iter().find_map(|candidate| {
        if !candidate.is_file() {
            return None;
        }
        std::fs::canonicalize(&candidate).ok().or(Some(candidate))
    })
}

fn build_word_export_workspace(dir: &Path, payload: &WordDocPayloadCfg) -> Result<(), String> {
    std::fs::create_dir_all(dir.join("_rels")).map_err(|e| format!("创建 _rels 目录失败: {e}"))?;
    std::fs::create_dir_all(dir.join("docProps"))
        .map_err(|e| format!("创建 docProps 目录失败: {e}"))?;
    std::fs::create_dir_all(dir.join("word").join("_rels"))
        .map_err(|e| format!("创建 word/_rels 目录失败: {e}"))?;
    std::fs::create_dir_all(dir.join("word").join("media"))
        .map_err(|e| format!("创建 word/media 目录失败: {e}"))?;

    let mut content_type_defaults = std::collections::BTreeMap::<String, String>::new();
    content_type_defaults.insert(
        "rels".to_string(),
        "application/vnd.openxmlformats-package.relationships+xml".to_string(),
    );
    content_type_defaults.insert("xml".to_string(), "application/xml".to_string());

    let mut render_state = WordRenderState {
        next_rel_id: 3,
        next_doc_pr_id: 1,
        style_settings: resolve_word_export_style_settings(payload.style_settings.as_ref()),
        ..Default::default()
    };

    prepare_word_assets(
        &dir.join("word").join("media"),
        &payload.assets,
        &mut render_state,
        &mut content_type_defaults,
    )?;

    let document_xml = build_document_xml(payload, &mut render_state)?;
    let document_rels_xml = build_document_relationships_xml(&render_state);
    let styles_xml = build_word_styles_xml(&render_state.style_settings);
    let numbering_xml = build_word_numbering_xml();
    let content_types_xml = build_content_types_xml(&content_type_defaults);
    let root_rels_xml = build_root_relationships_xml();
    let core_xml = build_core_props_xml(&payload.title);
    let app_xml = build_app_props_xml();

    std::fs::write(dir.join("[Content_Types].xml"), content_types_xml)
        .map_err(|e| format!("写入 [Content_Types].xml 失败: {e}"))?;
    std::fs::write(dir.join("_rels").join(".rels"), root_rels_xml)
        .map_err(|e| format!("写入根 relationships 失败: {e}"))?;
    std::fs::write(dir.join("docProps").join("core.xml"), core_xml)
        .map_err(|e| format!("写入 core.xml 失败: {e}"))?;
    std::fs::write(dir.join("docProps").join("app.xml"), app_xml)
        .map_err(|e| format!("写入 app.xml 失败: {e}"))?;
    std::fs::write(dir.join("word").join("document.xml"), document_xml)
        .map_err(|e| format!("写入 document.xml 失败: {e}"))?;
    std::fs::write(dir.join("word").join("styles.xml"), styles_xml)
        .map_err(|e| format!("写入 styles.xml 失败: {e}"))?;
    std::fs::write(dir.join("word").join("numbering.xml"), numbering_xml)
        .map_err(|e| format!("写入 numbering.xml 失败: {e}"))?;
    std::fs::write(
        dir.join("word").join("_rels").join("document.xml.rels"),
        document_rels_xml,
    )
    .map_err(|e| format!("写入 document.xml.rels 失败: {e}"))?;

    Ok(())
}

fn prepare_word_assets(
    media_dir: &Path,
    assets: &[WordAssetCfg],
    render_state: &mut WordRenderState,
    content_type_defaults: &mut std::collections::BTreeMap<String, String>,
) -> Result<(), String> {
    for asset in assets {
        match asset {
            WordAssetCfg::Image {
                id,
                source_path,
                mime_type,
                width_px,
                height_px,
            } => {
                if source_path.starts_with("http://")
                    || source_path.starts_with("https://")
                    || source_path.starts_with("data:")
                {
                    return Err(format!("Word 导出暂不支持远程图片: {source_path}"));
                }
                let src = PathBuf::from(source_path);
                let ext = detect_asset_extension(mime_type.as_deref(), Some(&src), None);
                let file_name = format!("{id}.{ext}");
                let dest = media_dir.join(&file_name);
                std::fs::copy(&src, &dest)
                    .map_err(|e| format!("复制图片资源失败 {:?}: {e}", &src))?;
                content_type_defaults
                    .entry(ext.clone())
                    .or_insert_with(|| mime_for_extension(&ext).to_string());
                let rel_id = next_relationship_id(render_state);
                render_state.image_assets.insert(
                    id.clone(),
                    WordAssetRuntime {
                        rel_id,
                        target: format!("media/{file_name}"),
                        width_px: width_px.unwrap_or(800),
                        height_px: height_px.unwrap_or(600),
                    },
                );
            }
            WordAssetCfg::EmbeddedImage {
                id,
                file_name,
                mime_type,
                base64_data,
                width_px,
                height_px,
            } => {
                let ext = detect_asset_extension(Some(mime_type.as_str()), None, Some(file_name));
                let final_name = if file_name.contains('.') {
                    file_name.clone()
                } else {
                    format!("{file_name}.{ext}")
                };
                let dest = media_dir.join(&final_name);
                let bytes = base64::decode(base64_data)
                    .map_err(|e| format!("解析内嵌图片 base64 失败: {e}"))?;
                std::fs::write(&dest, bytes)
                    .map_err(|e| format!("写入内嵌图片资源失败 {:?}: {e}", &dest))?;
                content_type_defaults
                    .entry(ext.clone())
                    .or_insert_with(|| mime_for_extension(&ext).to_string());
                let rel_id = next_relationship_id(render_state);
                render_state.image_assets.insert(
                    id.clone(),
                    WordAssetRuntime {
                        rel_id,
                        target: format!("media/{final_name}"),
                        width_px: width_px.unwrap_or(800),
                        height_px: height_px.unwrap_or(600),
                    },
                );
            }
        }
    }
    Ok(())
}

fn package_docx_workspace(work_dir: &Path, output_path: &Path) -> Result<(), String> {
    if output_path.exists() {
        std::fs::remove_file(output_path).map_err(|e| format!("删除旧输出文件失败: {e}"))?;
    }

    package_directory_as_zip(work_dir, output_path)
}

fn package_directory_as_zip(source_dir: &Path, output_path: &Path) -> Result<(), String> {
    let file =
        std::fs::File::create(output_path).map_err(|e| format!("创建 docx 输出文件失败: {e}"))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644);

    add_directory_to_zip(&mut zip, source_dir, source_dir, options)?;
    zip.finish()
        .map_err(|e| format!("完成 docx 打包失败: {e}"))?;
    Ok(())
}

fn add_directory_to_zip(
    zip: &mut ZipWriter<std::fs::File>,
    base_dir: &Path,
    current_dir: &Path,
    options: SimpleFileOptions,
) -> Result<(), String> {
    let entries =
        std::fs::read_dir(current_dir).map_err(|e| format!("读取导出工作目录失败: {e}"))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("读取导出条目失败: {e}"))?;
        let path = entry.path();
        let relative = path
            .strip_prefix(base_dir)
            .map_err(|e| format!("计算导出相对路径失败: {e}"))?;
        let zip_path = relative.to_string_lossy().replace('\\', "/");

        if path.is_dir() {
            let dir_name = if zip_path.ends_with('/') {
                zip_path
            } else {
                format!("{zip_path}/")
            };
            zip.add_directory(&dir_name, options)
                .map_err(|e| format!("写入 docx 目录失败 ({dir_name}): {e}"))?;
            add_directory_to_zip(zip, base_dir, &path, options)?;
            continue;
        }

        zip.start_file(&zip_path, options)
            .map_err(|e| format!("写入 docx 文件头失败 ({zip_path}): {e}"))?;
        let mut input = std::fs::File::open(&path)
            .map_err(|e| format!("读取导出文件失败 ({zip_path}): {e}"))?;
        std::io::copy(&mut input, zip)
            .map_err(|e| format!("写入 docx 文件失败 ({zip_path}): {e}"))?;
    }

    Ok(())
}

fn build_document_xml(
    payload: &WordDocPayloadCfg,
    render_state: &mut WordRenderState,
) -> Result<String, String> {
    let body = render_word_blocks(&payload.blocks, render_state, 0, None)?;
    let margin = render_state.style_settings.page_margin_twips;
    Ok(format!(
        concat!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#,
            r#"<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" "#,
            r#"xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" "#,
            r#"xmlns:o="urn:schemas-microsoft-com:office:office" "#,
            r#"xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" "#,
            r#"xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" "#,
            r#"xmlns:v="urn:schemas-microsoft-com:vml" "#,
            r#"xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" "#,
            r#"xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" "#,
            r#"xmlns:w10="urn:schemas-microsoft-com:office:word" "#,
            r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" "#,
            r#"xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" "#,
            r#"xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" "#,
            r#"xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" "#,
            r#"xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" "#,
            r#"xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" "#,
            r#"xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" "#,
            r#"xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" "#,
            r#"mc:Ignorable="w14 wp14"><w:body>{}"#,
            r#"<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="{}" w:right="{}" w:bottom="{}" w:left="{}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>"#,
            r#"</w:body></w:document>"#
        ),
        body, margin, margin, margin, margin
    ))
}

fn render_word_blocks(
    blocks: &[WordBlockCfg],
    render_state: &mut WordRenderState,
    quote_depth: usize,
    list_info: Option<(bool, usize)>,
) -> Result<String, String> {
    let mut xml = String::new();
    let mut first_list_consumed = false;
    for block in blocks {
        let current_list = if !first_list_consumed {
            list_info
        } else {
            None
        };
        if current_list.is_some() {
            first_list_consumed = true;
        }
        xml.push_str(&render_word_block(
            block,
            render_state,
            quote_depth,
            current_list,
        )?);
    }
    Ok(xml)
}

fn render_word_block(
    block: &WordBlockCfg,
    render_state: &mut WordRenderState,
    quote_depth: usize,
    list_info: Option<(bool, usize)>,
) -> Result<String, String> {
    match block {
        WordBlockCfg::Heading { level, text, style } => Ok(render_paragraph_xml(
            render_inline_runs_xml(text, render_state),
            Some(format!("Heading{}", (*level).clamp(1, 6))),
            style.as_ref(),
            quote_depth,
            list_info,
            false,
            false,
        )),
        WordBlockCfg::Paragraph { text, style } => Ok(render_paragraph_xml(
            render_inline_runs_xml(text, render_state),
            None,
            style.as_ref(),
            quote_depth,
            list_info,
            false,
            false,
        )),
        WordBlockCfg::Math { content, math_ml } => {
            let paragraph_style = left_aligned_math_paragraph_style();
            Ok(render_paragraph_xml(
                render_math_run_xml(content, math_ml.as_deref(), true),
                None,
                Some(&paragraph_style),
                quote_depth,
                list_info,
                false,
                true,
            ))
        }
        WordBlockCfg::Code {
            language: _,
            content,
        } => {
            let runs = render_code_runs_xml(
                content,
                render_state.style_settings.code_font_size_half_points,
            );
            Ok(render_paragraph_xml(
                runs,
                None,
                None,
                quote_depth,
                list_info,
                true,
                false,
            ))
        }
        WordBlockCfg::Image {
            asset_id,
            alt,
            width_px,
            height_px,
            width_percent,
            max_width_percent,
        } => Ok(render_image_paragraph_xml(RenderImageParagraphOptions {
            asset_id,
            alt: alt.as_deref(),
            width_px: *width_px,
            height_px: *height_px,
            width_percent: *width_percent,
            max_width_percent: *max_width_percent,
            render_state,
            quote_depth,
            list_info,
        })?),
        WordBlockCfg::Blockquote { children } => {
            render_word_blocks(children, render_state, quote_depth + 1, list_info)
        }
        WordBlockCfg::List { ordered, items } => {
            let mut xml = String::new();
            for item in items {
                xml.push_str(&render_word_blocks(
                    item,
                    render_state,
                    quote_depth,
                    Some((*ordered, quote_depth)),
                )?);
            }
            Ok(xml)
        }
        WordBlockCfg::Table { rows, style } => {
            render_table_xml(rows, style.as_ref(), render_state, quote_depth)
        }
    }
}

fn render_table_xml(
    rows: &[WordTableRowCfg],
    table_style: Option<&WordTableStyleCfg>,
    render_state: &mut WordRenderState,
    quote_depth: usize,
) -> Result<String, String> {
    let mut rows_xml = String::new();
    for row in rows {
        if row.cells.is_empty() {
            continue;
        }

        let mut normalized_cells = String::new();
        for cell in &row.cells {
            let cell_content = render_table_cell_blocks_xml(
                &cell.blocks,
                cell.style.as_ref(),
                render_state,
                quote_depth,
            )?;
            let content = if cell_content.trim().is_empty() {
                "<w:p/>".to_string()
            } else {
                cell_content
            };
            let tc_pr = render_table_cell_properties_xml(
                cell.style.as_ref(),
                cell.col_span,
                cell.row_span,
                cell.merge_continue,
            );
            normalized_cells.push_str(&format!("<w:tc>{}{}</w:tc>", tc_pr, content));
        }
        rows_xml.push_str(&format!("<w:tr>{}</w:tr>", normalized_cells));
    }

    Ok(format!(
        concat!(
            "<w:tbl>",
            r#"<w:tblPr>{}<w:tblBorders>"#,
            r#"<w:top w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/>"#,
            r#"<w:left w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/>"#,
            r#"<w:bottom w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/>"#,
            r#"<w:right w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/>"#,
            r#"<w:insideH w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/>"#,
            r#"<w:insideV w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/></w:tblBorders></w:tblPr>"#,
            "{}",
            "{}",
            "</w:tbl>"
        ),
        render_table_properties_xml(table_style, render_state.style_settings.page_margin_twips).0,
        render_table_grid_xml(table_style, render_state.style_settings.page_margin_twips),
        rows_xml
    ))
}

fn render_table_properties_xml(
    style: Option<&WordTableStyleCfg>,
    page_margin_twips: u32,
) -> (String, u32) {
    let mut tbl_pr = String::new();
    let (table_width, resolved_width_twips) = resolve_table_width_xml(style, page_margin_twips);
    tbl_pr.push_str(&table_width);

    if let Some(align) = style
        .and_then(|style| style.align.as_deref())
        .filter(|value| matches!(*value, "left" | "center" | "right"))
    {
        tbl_pr.push_str(&format!(r#"<w:jc w:val="{}"/>"#, align));
    }

    if let Some(layout) = style
        .and_then(|style| style.layout.as_deref())
        .filter(|value| matches!(*value, "fixed" | "auto"))
    {
        let layout = if layout == "auto" { "autofit" } else { "fixed" };
        tbl_pr.push_str(&format!(r#"<w:tblLayout w:type="{}"/>"#, layout));
    }

    (tbl_pr, resolved_width_twips)
}

fn resolve_table_width_xml(
    style: Option<&WordTableStyleCfg>,
    page_margin_twips: u32,
) -> (String, u32) {
    let Some(style) = style else {
        let body_twips = WORD_PAGE_WIDTH_TWIPS.saturating_sub(page_margin_twips * 2);
        return (r#"<w:tblW w:w="0" w:type="auto"/>"#.to_string(), body_twips);
    };

    let body_twips = WORD_PAGE_WIDTH_TWIPS.saturating_sub(page_margin_twips * 2);
    let max_percent = style
        .max_width_percent
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| value.min(100.0));

    if let Some(width_percent) = style
        .width_percent
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| value.min(100.0))
    {
        let width_percent = max_percent
            .map(|max| width_percent.min(max))
            .unwrap_or(width_percent);
        let pct = ((width_percent * 50.0).round() as u32).max(1);
        let resolved = ((body_twips as f32) * (width_percent / 100.0)).round() as u32;
        return (
            format!(r#"<w:tblW w:w="{}" w:type="pct"/>"#, pct),
            resolved.max(1),
        );
    }

    if let Some(width_px) = style.width_px.filter(|value| *value > 0) {
        let mut width_twips = width_px.saturating_mul(TWIPS_PER_PX_AT_96_DPI);
        if let Some(max_percent) = max_percent {
            let max_twips = ((body_twips as f32) * (max_percent / 100.0)).round() as u32;
            width_twips = width_twips.min(max_twips.max(1));
        }
        let width_twips = width_twips.max(1);
        return (
            format!(r#"<w:tblW w:w="{}" w:type="dxa"/>"#, width_twips),
            width_twips,
        );
    }

    (r#"<w:tblW w:w="0" w:type="auto"/>"#.to_string(), body_twips)
}

fn render_table_grid_xml(style: Option<&WordTableStyleCfg>, page_margin_twips: u32) -> String {
    let Some(style) = style else {
        return String::new();
    };
    let Some(column_widths) = style
        .column_widths
        .as_ref()
        .filter(|widths| !widths.is_empty())
    else {
        return String::new();
    };

    let (_, table_width_twips) = resolve_table_width_xml(Some(style), page_margin_twips);
    let mut cols_xml = String::new();
    let mut has_any = false;
    for width in column_widths {
        if let Some(grid_width) = resolve_table_column_width_twips(width, table_width_twips) {
            has_any = true;
            cols_xml.push_str(&format!(r#"<w:gridCol w:w="{}"/>"#, grid_width.max(1)));
        }
    }

    if has_any {
        format!("<w:tblGrid>{}</w:tblGrid>", cols_xml)
    } else {
        String::new()
    }
}

fn resolve_table_column_width_twips(
    width: &WordTableColumnWidthCfg,
    table_width_twips: u32,
) -> Option<u32> {
    if let Some(width_percent) = width
        .width_percent
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| value.min(100.0))
    {
        let twips = ((table_width_twips as f32) * (width_percent / 100.0)).round() as u32;
        return Some(twips.max(1));
    }

    width
        .width_px
        .filter(|value| *value > 0)
        .map(|value| value.saturating_mul(TWIPS_PER_PX_AT_96_DPI).max(1))
}

fn render_table_cell_blocks_xml(
    blocks: &[WordBlockCfg],
    cell_style: Option<&WordTableCellStyleCfg>,
    render_state: &mut WordRenderState,
    quote_depth: usize,
) -> Result<String, String> {
    let mut xml = String::new();
    for block in blocks {
        xml.push_str(&render_word_block_in_table_cell(
            block,
            cell_style,
            render_state,
            quote_depth,
            None,
        )?);
    }
    Ok(xml)
}

fn render_word_block_in_table_cell(
    block: &WordBlockCfg,
    cell_style: Option<&WordTableCellStyleCfg>,
    render_state: &mut WordRenderState,
    quote_depth: usize,
    list_info: Option<(bool, usize)>,
) -> Result<String, String> {
    let cell_paragraph_style = cell_style.and_then(table_cell_style_to_paragraph_style);
    match block {
        WordBlockCfg::Heading { level, text, style } => {
            let merged_style = merge_paragraph_style(style.as_ref(), cell_paragraph_style.as_ref());
            Ok(render_paragraph_xml(
                render_inline_runs_xml(text, render_state),
                Some(format!("Heading{}", (*level).clamp(1, 6))),
                merged_style.as_ref(),
                quote_depth,
                list_info,
                false,
                false,
            ))
        }
        WordBlockCfg::Paragraph { text, style } => {
            let merged_style = merge_paragraph_style(style.as_ref(), cell_paragraph_style.as_ref());
            Ok(render_paragraph_xml(
                render_inline_runs_xml(text, render_state),
                None,
                merged_style.as_ref(),
                quote_depth,
                list_info,
                false,
                false,
            ))
        }
        WordBlockCfg::Blockquote { children } => {
            let mut xml = String::new();
            for child in children {
                xml.push_str(&render_word_block_in_table_cell(
                    child,
                    cell_style,
                    render_state,
                    quote_depth + 1,
                    list_info,
                )?);
            }
            Ok(xml)
        }
        WordBlockCfg::List { ordered, items } => {
            let mut xml = String::new();
            for item in items {
                for child in item {
                    xml.push_str(&render_word_block_in_table_cell(
                        child,
                        cell_style,
                        render_state,
                        quote_depth,
                        Some((*ordered, quote_depth)),
                    )?);
                }
            }
            Ok(xml)
        }
        _ => render_word_block(block, render_state, quote_depth, list_info),
    }
}

fn render_table_cell_properties_xml(
    style: Option<&WordTableCellStyleCfg>,
    col_span: Option<u32>,
    row_span: Option<u32>,
    merge_continue: Option<bool>,
) -> String {
    let mut tc_pr = String::new();
    if let Some(col_span) = col_span.filter(|value| *value > 1) {
        tc_pr.push_str(&format!(r#"<w:gridSpan w:val="{}"/>"#, col_span));
    }
    if merge_continue.unwrap_or(false) {
        tc_pr.push_str(r#"<w:vMerge/>"#);
    } else if row_span.unwrap_or(1) > 1 {
        tc_pr.push_str(r#"<w:vMerge w:val="restart"/>"#);
    }
    if let Some(style) = style {
        if let Some(background_color) = style
            .background_color
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            tc_pr.push_str(&format!(
                r#"<w:shd w:val="clear" w:color="auto" w:fill="{}"/>"#,
                escape_xml_attr(background_color)
            ));
        }
        if let Some(border_color) = style
            .border_color
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            let border_color = escape_xml_attr(border_color);
            tc_pr.push_str(&format!(
                concat!(
                    r#"<w:tcBorders>"#,
                    r#"<w:top w:val="single" w:sz="4" w:space="0" w:color="{0}"/>"#,
                    r#"<w:left w:val="single" w:sz="4" w:space="0" w:color="{0}"/>"#,
                    r#"<w:bottom w:val="single" w:sz="4" w:space="0" w:color="{0}"/>"#,
                    r#"<w:right w:val="single" w:sz="4" w:space="0" w:color="{0}"/>"#,
                    r#"</w:tcBorders>"#
                ),
                border_color
            ));
        } else {
            let top = style
                .border_top_color
                .as_deref()
                .filter(|value| !value.trim().is_empty());
            let right = style
                .border_right_color
                .as_deref()
                .filter(|value| !value.trim().is_empty());
            let bottom = style
                .border_bottom_color
                .as_deref()
                .filter(|value| !value.trim().is_empty());
            let left = style
                .border_left_color
                .as_deref()
                .filter(|value| !value.trim().is_empty());

            if top.is_some() || right.is_some() || bottom.is_some() || left.is_some() {
                tc_pr.push_str("<w:tcBorders>");
                if let Some(color) = top {
                    tc_pr.push_str(&format!(
                        r#"<w:top w:val="single" w:sz="4" w:space="0" w:color="{}"/>"#,
                        escape_xml_attr(color)
                    ));
                }
                if let Some(color) = left {
                    tc_pr.push_str(&format!(
                        r#"<w:left w:val="single" w:sz="4" w:space="0" w:color="{}"/>"#,
                        escape_xml_attr(color)
                    ));
                }
                if let Some(color) = bottom {
                    tc_pr.push_str(&format!(
                        r#"<w:bottom w:val="single" w:sz="4" w:space="0" w:color="{}"/>"#,
                        escape_xml_attr(color)
                    ));
                }
                if let Some(color) = right {
                    tc_pr.push_str(&format!(
                        r#"<w:right w:val="single" w:sz="4" w:space="0" w:color="{}"/>"#,
                        escape_xml_attr(color)
                    ));
                }
                tc_pr.push_str("</w:tcBorders>");
            }
        }
    }

    if tc_pr.is_empty() {
        "<w:tcPr/>".to_string()
    } else {
        format!("<w:tcPr>{}</w:tcPr>", tc_pr)
    }
}

fn table_cell_style_to_paragraph_style(
    style: &WordTableCellStyleCfg,
) -> Option<WordParagraphStyleCfg> {
    let align = style
        .align
        .as_deref()
        .filter(|value| matches!(*value, "left" | "center" | "right" | "justify"))
        .map(|value| value.to_string());

    align.as_ref()?;

    Some(WordParagraphStyleCfg {
        align,
        line_height: None,
        spacing_after_pt: None,
        background_color: None,
        border_color: None,
        border_top_color: None,
        border_right_color: None,
        border_bottom_color: None,
        border_left_color: None,
    })
}

fn merge_paragraph_style(
    base: Option<&WordParagraphStyleCfg>,
    fallback: Option<&WordParagraphStyleCfg>,
) -> Option<WordParagraphStyleCfg> {
    match (base, fallback) {
        (None, None) => None,
        (Some(base), None) => Some(base.clone()),
        (None, Some(fallback)) => Some(fallback.clone()),
        (Some(base), Some(fallback)) => Some(WordParagraphStyleCfg {
            align: base.align.clone().or_else(|| fallback.align.clone()),
            line_height: base.line_height.or(fallback.line_height),
            spacing_after_pt: base.spacing_after_pt.or(fallback.spacing_after_pt),
            background_color: base
                .background_color
                .clone()
                .or_else(|| fallback.background_color.clone()),
            border_color: base
                .border_color
                .clone()
                .or_else(|| fallback.border_color.clone()),
            border_top_color: base
                .border_top_color
                .clone()
                .or_else(|| fallback.border_top_color.clone()),
            border_right_color: base
                .border_right_color
                .clone()
                .or_else(|| fallback.border_right_color.clone()),
            border_bottom_color: base
                .border_bottom_color
                .clone()
                .or_else(|| fallback.border_bottom_color.clone()),
            border_left_color: base
                .border_left_color
                .clone()
                .or_else(|| fallback.border_left_color.clone()),
        }),
    }
}

fn render_paragraph_xml(
    content_xml: String,
    style: Option<String>,
    paragraph_style: Option<&WordParagraphStyleCfg>,
    quote_depth: usize,
    list_info: Option<(bool, usize)>,
    code_block: bool,
    center: bool,
) -> String {
    let mut ppr = String::new();
    if let Some(style_id) = style {
        ppr.push_str(&format!(r#"<w:pStyle w:val="{}"/>"#, style_id));
    }
    if let Some((ordered, level)) = list_info {
        ppr.push_str(&format!(
            r#"<w:numPr><w:ilvl w:val="{}"/><w:numId w:val="{}"/></w:numPr>"#,
            level,
            if ordered { 2 } else { 1 }
        ));
    }
    if quote_depth > 0 || code_block {
        let left = (quote_depth as i32 * 720 + if code_block { 360 } else { 0 }).max(0);
        ppr.push_str(&format!(r#"<w:ind w:left="{}"/>"#, left));
    }
    if quote_depth > 0 {
        ppr.push_str(
            r#"<w:pBdr><w:left w:val="single" w:sz="8" w:space="8" w:color="C9CDD1"/></w:pBdr>"#,
        );
    }
    if code_block {
        ppr.push_str(r#"<w:shd w:val="clear" w:color="auto" w:fill="F6F8FA"/>"#);
    }
    if let Some(paragraph_style) = paragraph_style {
        if let Some(align) = paragraph_style.align.as_deref() {
            if matches!(align, "left" | "center" | "right" | "justify") {
                ppr.push_str(&format!(r#"<w:jc w:val="{}"/>"#, align));
            }
        }
        if paragraph_style.line_height.is_some() || paragraph_style.spacing_after_pt.is_some() {
            let after = paragraph_style
                .spacing_after_pt
                .map(pt_to_twips)
                .unwrap_or(render_state_default_spacing_after_twips());
            let line = paragraph_style
                .line_height
                .map(line_spacing_to_twips)
                .unwrap_or(render_state_default_line_spacing_twips());
            ppr.push_str(&format!(
                r#"<w:spacing w:after="{}" w:line="{}" w:lineRule="auto"/>"#,
                after, line
            ));
        }
        if let Some(background_color) = paragraph_style
            .background_color
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            ppr.push_str(&format!(
                r#"<w:shd w:val="clear" w:color="auto" w:fill="{}"/>"#,
                escape_xml_attr(background_color)
            ));
        }
        let border_xml = render_paragraph_border_xml(paragraph_style);
        if !border_xml.is_empty() {
            ppr.push_str(&border_xml);
        }
    }
    if center && !ppr.contains("<w:jc") {
        ppr.push_str(r#"<w:jc w:val="center"/>"#);
    }
    let ppr_xml = if ppr.is_empty() {
        String::new()
    } else {
        format!("<w:pPr>{}</w:pPr>", ppr)
    };
    format!("<w:p>{}{}</w:p>", ppr_xml, content_xml)
}

fn render_state_default_spacing_after_twips() -> u32 {
    pt_to_twips(8.0)
}

fn render_state_default_line_spacing_twips() -> u32 {
    line_spacing_to_twips(1.25)
}

fn render_paragraph_border_xml(style: &WordParagraphStyleCfg) -> String {
    if let Some(border_color) = style
        .border_color
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        let border_color = escape_xml_attr(border_color);
        return format!(
            concat!(
                r#"<w:pBdr>"#,
                r#"<w:top w:val="single" w:sz="4" w:space="0" w:color="{0}"/>"#,
                r#"<w:left w:val="single" w:sz="4" w:space="0" w:color="{0}"/>"#,
                r#"<w:bottom w:val="single" w:sz="4" w:space="0" w:color="{0}"/>"#,
                r#"<w:right w:val="single" w:sz="4" w:space="0" w:color="{0}"/>"#,
                r#"</w:pBdr>"#
            ),
            border_color
        );
    }

    let top = style
        .border_top_color
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    let right = style
        .border_right_color
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    let bottom = style
        .border_bottom_color
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    let left = style
        .border_left_color
        .as_deref()
        .filter(|value| !value.trim().is_empty());

    if top.is_none() && right.is_none() && bottom.is_none() && left.is_none() {
        return String::new();
    }

    let mut xml = String::from("<w:pBdr>");
    if let Some(color) = top {
        xml.push_str(&format!(
            r#"<w:top w:val="single" w:sz="4" w:space="0" w:color="{}"/>"#,
            escape_xml_attr(color)
        ));
    }
    if let Some(color) = left {
        xml.push_str(&format!(
            r#"<w:left w:val="single" w:sz="4" w:space="0" w:color="{}"/>"#,
            escape_xml_attr(color)
        ));
    }
    if let Some(color) = bottom {
        xml.push_str(&format!(
            r#"<w:bottom w:val="single" w:sz="4" w:space="0" w:color="{}"/>"#,
            escape_xml_attr(color)
        ));
    }
    if let Some(color) = right {
        xml.push_str(&format!(
            r#"<w:right w:val="single" w:sz="4" w:space="0" w:color="{}"/>"#,
            escape_xml_attr(color)
        ));
    }
    xml.push_str("</w:pBdr>");
    xml
}

fn render_inline_runs_xml(runs: &[WordInlineRunCfg], render_state: &mut WordRenderState) -> String {
    let mut xml = String::new();
    for run in runs {
        match run {
            WordInlineRunCfg::Text {
                value,
                bold,
                italic,
                code,
                strike,
                underline,
                color,
                background_color,
                font_size_pt,
                font_family,
            } => {
                xml.push_str(&render_text_run_xml(RenderTextRunOptions {
                    value,
                    bold: bold.unwrap_or(false),
                    italic: italic.unwrap_or(false),
                    code: code.unwrap_or(false),
                    strike: strike.unwrap_or(false),
                    underline: underline.unwrap_or(false),
                    color: color.as_deref(),
                    background_color: background_color.as_deref(),
                    font_size_pt: *font_size_pt,
                    font_family: font_family.as_deref(),
                    code_font_size_half_points: render_state
                        .style_settings
                        .code_font_size_half_points,
                }));
            }
            WordInlineRunCfg::Math { value, math_ml } => {
                xml.push_str(&render_math_run_xml(value, math_ml.as_deref(), false));
            }
            WordInlineRunCfg::Link { value, href } => {
                let rel_id = next_relationship_id(render_state);
                render_state.hyperlinks.push((rel_id.clone(), href.clone()));
                xml.push_str(&format!(
                    r#"<w:hyperlink r:id="{}" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t xml:space="preserve">{}</w:t></w:r></w:hyperlink>"#,
                    rel_id,
                    escape_xml_text(value)
                ));
            }
        }
    }
    xml
}

struct RenderTextRunOptions<'a> {
    value: &'a str,
    bold: bool,
    italic: bool,
    code: bool,
    strike: bool,
    underline: bool,
    color: Option<&'a str>,
    background_color: Option<&'a str>,
    font_size_pt: Option<f32>,
    font_family: Option<&'a str>,
    code_font_size_half_points: u32,
}

fn render_text_run_xml(options: RenderTextRunOptions<'_>) -> String {
    let RenderTextRunOptions {
        value,
        bold,
        italic,
        code,
        strike,
        underline,
        color,
        background_color,
        font_size_pt,
        font_family,
        code_font_size_half_points,
    } = options;
    let mut rpr = String::new();
    if bold {
        rpr.push_str("<w:b/>");
    }
    if italic {
        rpr.push_str("<w:i/>");
    }
    if strike {
        rpr.push_str("<w:strike/>");
    }
    if underline {
        rpr.push_str(r#"<w:u w:val="single"/>"#);
    }
    if let Some(color) = color.filter(|value| !value.trim().is_empty()) {
        rpr.push_str(&format!(r#"<w:color w:val="{}"/>"#, escape_xml_attr(color)));
    }
    if let Some(background_color) = background_color.filter(|value| !value.trim().is_empty()) {
        rpr.push_str(&format!(
            r#"<w:shd w:val="clear" w:color="auto" w:fill="{}"/>"#,
            escape_xml_attr(background_color)
        ));
    }
    if let Some(font_family) = font_family.filter(|value| !value.trim().is_empty()) {
        let font_family = escape_xml_attr(font_family);
        rpr.push_str(&format!(
            r#"<w:rFonts w:ascii="{0}" w:hAnsi="{0}" w:cs="{0}"/>"#,
            font_family
        ));
    }
    if let Some(font_size_half_points) = font_size_pt_to_half_points(font_size_pt) {
        rpr.push_str(&format!(r#"<w:sz w:val="{}"/>"#, font_size_half_points));
    }
    if code {
        rpr.push_str(&format!(
            r#"<w:rFonts w:ascii="Menlo" w:hAnsi="Menlo" w:cs="Menlo"/><w:sz w:val="{}"/><w:shd w:val="clear" w:color="auto" w:fill="F6F8FA"/>"#,
            code_font_size_half_points
        ));
    }
    let rpr_xml = if rpr.is_empty() {
        String::new()
    } else {
        format!("<w:rPr>{}</w:rPr>", rpr)
    };
    let mut body = String::new();
    let segments: Vec<&str> = value.split('\n').collect();
    for (idx, segment) in segments.iter().enumerate() {
        if idx > 0 {
            body.push_str("<w:br/>");
        }
        body.push_str(&format!(
            r#"<w:t xml:space="preserve">{}</w:t>"#,
            escape_xml_text(segment)
        ));
    }
    format!("<w:r>{}{}</w:r>", rpr_xml, body)
}

fn render_code_runs_xml(content: &str, code_font_size_half_points: u32) -> String {
    render_text_run_xml(RenderTextRunOptions {
        value: content,
        bold: false,
        italic: false,
        code: true,
        strike: false,
        underline: false,
        color: None,
        background_color: None,
        font_size_pt: None,
        font_family: None,
        code_font_size_half_points,
    })
}

fn font_size_pt_to_half_points(size_pt: Option<f32>) -> Option<u32> {
    let value = size_pt?;
    if !value.is_finite() || value <= 0.0 {
        return None;
    }
    Some((value * 2.0).round() as u32)
}

#[derive(Debug, Clone, Default)]
struct MathMlNode {
    name: String,
    text: String,
    attrs: HashMap<String, String>,
    children: Vec<MathMlNode>,
}

fn render_math_run_xml(value: &str, math_ml: Option<&str>, display_mode: bool) -> String {
    if let Some(math_ml) = math_ml {
        if let Ok(omml) = mathml_to_omml(math_ml) {
            return format!(r#"<m:oMath>{}</m:oMath>"#, omml);
        }
    }

    let mut rpr = String::from(
        r#"<w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math" w:cs="Cambria Math"/>"#,
    );
    if display_mode {
        rpr.push_str(r#"<w:sz w:val="24"/>"#);
    }
    let rpr_xml = format!("<w:rPr>{}</w:rPr>", rpr);
    format!(
        r#"<w:r>{}<w:t xml:space="preserve">{}</w:t></w:r>"#,
        rpr_xml,
        escape_xml_text(value)
    )
}

fn mathml_to_omml(math_ml: &str) -> Result<String, String> {
    let root = parse_mathml(math_ml)?;
    let math_root = find_math_expression_root(&root);
    Ok(convert_mathml_node(math_root))
}

fn parse_mathml(math_ml: &str) -> Result<MathMlNode, String> {
    let mut reader = Reader::from_str(math_ml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    let mut stack: Vec<MathMlNode> = Vec::new();
    let mut root: Option<MathMlNode> = None;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(event)) => {
                let mut attrs = HashMap::new();
                for attr in event.attributes().flatten() {
                    let key = String::from_utf8_lossy(attr.key.local_name().as_ref()).to_string();
                    let value = attr
                        .decode_and_unescape_value(reader.decoder())
                        .map_err(|e| format!("解析 MathML 属性失败: {e}"))?
                        .into_owned();
                    attrs.insert(key, value);
                }
                stack.push(MathMlNode {
                    name: String::from_utf8_lossy(event.local_name().as_ref()).to_string(),
                    attrs,
                    ..Default::default()
                });
            }
            Ok(Event::Empty(event)) => {
                let mut attrs = HashMap::new();
                for attr in event.attributes().flatten() {
                    let key = String::from_utf8_lossy(attr.key.local_name().as_ref()).to_string();
                    let value = attr
                        .decode_and_unescape_value(reader.decoder())
                        .map_err(|e| format!("解析 MathML 属性失败: {e}"))?
                        .into_owned();
                    attrs.insert(key, value);
                }
                let node = MathMlNode {
                    name: String::from_utf8_lossy(event.local_name().as_ref()).to_string(),
                    attrs,
                    ..Default::default()
                };
                if let Some(parent) = stack.last_mut() {
                    parent.children.push(node);
                } else {
                    root = Some(node);
                }
            }
            Ok(Event::Text(event)) => {
                if let Some(current) = stack.last_mut() {
                    let text = event
                        .decode()
                        .map_err(|e| format!("解析 MathML 文本失败: {e}"))?;
                    current.text.push_str(&text);
                }
            }
            Ok(Event::CData(event)) => {
                if let Some(current) = stack.last_mut() {
                    let text = event
                        .decode()
                        .map_err(|e| format!("解析 MathML CDATA 失败: {e}"))?;
                    current.text.push_str(&text);
                }
            }
            Ok(Event::End(_)) => {
                if let Some(node) = stack.pop() {
                    if let Some(parent) = stack.last_mut() {
                        parent.children.push(node);
                    } else {
                        root = Some(node);
                    }
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(err) => return Err(format!("解析 MathML 失败: {err}")),
        }
        buf.clear();
    }

    root.ok_or_else(|| "MathML 为空".to_string())
}

fn find_math_expression_root(node: &MathMlNode) -> &MathMlNode {
    match node.name.as_str() {
        "math" => node
            .children
            .iter()
            .find(|child| child.name == "semantics")
            .and_then(|semantics| {
                semantics
                    .children
                    .iter()
                    .find(|child| child.name != "annotation")
            })
            .or_else(|| {
                node.children
                    .iter()
                    .find(|child| child.name != "annotation")
            })
            .unwrap_or(node),
        "semantics" => node
            .children
            .iter()
            .find(|child| child.name != "annotation")
            .unwrap_or(node),
        _ => node,
    }
}

fn convert_mathml_node(node: &MathMlNode) -> String {
    match node.name.as_str() {
        "math" | "semantics" => node
            .children
            .iter()
            .map(convert_mathml_node)
            .collect::<Vec<_>>()
            .join(""),
        "mtable" => convert_mathml_table(node),
        "mtr" | "mlabeledtr" => convert_mathml_table_row(node, &[]),
        "mtd" => convert_mathml_table_cell(node),
        "mrow" => convert_mathml_row(node),
        "annotation" => String::new(),
        "mi" | "mn" | "mo" | "mtext" => render_omml_text_run(&collect_mathml_text(node)),
        "msup" => {
            let base = node
                .children
                .first()
                .map(convert_mathml_node)
                .unwrap_or_default();
            let sup = node
                .children
                .get(1)
                .map(convert_mathml_node)
                .unwrap_or_default();
            format!(
                r#"<m:sSup><m:e>{}</m:e><m:sup>{}</m:sup></m:sSup>"#,
                base, sup
            )
        }
        "msub" => {
            let base = node
                .children
                .first()
                .map(convert_mathml_node)
                .unwrap_or_default();
            let sub = node
                .children
                .get(1)
                .map(convert_mathml_node)
                .unwrap_or_default();
            format!(
                r#"<m:sSub><m:e>{}</m:e><m:sub>{}</m:sub></m:sSub>"#,
                base, sub
            )
        }
        "msubsup" => {
            let base = node
                .children
                .first()
                .map(convert_mathml_node)
                .unwrap_or_default();
            let sub = node
                .children
                .get(1)
                .map(convert_mathml_node)
                .unwrap_or_default();
            let sup = node
                .children
                .get(2)
                .map(convert_mathml_node)
                .unwrap_or_default();
            format!(
                r#"<m:sSubSup><m:e>{}</m:e><m:sub>{}</m:sub><m:sup>{}</m:sup></m:sSubSup>"#,
                base, sub, sup
            )
        }
        "mfrac" => {
            let num = node
                .children
                .first()
                .map(convert_mathml_node)
                .unwrap_or_default();
            let den = node
                .children
                .get(1)
                .map(convert_mathml_node)
                .unwrap_or_default();
            format!(r#"<m:f><m:num>{}</m:num><m:den>{}</m:den></m:f>"#, num, den)
        }
        "msqrt" => {
            let body = node
                .children
                .iter()
                .map(convert_mathml_node)
                .collect::<Vec<_>>()
                .join("");
            format!(
                r#"<m:rad><m:degHide m:val="1"/><m:e>{}</m:e></m:rad>"#,
                body
            )
        }
        "mroot" => {
            let body = node
                .children
                .first()
                .map(convert_mathml_node)
                .unwrap_or_default();
            let degree = node
                .children
                .get(1)
                .map(convert_mathml_node)
                .unwrap_or_default();
            format!(
                r#"<m:rad><m:deg>{}</m:deg><m:e>{}</m:e></m:rad>"#,
                degree, body
            )
        }
        "munderover" => render_nary_or_limit(node, true, true, &[]),
        "munder" => render_nary_or_limit(node, true, false, &[]),
        "mover" => render_nary_or_limit(node, false, true, &[]),
        _ => {
            if !node.children.is_empty() {
                node.children
                    .iter()
                    .map(convert_mathml_node)
                    .collect::<Vec<_>>()
                    .join("")
            } else {
                render_omml_text_run(&collect_mathml_text(node))
            }
        }
    }
}

fn convert_mathml_table(node: &MathMlNode) -> String {
    let raw_rows = node
        .children
        .iter()
        .filter(|child| matches!(child.name.as_str(), "mtr" | "mlabeledtr"))
        .collect::<Vec<_>>();

    let keep_columns = meaningful_table_columns(&raw_rows);
    let rows = raw_rows
        .iter()
        .map(|row| convert_mathml_table_row(row, &keep_columns))
        .filter(|row| !row.is_empty())
        .collect::<Vec<_>>();

    if rows.is_empty() {
        return node
            .children
            .iter()
            .map(convert_mathml_node)
            .collect::<Vec<_>>()
            .join("");
    }

    if rows.len() == 1 {
        return rows.into_iter().next().unwrap_or_default();
    }

    let alignments = column_alignments(node, &keep_columns);
    let columns_xml = alignments
        .iter()
        .map(|align| {
            format!(
                r#"<m:mc><m:mcPr><m:count m:val="1"/><m:mcJc m:val="{}"/></m:mcPr></m:mc>"#,
                escape_xml_attr(align)
            )
        })
        .collect::<Vec<_>>()
        .join("");

    let rows_xml = rows
        .into_iter()
        .map(|row| format!("<m:mr>{}</m:mr>", row))
        .collect::<Vec<_>>()
        .join("");

    format!(
        concat!(
            r#"<m:m><m:mPr><m:mcs>{}</m:mcs>"#,
            r#"<m:cGp m:val="60"/><m:cGpRule m:val="3"/><m:plcHide m:val="1"/>"#,
            r#"</m:mPr>{}</m:m>"#
        ),
        columns_xml, rows_xml
    )
}

fn convert_mathml_table_row(node: &MathMlNode, keep_columns: &[usize]) -> String {
    let source_cells = node
        .children
        .iter()
        .filter(|child| child.name == "mtd")
        .collect::<Vec<_>>();

    if source_cells.is_empty() {
        return node
            .children
            .iter()
            .map(convert_mathml_node)
            .filter(|segment| !segment.is_empty())
            .collect::<Vec<_>>()
            .join("");
    }

    let indices = if keep_columns.is_empty() {
        (0..source_cells.len()).collect::<Vec<_>>()
    } else {
        keep_columns.to_vec()
    };

    indices
        .into_iter()
        .map(|index| {
            let content = source_cells
                .get(index)
                .map(|cell| convert_mathml_table_cell(cell))
                .unwrap_or_default();
            format!("<m:e>{}</m:e>", content)
        })
        .collect::<Vec<_>>()
        .join("")
}

fn convert_mathml_table_cell(node: &MathMlNode) -> String {
    node.children
        .iter()
        .map(convert_mathml_node)
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("")
}

fn meaningful_table_columns(rows: &[&MathMlNode]) -> Vec<usize> {
    let max_cols = rows
        .iter()
        .map(|row| {
            row.children
                .iter()
                .filter(|child| child.name == "mtd")
                .count()
        })
        .max()
        .unwrap_or(0);

    (0..max_cols)
        .filter(|index| {
            rows.iter().any(|row| {
                row.children
                    .iter()
                    .filter(|child| child.name == "mtd")
                    .nth(*index)
                    .map(|cell| !is_mathml_cell_empty(cell))
                    .unwrap_or(false)
            })
        })
        .collect()
}

fn is_mathml_cell_empty(node: &MathMlNode) -> bool {
    if !node.text.trim().is_empty() {
        return false;
    }

    if node.name == "mtd" {
        return node.children.iter().all(is_mathml_cell_empty);
    }

    if matches!(
        node.name.as_str(),
        "mrow" | "mstyle" | "mpadded" | "mphantom" | "semantics"
    ) {
        return node.children.iter().all(is_mathml_cell_empty);
    }

    node.children.is_empty()
}

fn column_alignments(node: &MathMlNode, keep_columns: &[usize]) -> Vec<&'static str> {
    let source = node
        .attrs
        .get("columnalign")
        .map(|value| {
            value
                .split_whitespace()
                .map(|part| match part {
                    "left" => "left",
                    "right" => "right",
                    "center" => "center",
                    _ => "left",
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if !source.is_empty() && source.len() == keep_columns.len() {
        return source;
    }

    let indices = if keep_columns.is_empty() {
        (0..source.len().max(1)).collect::<Vec<_>>()
    } else {
        keep_columns.to_vec()
    };

    indices
        .into_iter()
        .map(|index| source.get(index).copied().unwrap_or("left"))
        .collect()
}

fn convert_mathml_row(node: &MathMlNode) -> String {
    let mut xml = String::new();
    let mut index = 0;
    while index < node.children.len() {
        let child = &node.children[index];
        if is_nary_node(child) {
            let body_nodes = &node.children[index + 1..];
            xml.push_str(&render_nary_or_limit(
                child,
                matches!(child.name.as_str(), "munderover" | "munder"),
                matches!(child.name.as_str(), "munderover" | "mover"),
                body_nodes,
            ));
            break;
        }

        xml.push_str(&convert_mathml_node(child));
        index += 1;
    }
    xml
}

fn render_nary_or_limit(
    node: &MathMlNode,
    has_sub: bool,
    has_sup: bool,
    body_nodes: &[MathMlNode],
) -> String {
    let base = node.children.first().cloned().unwrap_or_default();
    let operator = collect_mathml_text(&base);
    let is_nary = matches!(operator.as_str(), "∑" | "∏" | "∫" | "⋂" | "⋃");

    if is_nary {
        let sub = if has_sub {
            node.children
                .get(1)
                .map(convert_mathml_node)
                .unwrap_or_default()
        } else {
            String::new()
        };
        let sup = if has_sup {
            let sup_index = if has_sub { 2 } else { 1 };
            node.children
                .get(sup_index)
                .map(convert_mathml_node)
                .unwrap_or_default()
        } else {
            String::new()
        };
        return format!(
            concat!(
                r#"<m:nary><m:naryPr><m:chr m:val="{}"/><m:limLoc m:val="undOvr"/></m:naryPr>"#,
                r#"<m:sub>{}</m:sub><m:sup>{}</m:sup><m:e>{}</m:e></m:nary>"#
            ),
            escape_xml_attr(&operator),
            sub,
            sup,
            body_nodes
                .iter()
                .map(convert_mathml_node)
                .collect::<Vec<_>>()
                .join("")
        );
    }

    let base_xml = convert_mathml_node(&base);
    match (has_sub, has_sup) {
        (true, true) => format!(
            r#"<m:sSubSup><m:e>{}</m:e><m:sub>{}</m:sub><m:sup>{}</m:sup></m:sSubSup>"#,
            base_xml,
            node.children
                .get(1)
                .map(convert_mathml_node)
                .unwrap_or_default(),
            node.children
                .get(2)
                .map(convert_mathml_node)
                .unwrap_or_default()
        ),
        (true, false) => format!(
            r#"<m:sSub><m:e>{}</m:e><m:sub>{}</m:sub></m:sSub>"#,
            base_xml,
            node.children
                .get(1)
                .map(convert_mathml_node)
                .unwrap_or_default()
        ),
        (false, true) => format!(
            r#"<m:sSup><m:e>{}</m:e><m:sup>{}</m:sup></m:sSup>"#,
            base_xml,
            node.children
                .get(1)
                .map(convert_mathml_node)
                .unwrap_or_default()
        ),
        (false, false) => base_xml,
    }
}

fn is_nary_node(node: &MathMlNode) -> bool {
    matches!(node.name.as_str(), "munderover" | "munder" | "mover")
        && matches!(
            collect_mathml_text(node.children.first().unwrap_or(&MathMlNode::default())).as_str(),
            "∑" | "∏" | "∫" | "⋂" | "⋃"
        )
}

fn collect_mathml_text(node: &MathMlNode) -> String {
    let mut text = node.text.clone();
    for child in &node.children {
        text.push_str(&collect_mathml_text(child));
    }
    text
}

fn render_omml_text_run(text: &str) -> String {
    if text.is_empty() {
        return String::new();
    }
    format!(r#"<m:r><m:t>{}</m:t></m:r>"#, escape_xml_text(text))
}

const WORD_PAGE_WIDTH_TWIPS: u32 = 11906;
const WORD_IMAGE_WIDTH_RATIO_NUM: u32 = 92;
const WORD_IMAGE_WIDTH_RATIO_DEN: u32 = 100;
const TWIPS_PER_PX_AT_96_DPI: u32 = 15;

struct RenderImageParagraphOptions<'a> {
    asset_id: &'a str,
    alt: Option<&'a str>,
    width_px: Option<u32>,
    height_px: Option<u32>,
    width_percent: Option<f32>,
    max_width_percent: Option<f32>,
    render_state: &'a mut WordRenderState,
    quote_depth: usize,
    list_info: Option<(bool, usize)>,
}

fn render_image_paragraph_xml(options: RenderImageParagraphOptions<'_>) -> Result<String, String> {
    let RenderImageParagraphOptions {
        asset_id,
        alt,
        width_px,
        height_px,
        width_percent,
        max_width_percent,
        render_state,
        quote_depth,
        list_info,
    } = options;
    let asset = render_state
        .image_assets
        .get(asset_id)
        .ok_or_else(|| format!("缺少图片资源: {asset_id}"))?;
    let (width, height) = resolve_image_dimensions(
        width_px.unwrap_or(asset.width_px).max(1),
        height_px.unwrap_or(asset.height_px).max(1),
        width_percent,
        max_width_percent,
        quote_depth,
        list_info.map(|(_, level)| level),
        render_state.style_settings.page_margin_twips,
    );
    let cx = width as u64 * 9525;
    let cy = height as u64 * 9525;
    let doc_pr_id = render_state.next_doc_pr_id;
    render_state.next_doc_pr_id += 1;

    let drawing = format!(
        concat!(
            r#"<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">"#,
            r#"<wp:extent cx="{}" cy="{}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>"#,
            r#"<wp:docPr id="{}" name="{}" descr="{}"/>"#,
            r#"<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>"#,
            r#"<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">"#,
            r#"<pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="{}"/><pic:cNvPicPr/></pic:nvPicPr>"#,
            r#"<pic:blipFill><a:blip r:embed="{}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>"#,
            r#"<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{}" cy="{}"/></a:xfrm>"#,
            r#"<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>"#,
            r#"</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>"#
        ),
        cx,
        cy,
        doc_pr_id,
        escape_xml_attr(alt.unwrap_or(asset_id)),
        escape_xml_attr(alt.unwrap_or(asset_id)),
        escape_xml_attr(alt.unwrap_or(asset_id)),
        asset.rel_id,
        cx,
        cy
    );

    Ok(render_paragraph_xml(
        drawing,
        None,
        None,
        quote_depth,
        list_info,
        false,
        true,
    ))
}

fn fit_image_to_page_width(
    width_px: u32,
    height_px: u32,
    quote_depth: usize,
    list_level: Option<usize>,
    page_margin_twips: u32,
) -> (u32, u32) {
    let (_, _, max_width_px) = image_layout_constraints(quote_depth, list_level, page_margin_twips);

    if width_px <= max_width_px {
        return (width_px, height_px);
    }

    let scaled_height = ((height_px as u64) * (max_width_px as u64) / (width_px as u64))
        .max(1)
        .min(u32::MAX as u64) as u32;
    (max_width_px, scaled_height)
}

fn resolve_image_dimensions(
    width_px: u32,
    height_px: u32,
    width_percent: Option<f32>,
    max_width_percent: Option<f32>,
    quote_depth: usize,
    list_level: Option<usize>,
    page_margin_twips: u32,
) -> (u32, u32) {
    let (_, _, max_width_px) = image_layout_constraints(quote_depth, list_level, page_margin_twips);

    if let Some(percent) = width_percent.filter(|value| value.is_finite() && *value > 0.0) {
        let target_width = (((max_width_px as f32) * (percent.min(100.0) / 100.0)).round() as u32)
            .clamp(1, max_width_px.max(1));
        let target_height = ((height_px as u64) * (target_width as u64) / (width_px as u64))
            .max(1)
            .min(u32::MAX as u64) as u32;
        return (target_width, target_height);
    }

    let (fit_width, fit_height) = fit_image_to_page_width(
        width_px,
        height_px,
        quote_depth,
        list_level,
        page_margin_twips,
    );

    if let Some(percent) = max_width_percent.filter(|value| value.is_finite() && *value > 0.0) {
        let clamp_width =
            (((max_width_px as f32) * (percent.min(100.0) / 100.0)).round() as u32).max(1);
        if fit_width > clamp_width {
            let target_height = ((fit_height as u64) * (clamp_width as u64) / (fit_width as u64))
                .max(1)
                .min(u32::MAX as u64) as u32;
            return (clamp_width, target_height);
        }
    }

    (fit_width, fit_height)
}

fn image_layout_constraints(
    quote_depth: usize,
    list_level: Option<usize>,
    page_margin_twips: u32,
) -> (u32, u32, u32) {
    let page_body_twips = WORD_PAGE_WIDTH_TWIPS.saturating_sub(page_margin_twips * 2);
    let quote_indent_twips = (quote_depth as u32).saturating_mul(720);
    let list_indent_twips = list_level
        .map(|level| ((level as u32) + 1).saturating_mul(720))
        .unwrap_or(0);
    let available_twips = page_body_twips
        .saturating_sub(quote_indent_twips)
        .saturating_sub(list_indent_twips);
    let safe_twips =
        available_twips.saturating_mul(WORD_IMAGE_WIDTH_RATIO_NUM) / WORD_IMAGE_WIDTH_RATIO_DEN;
    let max_width_px = (safe_twips / TWIPS_PER_PX_AT_96_DPI).max(1);
    (available_twips, safe_twips, max_width_px)
}

fn build_document_relationships_xml(render_state: &WordRenderState) -> String {
    let mut xml = String::from(concat!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#,
        r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">"#,
        r#"<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>"#,
        r#"<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>"#
    ));
    for asset in render_state.image_assets.values() {
        xml.push_str(&format!(
            r#"<Relationship Id="{}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="{}"/>"#,
            asset.rel_id, asset.target
        ));
    }
    for (rel_id, href) in &render_state.hyperlinks {
        xml.push_str(&format!(
            r#"<Relationship Id="{}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="{}" TargetMode="External"/>"#,
            rel_id,
            escape_xml_attr(href)
        ));
    }
    xml.push_str("</Relationships>");
    xml
}

fn build_content_types_xml(defaults: &std::collections::BTreeMap<String, String>) -> String {
    let mut defaults_xml = String::new();
    for (ext, mime) in defaults {
        defaults_xml.push_str(&format!(
            r#"<Default Extension="{}" ContentType="{}"/>"#,
            escape_xml_attr(ext),
            escape_xml_attr(mime)
        ));
    }
    format!(
        concat!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#,
            r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">"#,
            "{}",
            r#"<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>"#,
            r#"<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>"#,
            r#"<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>"#,
            r#"<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>"#,
            r#"<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>"#,
            r#"</Types>"#
        ),
        defaults_xml
    )
}

fn build_root_relationships_xml() -> String {
    concat!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#,
        r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">"#,
        r#"<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>"#,
        r#"<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>"#,
        r#"<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>"#,
        r#"</Relationships>"#
    )
    .to_string()
}

fn build_core_props_xml(title: &str) -> String {
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ");
    format!(
        concat!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#,
            r#"<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" "#,
            r#"xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" "#,
            r#"xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">"#,
            r#"<dc:title>{}</dc:title><dc:creator>HaoMD</dc:creator><cp:lastModifiedBy>HaoMD</cp:lastModifiedBy>"#,
            r#"<dcterms:created xsi:type="dcterms:W3CDTF">{}</dcterms:created>"#,
            r#"<dcterms:modified xsi:type="dcterms:W3CDTF">{}</dcterms:modified>"#,
            r#"</cp:coreProperties>"#
        ),
        escape_xml_text(title),
        now,
        now
    )
}

fn build_app_props_xml() -> String {
    concat!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#,
        r#"<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">"#,
        r#"<Application>HaoMD</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop>"#,
        r#"<HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Title</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant></vt:vector></HeadingPairs>"#,
        r#"<TitlesOfParts><vt:vector size="1" baseType="lpstr"><vt:lpstr>Document</vt:lpstr></vt:vector></TitlesOfParts>"#,
        r#"<Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>1.0</AppVersion>"#,
        r#"</Properties>"#
    )
    .to_string()
}

fn build_word_styles_xml(settings: &WordExportStyleSettingsResolved) -> String {
    format!(
        concat!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#,
            r#"<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">"#,
            r#"<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>"#,
            r#"<w:pPr><w:spacing w:after="{}" w:line="{}" w:lineRule="auto"/></w:pPr>"#,
            r#"<w:rPr><w:rFonts w:ascii="{}" w:hAnsi="{}" w:cs="{}"/><w:sz w:val="{}"/></w:rPr></w:style>"#,
            r#"<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:rPr><w:rFonts w:ascii="{}" w:hAnsi="{}" w:cs="{}"/><w:b/><w:sz w:val="{}"/></w:rPr></w:style>"#,
            r#"<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:rPr><w:rFonts w:ascii="{}" w:hAnsi="{}" w:cs="{}"/><w:b/><w:sz w:val="{}"/></w:rPr></w:style>"#,
            r#"<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:rPr><w:rFonts w:ascii="{}" w:hAnsi="{}" w:cs="{}"/><w:b/><w:sz w:val="{}"/></w:rPr></w:style>"#,
            r#"<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:rPr><w:rFonts w:ascii="{}" w:hAnsi="{}" w:cs="{}"/><w:b/><w:sz w:val="{}"/></w:rPr></w:style>"#,
            r#"<w:style w:type="paragraph" w:styleId="Heading5"><w:name w:val="heading 5"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:rPr><w:rFonts w:ascii="{}" w:hAnsi="{}" w:cs="{}"/><w:b/><w:sz w:val="{}"/></w:rPr></w:style>"#,
            r#"<w:style w:type="paragraph" w:styleId="Heading6"><w:name w:val="heading 6"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:rPr><w:rFonts w:ascii="{}" w:hAnsi="{}" w:cs="{}"/><w:b/><w:sz w:val="{}"/></w:rPr></w:style>"#,
            r#"<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>"#,
            r#"</w:styles>"#
        ),
        settings.paragraph_spacing_after_twips,
        settings.line_spacing_twips,
        escape_xml_attr(&settings.body_font_family),
        escape_xml_attr(&settings.body_font_family),
        escape_xml_attr(&settings.body_font_family),
        settings.body_font_size_half_points,
        escape_xml_attr(&settings.heading_font_family),
        escape_xml_attr(&settings.heading_font_family),
        escape_xml_attr(&settings.heading_font_family),
        settings.heading1_size_half_points,
        escape_xml_attr(&settings.heading_font_family),
        escape_xml_attr(&settings.heading_font_family),
        escape_xml_attr(&settings.heading_font_family),
        settings.heading2_size_half_points,
        escape_xml_attr(&settings.heading_font_family),
        escape_xml_attr(&settings.heading_font_family),
        escape_xml_attr(&settings.heading_font_family),
        settings.heading3_size_half_points,
        escape_xml_attr(&settings.heading_font_family),
        escape_xml_attr(&settings.heading_font_family),
        escape_xml_attr(&settings.heading_font_family),
        settings.heading3_size_half_points,
        escape_xml_attr(&settings.heading_font_family),
        escape_xml_attr(&settings.heading_font_family),
        escape_xml_attr(&settings.heading_font_family),
        settings.heading3_size_half_points,
        escape_xml_attr(&settings.heading_font_family),
        escape_xml_attr(&settings.heading_font_family),
        escape_xml_attr(&settings.heading_font_family),
        settings.heading3_size_half_points.saturating_sub(2),
    )
}

fn build_word_numbering_xml() -> String {
    concat!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#,
        r#"<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">"#,
        r#"<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>"#,
        r#"<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>"#,
        r#"<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="◦"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>"#,
        r#"<w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="▪"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="2160" w:hanging="360"/></w:pPr></w:lvl>"#,
        r#"</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>"#,
        r#"<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>"#,
        r#"<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>"#,
        r#"<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>"#,
        r#"<w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="%3."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="2160" w:hanging="360"/></w:pPr></w:lvl>"#,
        r#"</w:abstractNum><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>"#
    )
    .to_string()
}

fn detect_asset_extension(
    mime: Option<&str>,
    source_path: Option<&Path>,
    file_name: Option<&str>,
) -> String {
    if let Some(name) = file_name {
        if let Some(ext) = Path::new(name).extension().and_then(|v| v.to_str()) {
            return ext.to_lowercase();
        }
    }
    if let Some(path) = source_path {
        if let Some(ext) = path.extension().and_then(|v| v.to_str()) {
            return ext.to_lowercase();
        }
    }
    match mime.unwrap_or("application/octet-stream") {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        "image/x-emf" | "image/emf" => "emf",
        _ => "bin",
    }
    .to_string()
}

fn mime_for_extension(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "emf" => "image/x-emf",
        _ => "application/octet-stream",
    }
}

fn next_relationship_id(render_state: &mut WordRenderState) -> String {
    let id = format!("rId{}", render_state.next_rel_id);
    render_state.next_rel_id += 1;
    id
}

fn escape_xml_text(input: &str) -> String {
    html_escape::encode_text(input).to_string()
}

fn escape_xml_attr(input: &str) -> String {
    html_escape::encode_double_quoted_attribute(input).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Read;

    fn unique_test_path(prefix: &str, ext: Option<&str>) -> std::path::PathBuf {
        let mut path =
            std::env::temp_dir().join(format!("{prefix}-{}", new_trace_id().replace("trace_", "")));
        if let Some(ext) = ext {
            path.set_extension(ext);
        }
        path
    }

    #[test]
    fn should_build_minimal_docx_package() {
        let work_dir = unique_test_path("haomd-word-test", None);
        let output_path = unique_test_path("haomd-word-test", Some("docx"));

        let payload = WordDocPayloadCfg {
            title: "Sample".to_string(),
            blocks: vec![
                WordBlockCfg::Heading {
                    level: 1,
                    text: vec![WordInlineRunCfg::Text {
                        value: "Hello".to_string(),
                        bold: Some(true),
                        italic: None,
                        code: None,
                        strike: None,
                        underline: None,
                        color: None,
                        background_color: None,
                        font_size_pt: None,
                        font_family: None,
                    }],
                    style: None,
                },
                WordBlockCfg::Paragraph {
                    text: vec![WordInlineRunCfg::Text {
                        value: "World".to_string(),
                        bold: None,
                        italic: None,
                        code: None,
                        strike: None,
                        underline: None,
                        color: None,
                        background_color: None,
                        font_size_pt: None,
                        font_family: None,
                    }],
                    style: None,
                },
                WordBlockCfg::Image {
                    asset_id: "asset_0".to_string(),
                    alt: Some("tiny".to_string()),
                    width_px: Some(1),
                    height_px: Some(1),
                    width_percent: None,
                    max_width_percent: None,
                },
            ],
            assets: vec![WordAssetCfg::EmbeddedImage {
                id: "asset_0".to_string(),
                file_name: "tiny.png".to_string(),
                mime_type: "image/png".to_string(),
                base64_data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9l9WQAAAAASUVORK5CYII=".to_string(),
                width_px: Some(1),
                height_px: Some(1),
            }],
            style_settings: None,
        };

        build_word_export_workspace(&work_dir, &payload).expect("workspace should build");
        package_docx_workspace(&work_dir, &output_path).expect("docx package should build");

        let bytes = std::fs::read(&output_path).expect("docx should exist");
        assert!(
            bytes.starts_with(&[0x50, 0x4b]),
            "docx should be a zip package"
        );

        let _ = std::fs::remove_dir_all(&work_dir);
        let _ = std::fs::remove_file(&output_path);
    }

    #[test]
    fn should_build_docx_package_with_chinese_text_and_embedded_image() {
        let work_dir = unique_test_path("haomd-word-zh-image", None);
        let output_path = unique_test_path("haomd-word-zh-image", Some("docx"));

        let payload = WordDocPayloadCfg {
            title: "论文导出示例".to_string(),
            blocks: vec![
                WordBlockCfg::Heading {
                    level: 1,
                    text: vec![WordInlineRunCfg::Text {
                        value: "第一章 绪论".to_string(),
                        bold: Some(true),
                        italic: None,
                        code: None,
                        strike: None,
                        underline: None,
                        color: None,
                        background_color: None,
                        font_size_pt: None,
                        font_family: None,
                    }],
                    style: None,
                },
                WordBlockCfg::Paragraph {
                    text: vec![WordInlineRunCfg::Text {
                        value: "这是一个用于 Windows CI 验证的中文段落。".to_string(),
                        bold: None,
                        italic: None,
                        code: None,
                        strike: None,
                        underline: None,
                        color: None,
                        background_color: None,
                        font_size_pt: None,
                        font_family: None,
                    }],
                    style: None,
                },
                WordBlockCfg::Image {
                    asset_id: "asset_cn_0".to_string(),
                    alt: Some("示意图".to_string()),
                    width_px: Some(1),
                    height_px: Some(1),
                    width_percent: None,
                    max_width_percent: None,
                },
            ],
            assets: vec![WordAssetCfg::EmbeddedImage {
                id: "asset_cn_0".to_string(),
                file_name: "figure.png".to_string(),
                mime_type: "image/png".to_string(),
                base64_data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9l9WQAAAAASUVORK5CYII=".to_string(),
                width_px: Some(1),
                height_px: Some(1),
            }],
            style_settings: None,
        };

        build_word_export_workspace(&work_dir, &payload).expect("workspace should build");
        package_docx_workspace(&work_dir, &output_path).expect("docx package should build");

        let bytes = std::fs::read(&output_path).expect("docx should exist");
        assert!(
            bytes.starts_with(&[0x50, 0x4b]),
            "docx should be a zip package"
        );

        let cursor = std::io::Cursor::new(bytes);
        let mut archive =
            zip::ZipArchive::new(cursor).expect("docx package should be readable as zip");

        let mut document_xml = String::new();
        archive
            .by_name("word/document.xml")
            .expect("document.xml should exist")
            .read_to_string(&mut document_xml)
            .expect("document.xml should be readable");
        assert!(document_xml.contains("第一章 绪论"));
        assert!(document_xml.contains("这是一个用于 Windows CI 验证的中文段落。"));

        let image_entry = archive
            .by_name("word/media/figure.png")
            .expect("embedded image should exist");
        assert!(image_entry.size() > 0, "embedded image should not be empty");

        let _ = std::fs::remove_dir_all(&work_dir);
        let _ = std::fs::remove_file(&output_path);
    }

    #[test]
    fn should_generate_editable_word_xml_for_core_blocks() {
        let work_dir = unique_test_path("haomd-word-xml", None);
        let payload = WordDocPayloadCfg {
            title: "Regression".to_string(),
            blocks: vec![
                WordBlockCfg::Heading {
                    level: 2,
                    text: vec![WordInlineRunCfg::Text {
                        value: "Section".to_string(),
                        bold: None,
                        italic: None,
                        code: None,
                        strike: None,
                        underline: None,
                        color: None,
                        background_color: None,
                        font_size_pt: None,
                        font_family: None,
                    }],
                    style: None,
                },
                WordBlockCfg::Paragraph {
                    text: vec![
                        WordInlineRunCfg::Text {
                            value: "Visit ".to_string(),
                            bold: None,
                            italic: None,
                            code: None,
                            strike: None,
                            underline: None,
                            color: None,
                            background_color: None,
                            font_size_pt: None,
                            font_family: None,
                        },
                        WordInlineRunCfg::Link {
                            value: "OpenAI".to_string(),
                            href: "https://openai.com".to_string(),
                        },
                    ],
                    style: None,
                },
                WordBlockCfg::List {
                    ordered: false,
                    items: vec![vec![WordBlockCfg::Paragraph {
                        text: vec![WordInlineRunCfg::Text {
                            value: "Item one".to_string(),
                            bold: None,
                            italic: None,
                            code: None,
                            strike: None,
                            underline: None,
                            color: None,
                            background_color: None,
                            font_size_pt: None,
                            font_family: None,
                        }],
                        style: None,
                    }]],
                },
                WordBlockCfg::Table {
                    style: Some(WordTableStyleCfg {
                        align: Some("center".to_string()),
                        width_percent: Some(80.0),
                        width_px: None,
                        max_width_percent: Some(90.0),
                        layout: Some("fixed".to_string()),
                        column_widths: Some(vec![
                            WordTableColumnWidthCfg {
                                width_percent: Some(30.0),
                                width_px: None,
                            },
                            WordTableColumnWidthCfg {
                                width_percent: Some(70.0),
                                width_px: None,
                            },
                        ]),
                    }),
                    rows: vec![
                        WordTableRowCfg {
                            cells: vec![
                                WordTableCellCfg {
                                    blocks: vec![WordBlockCfg::Paragraph {
                                        text: vec![WordInlineRunCfg::Text {
                                            value: "Name".to_string(),
                                            bold: None,
                                            italic: None,
                                            code: None,
                                            strike: None,
                                            underline: None,
                                            color: None,
                                            background_color: None,
                                            font_size_pt: None,
                                            font_family: None,
                                        }],
                                        style: None,
                                    }],
                                    style: Some(WordTableCellStyleCfg {
                                        background_color: Some("E0F2FE".to_string()),
                                        align: Some("center".to_string()),
                                        border_color: None,
                                        border_top_color: Some("D1D5DB".to_string()),
                                        border_right_color: Some("111827".to_string()),
                                        border_bottom_color: Some("9CA3AF".to_string()),
                                        border_left_color: Some("2563EB".to_string()),
                                    }),
                                    col_span: Some(2),
                                    row_span: None,
                                    merge_continue: None,
                                },
                            ],
                        },
                        WordTableRowCfg {
                            cells: vec![
                                WordTableCellCfg {
                                    blocks: vec![WordBlockCfg::Paragraph {
                                        text: vec![WordInlineRunCfg::Text {
                                            value: "HTML".to_string(),
                                            bold: None,
                                            italic: None,
                                            code: None,
                                            strike: None,
                                            underline: None,
                                            color: None,
                                            background_color: None,
                                            font_size_pt: None,
                                            font_family: None,
                                        }],
                                        style: None,
                                    }],
                                    style: None,
                                    col_span: None,
                                    row_span: None,
                                    merge_continue: None,
                                },
                                WordTableCellCfg {
                                    blocks: vec![WordBlockCfg::Paragraph {
                                        text: vec![WordInlineRunCfg::Text {
                                            value: "Value".to_string(),
                                            bold: None,
                                            italic: None,
                                            code: None,
                                            strike: None,
                                            underline: None,
                                            color: None,
                                            background_color: None,
                                            font_size_pt: None,
                                            font_family: None,
                                        }],
                                        style: None,
                                    }],
                                    style: None,
                                    col_span: None,
                                    row_span: None,
                                    merge_continue: None,
                                },
                            ],
                        },
                    ],
                },
                WordBlockCfg::Image {
                    asset_id: "asset_0".to_string(),
                    alt: Some("tiny".to_string()),
                    width_px: Some(1),
                    height_px: Some(1),
                    width_percent: None,
                    max_width_percent: None,
                },
            ],
            assets: vec![WordAssetCfg::EmbeddedImage {
                id: "asset_0".to_string(),
                file_name: "tiny.png".to_string(),
                mime_type: "image/png".to_string(),
                base64_data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9l9WQAAAAASUVORK5CYII=".to_string(),
                width_px: Some(1),
                height_px: Some(1),
            }],
            style_settings: None,
        };

        build_word_export_workspace(&work_dir, &payload).expect("workspace should build");

        let document_xml = fs::read_to_string(work_dir.join("word").join("document.xml"))
            .expect("document xml should exist");
        let rels_xml = fs::read_to_string(
            work_dir
                .join("word")
                .join("_rels")
                .join("document.xml.rels"),
        )
        .expect("relationships xml should exist");

        assert!(document_xml.contains(r#"<w:pStyle w:val="Heading2"/>"#));
        assert!(document_xml.contains(r#"<w:hyperlink r:id=""#));
        assert!(document_xml.contains(r#"<w:numId w:val="1"/>"#));
        assert!(document_xml.contains("<w:tbl>"));
        assert!(document_xml.contains(r#"<w:gridSpan w:val="2"/>"#));
        assert!(document_xml.contains(r#"<w:tblW w:w="4000" w:type="pct"/>"#));
        assert!(document_xml.contains(r#"<w:tblLayout w:type="fixed"/>"#));
        assert!(document_xml
            .contains(r#"<w:tblGrid><w:gridCol w:w="2166"/><w:gridCol w:w="5055"/></w:tblGrid>"#));
        assert!(document_xml.contains(r#"<w:shd w:val="clear" w:color="auto" w:fill="E0F2FE"/>"#));
        assert!(document_xml
            .contains(r#"<w:top w:val="single" w:sz="4" w:space="0" w:color="D1D5DB"/>"#));
        assert!(document_xml
            .contains(r#"<w:right w:val="single" w:sz="4" w:space="0" w:color="111827"/>"#));
        assert!(document_xml
            .contains(r#"<w:bottom w:val="single" w:sz="4" w:space="0" w:color="9CA3AF"/>"#));
        assert!(document_xml
            .contains(r#"<w:left w:val="single" w:sz="4" w:space="0" w:color="2563EB"/>"#));
        assert!(document_xml.contains(r#"<w:jc w:val="center"/>"#));
        assert!(document_xml.contains("Item one"));
        assert!(document_xml.contains("OpenAI"));
        assert!(document_xml.contains("tiny"));

        assert!(rels_xml.contains(
            r#"Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink""#,
        ));
        assert!(rels_xml.contains(
            r#"Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image""#,
        ));

        let _ = std::fs::remove_dir_all(&work_dir);
    }

    #[test]
    fn should_reject_remote_images_for_word_export() {
        let work_dir = unique_test_path("haomd-word-remote", None);
        let payload = WordDocPayloadCfg {
            title: "Remote".to_string(),
            blocks: vec![WordBlockCfg::Image {
                asset_id: "asset_0".to_string(),
                alt: Some("remote".to_string()),
                width_px: None,
                height_px: None,
                width_percent: None,
                max_width_percent: None,
            }],
            assets: vec![WordAssetCfg::Image {
                id: "asset_0".to_string(),
                source_path: "https://example.com/remote.png".to_string(),
                mime_type: Some("image/png".to_string()),
                width_px: Some(10),
                height_px: Some(10),
            }],
            style_settings: None,
        };

        let error =
            build_word_export_workspace(&work_dir, &payload).expect_err("remote image should fail");
        assert!(error.contains("暂不支持远程图片"));

        let _ = std::fs::remove_dir_all(&work_dir);
    }

    #[test]
    fn should_scale_large_images_to_fit_page_width() {
        let (width, height) = fit_image_to_page_width(2000, 1000, 0, None, 1440);
        assert_eq!(width, 553);
        assert_eq!(height, 276);

        let (nested_width, nested_height) = fit_image_to_page_width(2000, 1000, 1, Some(1), 1440);
        assert!(nested_width < width);
        assert!(nested_height < height);
    }

    #[test]
    fn should_clamp_editor_background_to_1080_long_edge() {
        let (landscape_w, landscape_h) = clamp_image_to_long_edge(4000, 2000, 1080);
        assert_eq!(landscape_w, 1080);
        assert_eq!(landscape_h, 540);

        let (portrait_w, portrait_h) = clamp_image_to_long_edge(1200, 2400, 1080);
        assert_eq!(portrait_w, 540);
        assert_eq!(portrait_h, 1080);

        let (small_w, small_h) = clamp_image_to_long_edge(900, 600, 1080);
        assert_eq!(small_w, 900);
        assert_eq!(small_h, 600);
    }

    #[test]
    fn should_only_cleanup_managed_editor_background_files() {
        let backgrounds_dir = std::env::temp_dir().join(format!(
            "haomd-editor-backgrounds-{}",
            new_trace_id().replace("trace_", "")
        ));
        let managed = backgrounds_dir.join("old.png");
        let next = backgrounds_dir.join("new.png");
        let external = std::env::temp_dir().join(format!(
            "haomd-external-bg-{}.png",
            new_trace_id().replace("trace_", "")
        ));

        fs::create_dir_all(&backgrounds_dir).expect("background dir");
        fs::write(&managed, b"old").expect("managed");
        fs::write(&next, b"new").expect("next");
        fs::write(&external, b"external").expect("external");

        assert!(should_cleanup_managed_editor_background(
            &backgrounds_dir,
            &managed,
            &next
        ));
        assert!(!should_cleanup_managed_editor_background(
            &backgrounds_dir,
            &external,
            &next
        ));
        assert!(!should_cleanup_managed_editor_background(
            &backgrounds_dir,
            &next,
            &next
        ));

        let _ = fs::remove_dir_all(&backgrounds_dir);
        let _ = fs::remove_file(&external);
    }

    #[test]
    fn should_resolve_percentage_based_image_widths() {
        let (width, height) = resolve_image_dimensions(2000, 1000, Some(50.0), None, 0, None, 1440);
        assert_eq!(width, 277);
        assert_eq!(height, 138);

        let (clamped_width, clamped_height) =
            resolve_image_dimensions(2000, 1000, None, Some(40.0), 0, None, 1440);
        assert_eq!(clamped_width, 221);
        assert_eq!(clamped_height, 110);
    }

    #[test]
    fn should_render_rowspan_as_vertical_merge() {
        let tc_start = render_table_cell_properties_xml(None, None, Some(2), None);
        let tc_continue = render_table_cell_properties_xml(None, None, None, Some(true));

        assert!(tc_start.contains(r#"<w:vMerge w:val="restart"/>"#));
        assert!(tc_continue.contains(r#"<w:vMerge/>"#));
    }

    #[test]
    fn should_render_table_layout_modes() {
        let (fixed_xml, _) = render_table_properties_xml(
            Some(&WordTableStyleCfg {
                align: None,
                width_percent: None,
                width_px: None,
                max_width_percent: None,
                layout: Some("fixed".to_string()),
                column_widths: None,
            }),
            1440,
        );
        let (auto_xml, _) = render_table_properties_xml(
            Some(&WordTableStyleCfg {
                align: None,
                width_percent: None,
                width_px: None,
                max_width_percent: None,
                layout: Some("auto".to_string()),
                column_widths: None,
            }),
            1440,
        );

        assert!(fixed_xml.contains(r#"<w:tblLayout w:type="fixed"/>"#));
        assert!(auto_xml.contains(r#"<w:tblLayout w:type="autofit"/>"#));
    }

    #[test]
    fn should_include_math_content_in_document_xml() {
        let work_dir = unique_test_path("haomd-word-math", None);
        let payload = WordDocPayloadCfg {
            title: "Math".to_string(),
            blocks: vec![
                WordBlockCfg::Paragraph {
                    text: vec![
                        WordInlineRunCfg::Text {
                            value: "Energy: ".to_string(),
                            bold: None,
                            italic: None,
                            code: None,
                            strike: None,
                            underline: None,
                            color: None,
                            background_color: None,
                            font_size_pt: None,
                            font_family: None,
                        },
                        WordInlineRunCfg::Math {
                            value: "E = mc^2".to_string(),
                            math_ml: Some("<math xmlns=\"http://www.w3.org/1998/Math/MathML\"><semantics><mrow><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></mrow></semantics></math>".to_string()),
                        },
                    ],
                    style: None,
                },
                WordBlockCfg::Math {
                    content: "\\frac{a}{b}".to_string(),
                    math_ml: Some("<math xmlns=\"http://www.w3.org/1998/Math/MathML\" display=\"block\"><semantics><mrow><munderover><mo>∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover><msup><mi>x</mi><mi>i</mi></msup><mo>+</mo><mfrac><mi>a</mi><mi>b</mi></mfrac></mrow></semantics></math>".to_string()),
                },
            ],
            assets: vec![],
            style_settings: None,
        };

        build_word_export_workspace(&work_dir, &payload).expect("workspace should build");
        let document_xml = fs::read_to_string(work_dir.join("word").join("document.xml"))
            .expect("document xml should exist");

        assert!(document_xml.contains("<m:oMath>"));
        assert!(document_xml.contains("<m:sSup>"));
        assert!(document_xml.contains("<m:nary>"));
        assert!(document_xml.contains("<m:f>"));
        assert!(document_xml.contains("E"));
        assert!(document_xml.contains("∑"));
        assert!(document_xml.contains(r#"<m:e><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>i</m:t></m:r></m:sup></m:sSup>"#));
        assert!(document_xml.contains(r#"<w:jc w:val="left"/>"#));

        let _ = std::fs::remove_dir_all(&work_dir);
    }

    #[test]
    fn should_convert_mathml_alignment_table_to_word_matrix() {
        let math_ml = "<math xmlns=\"http://www.w3.org/1998/Math/MathML\" display=\"block\"><semantics><mtable rowspacing=\"0.25em\" columnalign=\"right left\" columnspacing=\"0em\"><mtr><mtd></mtd><mtd><mstyle scriptlevel=\"0\" displaystyle=\"true\"><mi>a</mi></mstyle></mtd><mtd><mstyle scriptlevel=\"0\" displaystyle=\"true\"><mrow><mrow></mrow><mo>=</mo><mi>b</mi><mo>+</mo><mi>c</mi></mrow></mstyle></mtd><mtd></mtd><mtd></mtd></mtr><mtr><mtd></mtd><mtd><mstyle scriptlevel=\"0\" displaystyle=\"true\"><mrow><mi>d</mi><mo>+</mo><mi>e</mi></mrow></mstyle></mtd><mtd><mstyle scriptlevel=\"0\" displaystyle=\"true\"><mrow><mrow></mrow><mo>=</mo><mi>f</mi></mrow></mstyle></mtd><mtd></mtd><mtd></mtd></mtr></mtable></semantics></math>";

        let omml = mathml_to_omml(math_ml).expect("mtable mathml should convert");

        assert!(omml.contains("<m:m>"));
        assert!(omml.contains(r#"<m:mcJc m:val="right"/>"#));
        assert!(omml.contains(r#"<m:mcJc m:val="left"/>"#));
        assert_eq!(omml.matches("<m:mr>").count(), 2);
        assert_eq!(omml.matches("<m:e>").count(), 4);
        assert!(omml.contains("<m:t>a</m:t>"));
        assert!(omml.contains("<m:t>=</m:t>"));
        assert!(omml.contains("<m:t>d</m:t>"));
        assert!(omml.contains("<m:t>f</m:t>"));
    }

    #[test]
    fn should_apply_custom_word_style_settings_to_styles_and_layout() {
        let work_dir = unique_test_path("haomd-word-style", None);
        let payload = WordDocPayloadCfg {
            title: "Styled".to_string(),
            blocks: vec![
                WordBlockCfg::Heading {
                    level: 1,
                    text: vec![WordInlineRunCfg::Text {
                        value: "Heading".to_string(),
                        bold: None,
                        italic: None,
                        code: None,
                        strike: None,
                        underline: None,
                        color: None,
                        background_color: None,
                        font_size_pt: None,
                        font_family: None,
                    }],
                    style: None,
                },
                WordBlockCfg::Paragraph {
                    text: vec![WordInlineRunCfg::Text {
                        value: "Body".to_string(),
                        bold: None,
                        italic: None,
                        code: None,
                        strike: None,
                        underline: None,
                        color: None,
                        background_color: None,
                        font_size_pt: None,
                        font_family: None,
                    }],
                    style: None,
                },
                WordBlockCfg::Code {
                    language: Some("ts".to_string()),
                    content: "const value = 1;".to_string(),
                },
            ],
            assets: vec![],
            style_settings: Some(WordExportStyleSettingsCfg {
                body_font_family: Some("Calibri".to_string()),
                body_font_size_pt: Some(11.0),
                heading_font_family: Some("Times New Roman".to_string()),
                heading1_size_pt: Some(20.0),
                heading2_size_pt: Some(18.0),
                heading3_size_pt: Some(16.0),
                paragraph_spacing_after_pt: Some(12.0),
                line_spacing: Some(1.5),
                code_font_size_pt: Some(9.0),
                page_margin_cm: Some(3.0),
                enable_inkscape_for_word_export: Some(false),
                mermaid_export_format: Some("png".to_string()),
                inkscape_fallback: Some("png".to_string()),
                selected_word_template_id: None,
            }),
        };

        build_word_export_workspace(&work_dir, &payload).expect("workspace should build");

        let styles_xml =
            fs::read_to_string(work_dir.join("word").join("styles.xml")).expect("styles xml");
        let document_xml = fs::read_to_string(work_dir.join("word").join("document.xml"))
            .expect("document xml should exist");

        assert!(styles_xml.contains(
            r#"<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/>"#
        ));
        assert!(styles_xml.contains(r#"<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:b/><w:sz w:val="40"/>"#));
        assert!(styles_xml.contains(r#"<w:spacing w:after="240" w:line="360" w:lineRule="auto"/>"#));
        assert!(document_xml
            .contains(r#"<w:pgMar w:top="1701" w:right="1701" w:bottom="1701" w:left="1701""#));
        assert!(document_xml.contains(
            r#"<w:rFonts w:ascii="Menlo" w:hAnsi="Menlo" w:cs="Menlo"/><w:sz w:val="18"/>"#
        ));

        let _ = std::fs::remove_dir_all(&work_dir);
    }

    #[test]
    fn should_render_text_run_color_and_underline_styles() {
        let run_xml = render_text_run_xml(RenderTextRunOptions {
            value: "Styled",
            bold: false,
            italic: false,
            code: false,
            strike: false,
            underline: true,
            color: Some("1D4ED8"),
            background_color: Some("FFF59D"),
            font_size_pt: Some(13.5),
            font_family: Some("Microsoft YaHei"),
            code_font_size_half_points: 21,
        });

        assert!(run_xml.contains(r#"<w:u w:val="single"/>"#));
        assert!(run_xml.contains(r#"<w:color w:val="1D4ED8"/>"#));
        assert!(run_xml.contains(r#"<w:shd w:val="clear" w:color="auto" w:fill="FFF59D"/>"#));
        assert!(run_xml.contains(r#"<w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:cs="Microsoft YaHei"/>"#));
        assert!(run_xml.contains(r#"<w:sz w:val="27"/>"#));
        assert!(run_xml.contains("Styled"));
    }

    #[test]
    fn should_render_paragraph_alignment_and_spacing_styles() {
        let paragraph_xml = render_paragraph_xml(
            "<w:r><w:t>Styled paragraph</w:t></w:r>".to_string(),
            None,
            Some(&WordParagraphStyleCfg {
                align: Some("center".to_string()),
                line_height: Some(1.5),
                spacing_after_pt: Some(12.0),
                background_color: Some("FFF59D".to_string()),
                border_color: None,
                border_top_color: Some("111827".to_string()),
                border_right_color: None,
                border_bottom_color: None,
                border_left_color: Some("EF4444".to_string()),
            }),
            0,
            None,
            false,
            false,
        );

        assert!(paragraph_xml.contains(r#"<w:jc w:val="center"/>"#));
        assert!(
            paragraph_xml.contains(r#"<w:spacing w:after="240" w:line="360" w:lineRule="auto"/>"#)
        );
        assert!(paragraph_xml.contains(r#"<w:shd w:val="clear" w:color="auto" w:fill="FFF59D"/>"#));
        assert!(paragraph_xml.contains(r#"<w:pBdr>"#));
        assert!(paragraph_xml
            .contains(r#"<w:top w:val="single" w:sz="4" w:space="0" w:color="111827"/>"#));
        assert!(paragraph_xml
            .contains(r#"<w:left w:val="single" w:sz="4" w:space="0" w:color="EF4444"/>"#));
    }
}

#[tauri::command]
async fn list_recent(
    app: AppHandle,
    offset: Option<u32>,
    limit: Option<u32>,
    trace_id: Option<String>,
) -> ResultPayload<Vec<RecentFile>> {
    let trace = trace_id.unwrap_or_else(new_trace_id);
    let mut list = match read_recent_store(&app).await {
        Ok(list) => list,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("读取最近文件失败: {err}"),
                trace,
            )
        }
    };

    // 始终按最近使用时间降序排序，保证一致性
    list.sort_by(|a, b| b.last_opened_at.cmp(&a.last_opened_at));

    let offset = offset.unwrap_or(0) as usize;
    let limit = limit.unwrap_or(10) as usize;

    if offset >= list.len() {
        return ok(Vec::new(), trace);
    }

    let end = std::cmp::min(offset + limit, list.len());
    let slice = list[offset..end].to_vec();

    ok(slice, trace)
}

#[tauri::command]
async fn log_recent_file(
    app: AppHandle,
    path: String,
    is_folder: bool,
    trace_id: Option<String>,
) -> ResultPayload<()> {
    let trace = trace_id.unwrap_or_else(new_trace_id);
    match update_recent(&app, &path, is_folder).await {
        Ok(()) => {
            refresh_app_menu(&app).await;
            ok((), trace)
        }
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("更新最近文件失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
async fn clear_recent(app: AppHandle, trace_id: Option<String>) -> ResultPayload<()> {
    let trace = trace_id.unwrap_or_else(new_trace_id);
    match write_recent_store(&app, &[]).await {
        Ok(()) => {
            refresh_app_menu(&app).await;
            ok((), trace)
        }
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("清空最近文件失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
async fn delete_recent_entry(
    app: AppHandle,
    path: String,
    trace_id: Option<String>,
) -> ResultPayload<()> {
    let trace = trace_id.unwrap_or_else(new_trace_id);
    let mut list = match read_recent_store(&app).await {
        Ok(list) => list,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("读取最近文件失败: {err}"),
                trace,
            )
        }
    };
    list.retain(|item| item.path != path);
    match write_recent_store(&app, &list).await {
        Ok(()) => {
            refresh_app_menu(&app).await;
            ok((), trace)
        }
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("写入最近文件失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
async fn list_pdf_recent(
    app: AppHandle,
    limit: Option<u32>,
    trace_id: Option<String>,
) -> ResultPayload<Vec<PdfRecentEntry>> {
    let trace = trace_id.unwrap_or_else(new_trace_id);
    let mut list = match read_pdf_recent_store(&app).await {
        Ok(list) => list,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("读取 PDF 最近文件失败: {err}"),
                trace,
            )
        }
    };

    // 防御性排序
    list.sort_by(|a, b| b.last_opened_at.cmp(&a.last_opened_at));

    if let Some(limit) = limit {
        let limit = limit as usize;
        if list.len() > limit {
            list.truncate(limit);
        }
    }

    ok(list, trace)
}

#[tauri::command]
async fn log_pdf_recent_file(
    app: AppHandle,
    path: String,
    trace_id: Option<String>,
) -> ResultPayload<()> {
    let trace = trace_id.unwrap_or_else(new_trace_id);
    match upsert_pdf_recent(&app, &path).await {
        Ok(()) => ok((), trace),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("更新 PDF 最近文件失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
async fn delete_pdf_recent_entry(
    app: AppHandle,
    path: String,
    trace_id: Option<String>,
) -> ResultPayload<()> {
    let trace = trace_id.unwrap_or_else(new_trace_id);
    match delete_pdf_recent(&app, &path).await {
        Ok(()) => ok((), trace),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("删除 PDF 最近文件失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
async fn load_pdf_folders(
    app: AppHandle,
    trace_id: Option<String>,
) -> ResultPayload<Vec<PdfFolder>> {
    let trace = trace_id.unwrap_or_else(new_trace_id);
    match read_pdf_folders_store(&app).await {
        Ok(list) => ok(list, trace),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("读取 PDF 虚拟文件夹失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
async fn save_pdf_folders(
    app: AppHandle,
    folders: Vec<PdfFolder>,
    trace_id: Option<String>,
) -> ResultPayload<()> {
    let trace = trace_id.unwrap_or_else(new_trace_id);
    match write_pdf_folders_store(&app, &folders).await {
        Ok(()) => ok((), trace),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("写入 PDF 虚拟文件夹失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
async fn update_pdf_recent_folder(
    app: AppHandle,
    path: String,
    folder_id: Option<String>,
    trace_id: Option<String>,
) -> ResultPayload<()> {
    let trace = trace_id.unwrap_or_else(new_trace_id);
    let mut list = match read_pdf_recent_store(&app).await {
        Ok(list) => list,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("读取 PDF 最近文件失败: {err}"),
                trace,
            )
        }
    };

    if let Some(item) = list.iter_mut().find(|item| item.path == path) {
        item.folder_id = folder_id;
    } else {
        return err_payload(ErrorCode::NotFound, "目标 PDF 不在最近列表中", trace);
    }

    match write_pdf_recent_store(&app, &list).await {
        Ok(()) => ok((), trace),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("更新 PDF 最近文件分类失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
async fn load_file_virtual_folders(
    app: AppHandle,
    trace_id: Option<String>,
) -> ResultPayload<Vec<FileVirtualFolder>> {
    let trace = trace_id.unwrap_or_else(new_trace_id);
    match read_file_virtual_folders_store(&app).await {
        Ok(list) => ok(list, trace),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("读取 Files 虚拟文件夹失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
async fn save_file_virtual_folders(
    app: AppHandle,
    folders: Vec<FileVirtualFolder>,
    trace_id: Option<String>,
) -> ResultPayload<()> {
    let trace = trace_id.unwrap_or_else(new_trace_id);
    match write_file_virtual_folders_store(&app, &folders).await {
        Ok(()) => ok((), trace),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("写入 Files 虚拟文件夹失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
async fn list_file_virtual_assignments(
    app: AppHandle,
    trace_id: Option<String>,
) -> ResultPayload<Vec<FileVirtualAssignment>> {
    let trace = trace_id.unwrap_or_else(new_trace_id);
    match read_file_virtual_assignments_store(&app).await {
        Ok(mut list) => {
            // 一次性 GC：移除旧版本产生的 folder_id == None 的记录，并回写 JSON
            let original_len = list.len();
            list.retain(|item| item.folder_id.is_some());
            let removed = original_len.saturating_sub(list.len());
            if removed > 0 {
                log::info!(
                    "[tauri][FilesVirtual] list_file_virtual_assignments: gc removed {} legacy items, remaining={}",
                    removed,
                    list.len()
                );
                if let Err(err) = write_file_virtual_assignments_store(&app, &list).await {
                    log::warn!(
                        "[tauri][FilesVirtual] list_file_virtual_assignments: gc write failed: {}",
                        err
                    );
                }
            } else {
                log::info!(
                    "[tauri][FilesVirtual] list_file_virtual_assignments: count={} (no legacy items)",
                    list.len()
                );
            }
            ok(list, trace)
        }
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("读取 Files 虚拟分组映射失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
async fn update_file_virtual_folder_for_path(
    app: AppHandle,
    path: String,
    folder_id: Option<String>,
    trace_id: Option<String>,
) -> ResultPayload<FileVirtualAssignment> {
    let trace = trace_id.unwrap_or_else(new_trace_id);

    // 先读取现有分配列表
    let mut list = match read_file_virtual_assignments_store(&app).await {
        Ok(list) => list,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("读取 Files 虚拟分组映射失败: {err}"),
                trace,
            )
        }
    };

    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    // 以传入的参数为权威源：Some => upsert，None => 删除该 path 的分配记录
    let result_entry;

    if folder_id.is_none() {
        // 删除该 path 的所有分配记录，将其视为“恢复到根（默认状态）”
        let original_len = list.len();
        list.retain(|item| item.path != path);
        log::info!(
            "[tauri][FilesVirtual] update_file_virtual_folder_for_path(delete): path={:?}, removed={}, total_assignments={}",
            &path,
            original_len.saturating_sub(list.len()),
            list.len()
        );

        // 对于删除操作，仍然返回一个带当前时间戳的条目作为响应，方便前端更新本地状态
        result_entry = FileVirtualAssignment {
            path: path.clone(),
            folder_id: None,
            updated_at: now_ms,
        };
    } else {
        let new_entry = FileVirtualAssignment {
            path: path.clone(),
            folder_id: folder_id.clone(),
            updated_at: now_ms,
        };

        // 如果列表中已有同 path 条目，则整体替换；否则新增
        if let Some(item) = list.iter_mut().find(|item| item.path == path) {
            *item = new_entry.clone();
        } else {
            list.push(new_entry.clone());
        }

        log::info!(
            "[tauri][FilesVirtual] update_file_virtual_folder_for_path: path={:?}, folder_id={:?}, total_assignments={}",
            &path,
            &folder_id,
            list.len()
        );

        result_entry = new_entry;
    }

    // 写回持久化存储，并返回刚刚写入的条目（对于删除操作，则返回虚拟“删除结果”）
    match write_file_virtual_assignments_store(&app, &list).await {
        Ok(()) => ok(result_entry, trace),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("写入 Files 虚拟分组映射失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
async fn load_sidebar_state(
    app: AppHandle,
    trace_id: Option<String>,
) -> ResultPayload<SidebarState> {
    let trace = trace_id.unwrap_or_else(new_trace_id);
    match read_sidebar_state(&app).await {
        Ok(state) => ok(state, trace),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("读取侧边栏状态失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
async fn save_sidebar_state(
    app: AppHandle,
    state: SidebarState,
    trace_id: Option<String>,
) -> ResultPayload<()> {
    let trace = trace_id.unwrap_or_else(new_trace_id);
    match write_sidebar_state(&app, &state).await {
        Ok(()) => ok((), trace),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("写入侧边栏状态失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
async fn delete_fs_entry(
    _app: AppHandle,
    path: String,
    trace_id: Option<String>,
) -> ResultPayload<()> {
    let trace = trace_id.unwrap_or_else(new_trace_id);
    let normalized = match normalize_path(&path) {
        Ok(p) => p,
        Err(e) => return ResultPayload::Err { error: e },
    };

    // 根据实际类型选择删除文件或目录
    match fs::metadata(&normalized).await {
        Ok(meta) => {
            let res = if meta.is_file() {
                fs::remove_file(&normalized).await
            } else if meta.is_dir() {
                fs::remove_dir_all(&normalized).await
            } else {
                return err_payload(ErrorCode::UNSUPPORTED, "不支持删除该类型的条目", trace);
            };

            match res {
                Ok(()) => ok((), trace),
                Err(err) => err_payload(ErrorCode::IoError, format!("删除失败: {err}"), trace),
            }
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            err_payload(ErrorCode::NotFound, "目标不存在", trace)
        }
        Err(err) => err_payload(ErrorCode::IoError, format!("获取元数据失败: {err}"), trace),
    }
}

#[tauri::command]
async fn rename_fs_entry(
    _app: AppHandle,
    old_path: String,
    new_path: String,
    trace_id: Option<String>,
) -> ResultPayload<()> {
    let trace = trace_id.unwrap_or_else(new_trace_id);

    let src = match normalize_path(&old_path) {
        Ok(p) => p,
        Err(e) => return ResultPayload::Err { error: e },
    };
    let dst = match normalize_path(&new_path) {
        Ok(p) => p,
        Err(e) => return ResultPayload::Err { error: e },
    };

    if src == dst {
        return ok((), trace);
    }

    match fs::rename(&src, &dst).await {
        Ok(()) => ok((), trace),
        Err(err) => {
            use std::io::ErrorKind;
            let code = match err.kind() {
                ErrorKind::NotFound => ErrorCode::NotFound,
                ErrorKind::AlreadyExists => ErrorCode::CONFLICT,
                _ => ErrorCode::IoError,
            };
            err_payload(code, format!("重命名失败: {err}"), trace)
        }
    }
}

#[tauri::command]
async fn create_folder(
    _app: AppHandle,
    path: String,
    trace_id: Option<String>,
) -> ResultPayload<()> {
    let trace = trace_id.unwrap_or_else(new_trace_id);
    let normalized = match normalize_path(&path) {
        Ok(p) => p,
        Err(e) => return ResultPayload::Err { error: e },
    };

    match fs::create_dir_all(&normalized).await {
        Ok(()) => ok((), trace),
        Err(err) => err_payload(ErrorCode::IoError, format!("创建目录失败: {err}"), trace),
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
enum FsEntryKind {
    File,
    Dir,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct FsEntry {
    path: String,
    name: String,
    kind: FsEntryKind,
}

fn collect_entries(dir: &Path, acc: &mut Vec<FsEntry>) -> std::io::Result<()> {
    let rd = std::fs::read_dir(dir)?;
    for entry_res in rd {
        let entry = entry_res?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let meta = entry.metadata()?;

        if meta.is_dir() {
            acc.push(FsEntry {
                path: path.to_string_lossy().into_owned(),
                name: name.clone(),
                kind: FsEntryKind::Dir,
            });
            collect_entries(&path, acc)?;
        } else if meta.is_file() {
            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                let ext_lower = ext.to_ascii_lowercase();
                if matches!(ext_lower.as_str(), "md" | "markdown" | "mdx" | "txt") {
                    acc.push(FsEntry {
                        path: path.to_string_lossy().into_owned(),
                        name,
                        kind: FsEntryKind::File,
                    });
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn list_folder(
    _app: AppHandle,
    path: String,
    trace_id: Option<String>,
) -> ResultPayload<Vec<FsEntry>> {
    let trace = trace_id.unwrap_or_else(new_trace_id);
    let normalized = match normalize_path(&path) {
        Ok(p) => p,
        Err(e) => return ResultPayload::Err { error: e },
    };

    let meta = match fs::metadata(&normalized).await {
        Ok(m) => m,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("读取目录元数据失败: {err}"),
                trace,
            )
        }
    };

    if !meta.is_dir() {
        return err_payload(ErrorCode::InvalidPath, "目标不是目录", trace);
    }

    let mut entries = Vec::new();
    if let Err(err) = collect_entries(&normalized, &mut entries) {
        return err_payload(ErrorCode::IoError, format!("遍历目录失败: {err}"), trace);
    }

    ok(entries, trace)
}

#[tauri::command]
async fn set_title(app: AppHandle, title: String) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "window not found".to_string())?;
    window
        .set_title(&title)
        .map_err(|e: tauri::Error| e.to_string())
}

#[tauri::command]
async fn quit_app() {
    std::process::exit(0);
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RecentMenuPayload {
    path: String,
    is_folder: bool,
}

fn abbreviate_path_for_menu(path: &str) -> String {
    // 将用户主目录替换为 ~，让路径更短更易读
    if let Ok(home) = std::env::var("HOME") {
        if path.starts_with(&home) {
            let rest = &path[home.len()..];
            return format!("~{}", rest);
        }
    }
    path.to_string()
}

fn format_recent_menu_label(item: &RecentFile) -> String {
    let icon = if item.is_folder { "📁 " } else { "📄 " };
    format!("{}{}", icon, abbreviate_path_for_menu(&item.path))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MenuLocale {
    ZhCn,
    EnUs,
}

#[derive(Clone, Copy)]
struct MenuTexts {
    about_haomd: &'static str,
    settings: &'static str,
    quit: &'static str,
    open_recent: &'static str,
    clear_recent: &'static str,
    more: &'static str,
    export: &'static str,
    file: &'static str,
    new_file: &'static str,
    open: &'static str,
    open_folder: &'static str,
    save: &'static str,
    save_as: &'static str,
    close_file: &'static str,
    edit: &'static str,
    paste: &'static str,
    find: &'static str,
    replace: &'static str,
    toggle_comment: &'static str,
    format_document: &'static str,
    heading: &'static str,
    paragraph: &'static str,
    heading_1: &'static str,
    heading_2: &'static str,
    heading_3: &'static str,
    heading_4: &'static str,
    heading_5: &'static str,
    heading_6: &'static str,
    format: &'static str,
    emphasis: &'static str,
    strikethrough: &'static str,
    table: &'static str,
    code_block: &'static str,
    math_symbols: &'static str,
    math_greek: &'static str,
    math_discrete: &'static str,
    math_calculus: &'static str,
    math_linear_algebra: &'static str,
    math_relations: &'static str,
    math_arrows: &'static str,
    math_structures: &'static str,
    math_annotation: &'static str,
    layout: &'static str,
    preview_left: &'static str,
    preview_right: &'static str,
    editor_only: &'static str,
    preview_only: &'static str,
    dock_ai_chat: &'static str,
    floating: &'static str,
    dock_left: &'static str,
    dock_right: &'static str,
    view: &'static str,
    toggle_editor: &'static str,
    toggle_preview_only: &'static str,
    toggle_wysiwyg: &'static str,
    toggle_sidebar: &'static str,
    toggle_status_bar: &'static str,
    zoom_in: &'static str,
    zoom_out: &'static str,
    reset_zoom: &'static str,
    go_to_line: &'static str,
    next_tab: &'static str,
    previous_tab: &'static str,
    global_memory: &'static str,
    user_persona: &'static str,
    manage_global_memory: &'static str,
    session: &'static str,
    history: &'static str,
    compress: &'static str,
    clear: &'static str,
    tools: &'static str,
    agent_settings: &'static str,
    ai: &'static str,
    provider_settings: &'static str,
    prompt_settings: &'static str,
    open_ai_chat: &'static str,
    ask_ai_about_file: &'static str,
    ask_ai_about_selection: &'static str,
    help: &'static str,
    markdown_handbook: &'static str,
    release_notes: &'static str,
    report_issue: &'static str,
    about: &'static str,
    html: &'static str,
    print: &'static str,
    word_docx: &'static str,
}

fn menu_texts(locale: MenuLocale) -> MenuTexts {
    match locale {
        MenuLocale::ZhCn => MenuTexts {
            about_haomd: "关于 HaoMD",
            settings: "设置...",
            quit: "退出",
            open_recent: "打开最近文件",
            clear_recent: "清空最近记录",
            more: "更多...",
            export: "导出",
            file: "文件",
            new_file: "新建",
            open: "打开",
            open_folder: "打开文件夹",
            save: "保存",
            save_as: "另存为",
            close_file: "关闭文件",
            edit: "编辑",
            paste: "粘贴",
            find: "查找",
            replace: "替换",
            toggle_comment: "切换注释",
            format_document: "格式化文档",
            heading: "标题",
            paragraph: "段落",
            heading_1: "一级标题",
            heading_2: "二级标题",
            heading_3: "三级标题",
            heading_4: "四级标题",
            heading_5: "五级标题",
            heading_6: "六级标题",
            format: "格式",
            emphasis: "强调",
            strikethrough: "删除线",
            table: "表格",
            code_block: "代码块",
            math_symbols: "数学符号",
            math_greek: "希腊字母",
            math_discrete: "离散数学",
            math_calculus: "高等数学",
            math_linear_algebra: "线性代数",
            math_relations: "关系运算",
            math_arrows: "箭头",
            math_structures: "常用结构",
            math_annotation: "标注",
            layout: "布局",
            preview_left: "预览在左",
            preview_right: "预览在右",
            editor_only: "仅编辑器",
            preview_only: "仅预览",
            dock_ai_chat: "停靠 AI 对话",
            floating: "浮动",
            dock_left: "停靠左侧",
            dock_right: "停靠右侧",
            view: "视图",
            toggle_editor: "切换编辑器 ",
            toggle_preview_only: "切换仅预览",
            toggle_wysiwyg: "所见即所得模式",
            toggle_sidebar: "切换侧边栏",
            toggle_status_bar: "切换状态栏",
            zoom_in: "放大",
            zoom_out: "缩小",
            reset_zoom: "重置缩放",
            go_to_line: "跳转到行",
            next_tab: "下一个标签",
            previous_tab: "上一个标签",
            global_memory: "全局记忆",
            user_persona: "用户画像",
            manage_global_memory: "管理全局记忆",
            session: "会话",
            history: "历史记录",
            compress: "压缩",
            clear: "清空",
            tools: "工具",
            agent_settings: "Agent 设置",
            ai: "AI",
            provider_settings: "模型服务设置",
            prompt_settings: "提示词设置",
            open_ai_chat: "打开 AI 对话",
            ask_ai_about_file: "向 AI 询问文件",
            ask_ai_about_selection: "向 AI 询问选中内容",
            help: "帮助",
            markdown_handbook: "Markdown 手册",
            release_notes: "版本说明",
            report_issue: "报告问题",
            about: "关于",
            html: "HTML",
            print: "打印",
            word_docx: "Word (.docx)",
        },
        MenuLocale::EnUs => MenuTexts {
            about_haomd: "About HaoMD",
            settings: "Settings...",
            quit: "Quit",
            open_recent: "Open Recent",
            clear_recent: "Clear Recent",
            more: "More...",
            export: "Export",
            file: "File",
            new_file: "New",
            open: "Open",
            open_folder: "Open Folder",
            save: "Save",
            save_as: "Save As",
            close_file: "Close File",
            edit: "Edit",
            paste: "Paste",
            find: "Find",
            replace: "Replace",
            toggle_comment: "Toggle Comment",
            format_document: "Format Document",
            heading: "Heading",
            paragraph: "Paragraph",
            heading_1: "Heading 1",
            heading_2: "Heading 2",
            heading_3: "Heading 3",
            heading_4: "Heading 4",
            heading_5: "Heading 5",
            heading_6: "Heading 6",
            format: "Format",
            emphasis: "Emphasis",
            strikethrough: "Strikethrough",
            table: "Table",
            code_block: "Code Block",
            math_symbols: "Math Symbols",
            math_greek: "Greek Letters",
            math_discrete: "Discrete Math",
            math_calculus: "Calculus",
            math_linear_algebra: "Linear Algebra",
            math_relations: "Relations",
            math_arrows: "Arrows",
            math_structures: "Structures",
            math_annotation: "Annotation",
            layout: "Layout",
            preview_left: "Preview Left",
            preview_right: "Preview Right",
            editor_only: "Editor Only",
            preview_only: "Preview Only",
            dock_ai_chat: "Dock AI Chat",
            floating: "Floating",
            dock_left: "Dock Left",
            dock_right: "Dock Right",
            view: "View",
            toggle_editor: "Toggle Editor",
            toggle_preview_only: "Toggle Preview Only",
            toggle_wysiwyg: "WYSIWYG Mode",
            toggle_sidebar: "Toggle Sidebar",
            toggle_status_bar: "Toggle Status Bar",
            zoom_in: "Zoom In",
            zoom_out: "Zoom Out",
            reset_zoom: "Reset Zoom",
            go_to_line: "Go to Line",
            next_tab: "Next Tab",
            previous_tab: "Previous Tab",
            global_memory: "Global Memory",
            user_persona: "User Persona",
            manage_global_memory: "Manage Global Memory",
            session: "Session",
            history: "History",
            compress: "Compress",
            clear: "Clear",
            tools: "Tools",
            agent_settings: "Agent Settings",
            ai: "AI",
            provider_settings: "Provider Settings",
            prompt_settings: "Prompt Settings",
            open_ai_chat: "Open AI Chat",
            ask_ai_about_file: "Ask AI About File",
            ask_ai_about_selection: "Ask AI About Selection",
            help: "Help",
            markdown_handbook: "Markdown Handbook",
            release_notes: "Release Notes",
            report_issue: "Report Issue",
            about: "About",
            html: "HTML",
            print: "Print",
            word_docx: "Word (.docx)",
        },
    }
}

fn detect_system_menu_locale() -> MenuLocale {
    let locale_value = ["LC_ALL", "LC_MESSAGES", "LANG"]
        .into_iter()
        .find_map(|key| std::env::var(key).ok())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if locale_value.starts_with("zh") {
        MenuLocale::ZhCn
    } else {
        MenuLocale::EnUs
    }
}

fn menu_locale_language_tag(locale: MenuLocale) -> &'static str {
    match locale {
        MenuLocale::ZhCn => "zh-CN",
        MenuLocale::EnUs => "en-US",
    }
}

async fn resolve_menu_locale(app: &AppHandle) -> MenuLocale {
    let path = match editor_settings_path(app) {
        Ok(path) => path,
        Err(_) => return detect_system_menu_locale(),
    };

    let bytes = match tokio::fs::read(path).await {
        Ok(bytes) => bytes,
        Err(_) => return detect_system_menu_locale(),
    };

    let cfg: EditorSettingsCfg = match serde_json::from_slice(&bytes) {
        Ok(cfg) => cfg,
        Err(_) => return detect_system_menu_locale(),
    };

    match cfg.language.as_deref() {
        Some("zh-CN") => MenuLocale::ZhCn,
        Some("en-US") => MenuLocale::EnUs,
        _ => detect_system_menu_locale(),
    }
}

#[tauri::command]
async fn get_system_language(app: AppHandle) -> Result<String, String> {
    Ok(menu_locale_language_tag(resolve_menu_locale(&app).await).to_string())
}

pub(crate) async fn build_app_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let texts = menu_texts(resolve_menu_locale(app).await);
    // 读取最近文件列表，用于构建 Open Recent 子菜单
    let mut recent = read_recent_store(app).await.unwrap_or_default();
    // 按时间降序，防御性处理
    recent.sort_by(|a, b| b.last_opened_at.cmp(&a.last_opened_at));

    let total = recent.len();
    let page_size = RECENT_PAGE_SIZE as u32;
    let max_page = if total == 0 {
        0
    } else {
        ((total.saturating_sub(1)) as u32) / page_size
    };

    let current_page = {
        let mut guard = RECENT_PAGE.lock().unwrap();
        if *guard > max_page {
            *guard = max_page;
        }
        *guard
    };

    let start = (current_page * page_size) as usize;
    let end = ((current_page + 1) * page_size) as usize;

    let slice = if start >= total {
        &recent[0..0]
    } else {
        &recent[start..std::cmp::min(end, total)]
    };

    // HaoMD 菜单
    let haomd_menu = SubmenuBuilder::new(app, "HaoMD")
        .item(
            &MenuItemBuilder::new(texts.about_haomd)
                .id("haomd_about")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::new(texts.settings)
                .id("haomd_settings")
                .accelerator("CmdOrCtrl+,")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::new(texts.quit)
                .id("quit")
                .accelerator("CmdOrCtrl+Q")
                .build(app)?,
        )
        .build()?;

    // Open Recent 原生子菜单：展示前若干最近文件 + Clear Recent + More...
    let mut open_recent_builder = SubmenuBuilder::new(app, texts.open_recent);
    {
        let mut map = RECENT_MENU_MAP.lock().unwrap();
        map.clear();

        for (idx, item) in slice.iter().enumerate() {
            let id = format!("{RECENT_MENU_PREFIX}{idx}");
            map.insert(
                id.clone(),
                RecentMenuPayload {
                    path: item.path.clone(),
                    is_folder: item.is_folder,
                },
            );

            let label = format_recent_menu_label(item);
            open_recent_builder =
                open_recent_builder.item(&MenuItemBuilder::new(&label).id(&id).build(app)?);
        }
    }

    if !slice.is_empty() {
        open_recent_builder = open_recent_builder.separator();
    }

    // 清空最近：仍然保留在菜单层
    open_recent_builder = open_recent_builder.item(
        &MenuItemBuilder::new(texts.clear_recent)
            .id("clear_recent")
            .build(app)?,
    );

    // More...：打开前端最近文件模态窗（open_recent_dialog 命令）
    open_recent_builder = open_recent_builder.item(
        &MenuItemBuilder::new(texts.more)
            .id("open_recent_dialog")
            .build(app)?,
    );

    let open_recent_menu = open_recent_builder.build()?;

    let export_menu = SubmenuBuilder::new(app, texts.export)
        .item(
            &MenuItemBuilder::new(texts.html)
                .id("export_html")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.word_docx)
                .id("export_word")
                .build(app)?,
        )
        .build()?;

    // File 菜单
    let file_menu = SubmenuBuilder::new(app, texts.file)
        .item(
            &MenuItemBuilder::new(texts.new_file)
                .id("new_file")
                .accelerator("CmdOrCtrl+n")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::new(texts.open)
                .id("open_file")
                .accelerator("CmdOrCtrl+o")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.open_folder)
                .id("open_folder")
                .accelerator("CmdOrCtrl+Shift+o")
                .build(app)?,
        )
        .item(&open_recent_menu)
        .separator()
        .item(
            &MenuItemBuilder::new(texts.save)
                .id("save")
                .accelerator("CmdOrCtrl+s")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.save_as)
                .id("save_as")
                .accelerator("CmdOrCtrl+Shift+s")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.print)
                .id("export_pdf")
                .accelerator("CmdOrCtrl+p")
                .build(app)?,
        )
        .separator()
        .item(&export_menu)
        .separator()
        .item(
            &MenuItemBuilder::new(texts.close_file)
                .id("close_file")
                .accelerator("CmdOrCtrl+w")
                .build(app)?,
        )
        .build()?;

    // Edit 菜单
    let edit_menu = SubmenuBuilder::new(app, texts.edit)
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(
            &MenuItemBuilder::new(texts.paste)
                .id("paste")
                .accelerator("CmdOrCtrl+v")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::new(texts.find)
                .id("find")
                .accelerator("CmdOrCtrl+f")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.replace)
                .id("replace")
                .build(app)?,
        )
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .item(
            &MenuItemBuilder::new(texts.toggle_comment)
                .id("toggle_comment")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.format_document)
                .id("format_document")
                .build(app)?,
        )
        .build()?;

    // Heading 子菜单
    let heading_menu = SubmenuBuilder::new(app, texts.heading)
        .item(
            &MenuItemBuilder::new(texts.paragraph)
                .id("format_heading_paragraph")
                .accelerator("CmdOrCtrl+0")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.heading_1)
                .id("format_heading_1")
                .accelerator("CmdOrCtrl+1")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.heading_2)
                .id("format_heading_2")
                .accelerator("CmdOrCtrl+2")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.heading_3)
                .id("format_heading_3")
                .accelerator("CmdOrCtrl+3")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.heading_4)
                .id("format_heading_4")
                .accelerator("CmdOrCtrl+4")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.heading_5)
                .id("format_heading_5")
                .accelerator("CmdOrCtrl+5")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.heading_6)
                .id("format_heading_6")
                .accelerator("CmdOrCtrl+6")
                .build(app)?,
        )
        .build()?;

    // Math Symbols 子菜单（各分类点击后在前端弹出符号选择对话框）
    let math_symbols_menu = SubmenuBuilder::new(app, texts.math_symbols)
        .item(
            &MenuItemBuilder::new(texts.math_greek)
                .id("format_math_cat_greek")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.math_discrete)
                .id("format_math_cat_discrete")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.math_calculus)
                .id("format_math_cat_calculus")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.math_linear_algebra)
                .id("format_math_cat_linear_algebra")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.math_relations)
                .id("format_math_cat_relations")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.math_arrows)
                .id("format_math_cat_arrows")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.math_structures)
                .id("format_math_cat_structures")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.math_annotation)
                .id("format_math_cat_annotation")
                .build(app)?,
        )
        .build()?;

    // Format 菜单
    let format_menu = SubmenuBuilder::new(app, texts.format)
        .item(&heading_menu)
        .item(
            &MenuItemBuilder::new(texts.emphasis)
                .id("format_emphasize_selection")
                .accelerator("CmdOrCtrl+B")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.strikethrough)
                .id("format_strikethrough")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.table)
                .id("format_insert_table")
                .accelerator("CmdOrCtrl+T")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.code_block)
                .id("format_insert_code_block")
                .accelerator("CmdOrCtrl+Alt+C")
                .build(app)?,
        )
        .separator()
        .item(&math_symbols_menu)
        .build()?;

    let layout_menu = SubmenuBuilder::new(app, texts.layout)
        .item(
            &MenuItemBuilder::new(texts.preview_left)
                .id("layout_preview_left")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.preview_right)
                .id("layout_preview_right")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.editor_only)
                .id("layout_editor_only")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.preview_only)
                .id("layout_preview_only")
                .build(app)?,
        )
        .build()?;

    let dock_ai_chat_menu = SubmenuBuilder::new(app, texts.dock_ai_chat)
        .item(
            &MenuItemBuilder::new(texts.floating)
                .id("view_ai_chat_floating")
                .accelerator("CmdOrCtrl+Shift+F")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.dock_left)
                .id("view_ai_chat_dock_left")
                .accelerator("CmdOrCtrl+Shift+L")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.dock_right)
                .id("view_ai_chat_dock_right")
                .accelerator("CmdOrCtrl+Shift+R")
                .build(app)?,
        )
        .build()?;

    let view_menu = SubmenuBuilder::new(app, texts.view)
        .item(
            &MenuItemBuilder::new(texts.toggle_editor)
                .id("toggle_preview")
                .accelerator("CmdOrCtrl+P")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.toggle_preview_only)
                .id("toggle_preview_only")
                .accelerator("CmdOrCtrl+Shift+P")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.toggle_wysiwyg)
                .id("toggle_wysiwyg")
                .accelerator("CmdOrCtrl+Alt+W")
                .build(app)?,
        )
        // .item(&MenuItemBuilder::new("Split View").id("split_view").build(app)?)
        .item(
            &MenuItemBuilder::new(texts.toggle_sidebar)
                .id("toggle_sidebar")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.toggle_status_bar)
                .id("toggle_status_bar")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.zoom_in)
                .id("zoom_in")
                .accelerator("CmdOrCtrl+=")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.zoom_out)
                .id("zoom_out")
                .accelerator("CmdOrCtrl+-")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.reset_zoom)
                .id("zoom_reset")
                .accelerator("CmdOrCtrl+Shift+0")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.go_to_line)
                .id("go_line")
                .accelerator("CmdOrCtrl+L")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.next_tab)
                .id("next_tab")
                .accelerator("Ctrl+Tab")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.previous_tab)
                .id("prev_tab")
                .accelerator("Ctrl+Shift+Tab")
                .build(app)?,
        )
        // .item(&MenuItemBuilder::new("Word Wrap").id("word_wrap").build(app)?)
        // .item(&MenuItemBuilder::new("Developer Tools").id("devtools").accelerator("CmdOrCtrl+Shift+I").build(app)?)
        .item(&dock_ai_chat_menu)
        .item(&layout_menu)
        .build()?;

    let global_memory_menu = SubmenuBuilder::new(app, texts.global_memory)
        .item(
            &MenuItemBuilder::new(texts.user_persona)
                .id("ai_session_globalMemory_userPersona")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.manage_global_memory)
                .id("ai_session_globalMemory_manage")
                .build(app)?,
        )
        .build()?;

    let ai_conversation_menu = SubmenuBuilder::new(app, texts.session)
        .item(
            &MenuItemBuilder::new(texts.history)
                .id("ai_conversation_history")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.compress)
                .id("ai_conversation_compress")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.clear)
                .id("ai_conversation_clear")
                .build(app)?,
        )
        .item(&global_memory_menu)
        .build()?;

    let tools_menu = SubmenuBuilder::new(app, texts.tools).build()?;

    let ai_menu = SubmenuBuilder::new(app, texts.ai)
        .item(
            &MenuItemBuilder::new(texts.provider_settings)
                .id("ai_settings")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.agent_settings)
                .id("agent_settings")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.prompt_settings)
                .id("ai_prompt_settings")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.open_ai_chat)
                .id("ai_chat")
                .accelerator("CmdOrCtrl+K")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.ask_ai_about_file)
                .id("ai_ask_file")
                .accelerator("CmdOrCtrl+D")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.ask_ai_about_selection)
                .id("ai_ask_selection")
                .accelerator("CmdOrCtrl+L")
                .build(app)?,
        )
        .item(&ai_conversation_menu)
        .build()?;

    let help_menu = SubmenuBuilder::new(app, texts.help)
        .item(
            &MenuItemBuilder::new(texts.markdown_handbook)
                .id("help_docs")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.release_notes)
                .id("help_release")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.report_issue)
                .id("help_issue")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.about)
                .id("help_about")
                .build(app)?,
        )
        .build()?;

    let menu = MenuBuilder::new(app)
        .item(&haomd_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&format_menu)
        .item(&view_menu)
        .item(&tools_menu)
        .item(&ai_menu)
        .item(&help_menu)
        .build()?;

    Ok(menu)
}

pub(crate) async fn refresh_app_menu(app: &AppHandle) {
    if let Ok(menu) = build_app_menu(app).await {
        let _ = app.set_menu(menu);
    }
}

#[tauri::command]
async fn load_ai_settings(app: AppHandle) -> ResultPayload<AiSettingsCfg> {
    let trace = new_trace_id();
    let path = match ai_settings_path(&app) {
        Ok(p) => p,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取 ai_settings 路径失败: {err}"),
                trace,
            );
        }
    };

    match fs::read(&path).await {
        Ok(bytes) => {
            let cfg: AiSettingsCfg = serde_json::from_slice(&bytes).unwrap_or(AiSettingsCfg {
                providers: Vec::new(),
                default_provider_id: None,
            });
            ok(cfg, trace)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            // 如果用户配置文件不存在，使用内置默认配置
            let cfg: AiSettingsCfg =
                serde_json::from_str(DEFAULT_AI_SETTINGS_JSON).unwrap_or(AiSettingsCfg {
                    providers: Vec::new(),
                    default_provider_id: None,
                });
            ok(cfg, trace)
        }
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("读取 ai_settings 失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
async fn save_ai_settings(app: AppHandle, cfg: AiSettingsCfg) -> ResultPayload<()> {
    let trace = new_trace_id();
    let path = match ai_settings_path(&app) {
        Ok(p) => p,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取 ai_settings 路径失败: {err}"),
                trace,
            );
        }
    };

    let bytes = match serde_json::to_vec_pretty(&cfg) {
        Ok(b) => b,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("序列化 ai_settings 失败: {err}"),
                trace,
            );
        }
    };

    match fs::write(&path, bytes).await {
        Ok(()) => ok((), trace),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("写入 ai_settings 失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
async fn load_prompt_settings(app: AppHandle) -> ResultPayload<PromptSettingsCfg> {
    let trace = new_trace_id();
    let path = match prompt_settings_path(&app) {
        Ok(p) => p,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取 prompt_settings 路径失败: {err}"),
                trace,
            );
        }
    };

    match fs::read(&path).await {
        Ok(bytes) => {
            let cfg: PromptSettingsCfg =
                serde_json::from_slice(&bytes).unwrap_or(PromptSettingsCfg {
                    roles: Vec::new(),
                    default_role_id: None,
                });
            ok(cfg, trace)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => ok(
            PromptSettingsCfg {
                roles: Vec::new(),
                default_role_id: None,
            },
            trace,
        ),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("读取 prompt_settings 失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
async fn save_prompt_settings(app: AppHandle, cfg: PromptSettingsCfg) -> ResultPayload<()> {
    let trace = new_trace_id();
    let path = match prompt_settings_path(&app) {
        Ok(p) => p,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取 prompt_settings 路径失败: {err}"),
                trace,
            );
        }
    };

    let bytes = match serde_json::to_vec_pretty(&cfg) {
        Ok(b) => b,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("序列化 prompt_settings 失败: {err}"),
                trace,
            );
        }
    };

    match fs::write(&path, bytes).await {
        Ok(()) => ok((), trace),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("写入 prompt_settings 失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
async fn load_agent_settings(app: AppHandle) -> ResultPayload<AgentSettingsCfg> {
    let trace = new_trace_id();
    let path = match agent_settings_path(&app) {
        Ok(p) => p,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取 agent_settings 路径失败: {err}"),
                trace,
            );
        }
    };

    match fs::read(&path).await {
        Ok(bytes) => {
            let cfg: AgentSettingsCfg =
                serde_json::from_slice(&bytes).unwrap_or(AgentSettingsCfg {
                    providers: Vec::new(),
                    default_provider_id: None,
                });
            ok(cfg, trace)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => ok(
            AgentSettingsCfg {
                providers: Vec::new(),
                default_provider_id: None,
            },
            trace,
        ),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("读取 agent_settings 失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
async fn save_agent_settings(app: AppHandle, cfg: AgentSettingsCfg) -> ResultPayload<()> {
    let trace = new_trace_id();
    let path = match agent_settings_path(&app) {
        Ok(p) => p,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取 agent_settings 路径失败: {err}"),
                trace,
            );
        }
    };

    let bytes = match serde_json::to_vec_pretty(&cfg) {
        Ok(b) => b,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("序列化 agent_settings 失败: {err}"),
                trace,
            );
        }
    };

    match fs::write(&path, bytes).await {
        Ok(()) => ok((), trace),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("写入 agent_settings 失败: {err}"),
            trace,
        ),
    }
}

fn open_path_in_file_explorer(target_path: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(target_path)
            .spawn()
            .map_err(|e| format!("无法打开 Finder: {e}"))?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(target_path)
            .spawn()
            .map_err(|e| format!("无法打开文件管理器: {e}"))?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(target_path)
            .spawn()
            .map_err(|e| format!("无法打开文件管理器: {e}"))?;
    }

    Ok(())
}

#[tauri::command]
async fn open_in_file_explorer(target_path: String) -> Result<(), String> {
    use std::path::Path;

    if target_path.trim().is_empty() {
        return Err("target_path is empty".to_string());
    }

    let path = Path::new(&target_path);
    if !path.exists() {
        return Err(format!("路径不存在: {}", target_path));
    }

    open_path_in_file_explorer(&target_path)
}

#[tauri::command]
async fn open_word_templates_dir(app: AppHandle) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {e}"))?;
    let templates_dir = app_data_dir.join("word_templates");
    std::fs::create_dir_all(&templates_dir)
        .map_err(|e| format!("无法创建 word_templates 目录: {e}"))?;

    let target = templates_dir.to_string_lossy().into_owned();
    open_path_in_file_explorer(&target)?;
    Ok(target)
}

#[tauri::command]
async fn list_word_templates(app: AppHandle) -> Result<Vec<WordTemplateEntry>, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {e}"))?;
    let templates_dir = app_data_dir.join("word_templates");
    std::fs::create_dir_all(&templates_dir)
        .map_err(|e| format!("无法创建 word_templates 目录: {e}"))?;

    let mut items = Vec::new();
    let entries = std::fs::read_dir(&templates_dir)
        .map_err(|e| format!("无法读取 word_templates 目录: {e}"))?;

    for entry in entries {
        let entry = match entry {
            Ok(v) => v,
            Err(_) => continue,
        };
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path.extension().and_then(|s| s.to_str()) != Some("docx") {
            continue;
        }
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or_default();
        if !stem.starts_with("template_") {
            continue;
        }
        let json_path = templates_dir.join(format!("{stem}.json"));
        if !json_path.exists() {
            continue;
        }

        let id = stem
            .strip_prefix("template_")
            .map(|s| s.to_string())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "unknown-template".to_string());

        let name = std::fs::read_to_string(&json_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
            .and_then(|value| {
                value
                    .get("name")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| id.clone());

        items.push(WordTemplateEntry {
            id,
            name,
            dir: templates_dir.to_string_lossy().into_owned(),
            docx_path: path.to_string_lossy().into_owned(),
            json_path: json_path.to_string_lossy().into_owned(),
        });
    }

    items.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(items)
}

#[tauri::command]
async fn get_word_template_config(app: AppHandle, template_id: String) -> Result<String, String> {
    let (_, json_path) = resolve_word_template_paths(&app, &template_id)?;
    std::fs::read_to_string(&json_path).map_err(|e| format!("读取模板配置失败: {e}"))
}

fn resolve_word_templates_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {e}"))?;
    let templates_dir = app_data_dir.join("word_templates");
    std::fs::create_dir_all(&templates_dir)
        .map_err(|e| format!("无法创建 word_templates 目录: {e}"))?;
    Ok(templates_dir)
}

fn resolve_word_template_paths(
    app: &AppHandle,
    template_id: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let templates_dir = resolve_word_templates_dir(app)?;
    let stem = format!("template_{template_id}");
    let docx_path = templates_dir.join(format!("{stem}.docx"));
    let json_path = templates_dir.join(format!("{stem}.json"));
    if !docx_path.exists() {
        return Err(format!("未找到模板文件: {}", docx_path.display()));
    }
    if !json_path.exists() {
        return Err(format!("未找到模板配置文件: {}", json_path.display()));
    }
    Ok((docx_path, json_path))
}

fn build_template_replacements(
    template_cfg: &WordTemplateConfigCfg,
    model: &serde_json::Value,
    rich_blocks: &HashMap<String, Vec<WordBlockCfg>>,
) -> Result<Vec<TemplateReplacement>, String> {
    let mut render_state = WordRenderState {
        next_rel_id: 3,
        next_doc_pr_id: 1,
        style_settings: resolve_word_export_style_settings(None),
        ..Default::default()
    };
    let mut replacements = Vec::new();

    for binding in &template_cfg.bindings {
        if binding.binding_type == "richText" {
            let rendered = rich_blocks
                .get(&binding.field)
                .map(|blocks| render_word_blocks(blocks, &mut render_state, 0, None))
                .transpose()?
                .unwrap_or_default();
            replacements.push(TemplateReplacement::Paragraph {
                placeholder: binding.placeholder.clone(),
                xml: rendered,
            });
        } else {
            let raw_value = get_json_value_by_path(model, &binding.field)
                .map(stringify_template_value)
                .unwrap_or_default();
            replacements.push(TemplateReplacement::Text {
                placeholder: binding.placeholder.clone(),
                value: escape_xml_text(&raw_value),
            });
        }
    }

    Ok(replacements)
}

fn get_json_value_by_path<'a>(
    value: &'a serde_json::Value,
    path: &str,
) -> Option<&'a serde_json::Value> {
    let mut current = value;
    for segment in path.split('.') {
        current = current.get(segment)?;
    }
    Some(current)
}

fn stringify_template_value(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => String::new(),
        serde_json::Value::String(text) => text.clone(),
        serde_json::Value::Bool(flag) => {
            if *flag {
                "true".to_string()
            } else {
                "false".to_string()
            }
        }
        serde_json::Value::Number(num) => num.to_string(),
        serde_json::Value::Array(items) => items
            .iter()
            .map(stringify_template_value)
            .filter(|item| !item.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        serde_json::Value::Object(_) => serde_json::to_string_pretty(value).unwrap_or_default(),
    }
}

enum TemplateReplacement {
    Text { placeholder: String, value: String },
    Paragraph { placeholder: String, xml: String },
}

fn rewrite_docx_template(
    template_docx: &Path,
    output_docx: &Path,
    replacements: &[TemplateReplacement],
) -> Result<(), String> {
    let bytes = std::fs::read(template_docx).map_err(|e| format!("读取模板文件失败: {e}"))?;
    let reader = Cursor::new(bytes);
    let mut archive =
        zip::ZipArchive::new(reader).map_err(|e| format!("读取模板 docx 失败: {e}"))?;

    let file = std::fs::File::create(output_docx).map_err(|e| format!("创建输出文件失败: {e}"))?;
    let mut writer = ZipWriter::new(file);

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| format!("读取模板条目失败: {e}"))?;
        let entry_name = entry.name().to_string();
        let options = SimpleFileOptions::default().compression_method(entry.compression());

        if entry.is_dir() {
            writer
                .add_directory(entry_name, options)
                .map_err(|e| format!("写入模板目录失败: {e}"))?;
            continue;
        }

        let mut data = Vec::new();
        entry
            .read_to_end(&mut data)
            .map_err(|e| format!("读取模板内容失败: {e}"))?;

        writer
            .start_file(entry_name.clone(), options)
            .map_err(|e| format!("创建模板输出条目失败: {e}"))?;

        if entry_name == "word/document.xml" {
            let xml =
                String::from_utf8(data).map_err(|e| format!("读取模板 document.xml 失败: {e}"))?;
            let rendered = apply_template_replacements(&xml, replacements);
            writer
                .write_all(rendered.as_bytes())
                .map_err(|e| format!("写入模板 document.xml 失败: {e}"))?;
        } else {
            writer
                .write_all(&data)
                .map_err(|e| format!("写入模板条目失败: {e}"))?;
        }
    }

    writer
        .finish()
        .map_err(|e| format!("完成模板 docx 生成失败: {e}"))?;
    Ok(())
}

fn apply_template_replacements(document_xml: &str, replacements: &[TemplateReplacement]) -> String {
    let mut xml = document_xml.to_string();
    for replacement in replacements {
        match replacement {
            TemplateReplacement::Text { placeholder, value } => {
                xml = xml.replace(placeholder, value);
            }
            TemplateReplacement::Paragraph {
                placeholder,
                xml: rendered,
            } => {
                xml = replace_placeholder_paragraph(&xml, placeholder, rendered);
            }
        }
    }
    xml
}

fn replace_placeholder_paragraph(
    document_xml: &str,
    placeholder: &str,
    replacement_xml: &str,
) -> String {
    let mut xml = document_xml.to_string();
    while let Some(placeholder_index) = xml.find(placeholder) {
        let Some((paragraph_start, paragraph_end)) =
            find_enclosing_paragraph_range(&xml, placeholder_index)
        else {
            xml = xml.replacen(placeholder, replacement_xml, 1);
            continue;
        };

        let mut out = String::with_capacity(
            xml.len().saturating_sub(paragraph_end - paragraph_start) + replacement_xml.len(),
        );
        out.push_str(&xml[..paragraph_start]);
        out.push_str(replacement_xml);
        out.push_str(&xml[paragraph_end..]);
        xml = out;
    }
    xml
}

fn find_enclosing_paragraph_range(
    document_xml: &str,
    target_index: usize,
) -> Option<(usize, usize)> {
    for (start, end) in iter_paragraph_ranges(document_xml) {
        if start <= target_index && target_index < end {
            return Some((start, end));
        }
    }
    None
}

fn iter_paragraph_ranges(document_xml: &str) -> Vec<(usize, usize)> {
    let bytes = document_xml.as_bytes();
    let mut ranges = Vec::new();
    let mut current_start: Option<usize> = None;
    let mut index = 0usize;

    while index < bytes.len() {
        if bytes[index] != b'<' {
            index += 1;
            continue;
        }

        if document_xml[index..].starts_with("<w:p>") {
            current_start = Some(index);
            index += "<w:p>".len();
            continue;
        }

        if document_xml[index..].starts_with("<w:p ") {
            current_start = Some(index);
            if let Some(tag_end_rel) = document_xml[index..].find('>') {
                index += tag_end_rel + 1;
                continue;
            }
            break;
        }

        if document_xml[index..].starts_with("</w:p>") {
            if let Some(start) = current_start.take() {
                ranges.push((start, index + "</w:p>".len()));
            }
            index += "</w:p>".len();
            continue;
        }

        index += 1;
    }

    ranges
}

fn open_markdown_handbook(app: &AppHandle) {
    // dev 模式下 resource_dir 可能是 src-tauri 根目录；
    // 打包后则是应用的 Resources 目录。
    let resource_dir = match app.path().resource_dir() {
        Ok(dir) => dir,
        Err(err) => {
            log::error!("[Help] failed to get resource_dir: {}", err);
            return;
        }
    };

    // 同时尝试两种常见布局：
    // 1) resource_dir/markdown-handbook.html
    // 2) resource_dir/resources/markdown-handbook.html
    let candidates = [
        resource_dir.join("markdown-handbook.html"),
        resource_dir
            .join("resources")
            .join("markdown-handbook.html"),
    ];

    let html_path = match candidates.iter().find(|p| p.exists()) {
        Some(p) => p.clone(),
        None => {
            log::error!(
                "[Help] markdown-handbook.html not found in resource_dir={:?}",
                resource_dir
            );
            return;
        }
    };

    let html_path = html_path.to_string_lossy().into_owned();

    if let Err(err) = app.opener().open_path(html_path, None::<&str>) {
        log::error!("[Help] failed to open handbook: {}", err);
    }
}

#[tauri::command]
async fn open_webview_browser(app: AppHandle, url: String) -> Result<(), String> {
    if url.trim().is_empty() {
        return Err("url is empty".to_string());
    }

    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("无法打开浏览器: {e}"))?;

    Ok(())
}

#[tauri::command]
async fn open_terminal(cwd: String) -> Result<(), String> {
    use std::path::Path;

    if cwd.trim().is_empty() {
        return Err("cwd is empty".to_string());
    }

    let path = Path::new(&cwd);
    if !path.exists() {
        return Err(format!("目录不存在: {}", cwd));
    }
    if !path.is_dir() {
        return Err(format!("不是目录: {}", cwd));
    }

    #[cfg(target_os = "macos")]
    {
        // 关键：把目标目录作为参数传给 `open`，让 Terminal 在该目录启动
        Command::new("open")
            .arg("-a")
            .arg("Terminal")
            .arg(&cwd)
            .spawn()
            .map_err(|e| format!("无法启动 Terminal: {e}"))?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start"])
            .current_dir(path)
            .spawn()
            .map_err(|e| format!("无法启动终端: {e}"))?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("x-terminal-emulator")
            .current_dir(path)
            .spawn()
            .map_err(|e| format!("无法启动终端: {e}"))?;
    }

    Ok(())
}

#[tauri::command]
async fn save_clipboard_image_to_dir(
    target_dir: String,
    suggested_name: Option<String>,
) -> ResultPayload<ClipboardImageResult> {
    let trace = new_trace_id();
    log::info!(
        "[tauri] save_clipboard_image_to_dir: target_dir={}, suggested_name={:?}",
        target_dir,
        suggested_name
    );

    let normalized_dir = match normalize_path(&target_dir) {
        Ok(p) => p,
        Err(e) => return ResultPayload::Err { error: e },
    };

    if let Err(err) = std::fs::create_dir_all(&normalized_dir) {
        return err_payload(
            ErrorCode::IoError,
            format!("创建图片目录失败: {err}"),
            trace,
        );
    }

    let mut cb = match Clipboard::new() {
        Ok(c) => c,
        Err(err) => {
            return err_payload(ErrorCode::IoError, format!("访问剪贴板失败: {err}"), trace);
        }
    };

    let img = match cb.get_image() {
        Ok(img) => {
            log::info!(
                "[tauri] save_clipboard_image_to_dir: got image {}x{}",
                img.width,
                img.height
            );
            img
        }
        Err(err) => {
            log::error!(
                "[tauri] save_clipboard_image_to_dir: get_image failed: {}",
                err
            );
            return err_payload(
                ErrorCode::UNSUPPORTED,
                format!("剪贴板中没有图片或格式不支持: {err}"),
                trace,
            );
        }
    };

    let width = img.width as u32;
    let height = img.height as u32;

    let buffer: ImageBuffer<Rgba<u8>, _> =
        match ImageBuffer::from_raw(width, height, img.bytes.into_owned()) {
            Some(buf) => buf,
            None => {
                return err_payload(ErrorCode::UNSUPPORTED, "图片数据无效", trace);
            }
        };

    // 文件命名规则：image_当前文件名_编号
    // 这里的 suggested_name 由前端根据当前文件名构造，例如 "image_提示词技巧"
    let base_name = suggested_name.unwrap_or_else(|| "image".to_string());

    // 依次尝试 base_name_1.png, base_name_2.png ...，直到找到一个不存在的文件名
    let mut index: u32 = 1;
    let file_name = loop {
        let candidate = format!("{}_{}.png", base_name, index);
        let candidate_path = normalized_dir.join(&candidate);
        if !candidate_path.exists() {
            break candidate;
        }
        index += 1;
        if index > 9999 {
            // 防御性兜底：如果编号过大仍然冲突， fallback 到随机命名
            let rand_suffix: String = rand::thread_rng()
                .sample_iter(&Alphanumeric)
                .take(6)
                .map(char::from)
                .collect();
            let timestamp = Local::now().format("%Y%m%d-%H%M%S-%3f");
            break format!("{}_{}_{}.png", base_name, timestamp, rand_suffix);
        }
    };

    let full_path = normalized_dir.join(&file_name);
    log::info!(
        "[tauri] save_clipboard_image_to_dir: saving to {:?}",
        full_path
    );
    if let Err(err) = buffer.save(&full_path) {
        log::error!("[tauri] save_clipboard_image_to_dir: save failed: {}", err);
        return err_payload(ErrorCode::IoError, format!("写入图片失败: {err}"), trace);
    }

    log::info!(
        "[tauri] save_clipboard_image_to_dir: ok, file_name={}",
        file_name
    );
    ok(ClipboardImageResult { file_name }, trace)
}

#[tauri::command]
async fn read_clipboard_image_as_base64() -> ResultPayload<String> {
    let trace = new_trace_id();
    log::info!("[tauri] read_clipboard_image_as_base64: start");

    let mut cb = match Clipboard::new() {
        Ok(c) => c,
        Err(err) => {
            return err_payload(ErrorCode::IoError, format!("访问剪贴板失败: {err}"), trace);
        }
    };

    let img = match cb.get_image() {
        Ok(img) => {
            log::info!(
                "[tauri] read_clipboard_image_as_base64: got image {}x{}",
                img.width,
                img.height
            );
            img
        }
        Err(err) => {
            log::error!(
                "[tauri] read_clipboard_image_as_base64: get_image failed: {}",
                err
            );
            return err_payload(
                ErrorCode::UNSUPPORTED,
                format!("剪贴板中没有图片或格式不支持: {err}"),
                trace,
            );
        }
    };

    let width = img.width as u32;
    let height = img.height as u32;

    let buffer: ImageBuffer<Rgba<u8>, _> =
        match ImageBuffer::from_raw(width, height, img.bytes.into_owned()) {
            Some(buf) => buf,
            None => {
                return err_payload(ErrorCode::UNSUPPORTED, "图片数据无效", trace);
            }
        };

    let dyn_img = DynamicImage::ImageRgba8(buffer);
    let mut png_bytes: Vec<u8> = Vec::new();
    {
        let mut cursor = Cursor::new(&mut png_bytes);
        if let Err(err) = dyn_img.write_to(&mut cursor, ImageFormat::Png) {
            log::error!(
                "[tauri] read_clipboard_image_as_base64: encode png failed: {}",
                err
            );
            return err_payload(ErrorCode::IoError, format!("编码 PNG 失败: {err}"), trace);
        }
    }

    let encoded = base64::encode(&png_bytes);
    log::info!(
        "[tauri] read_clipboard_image_as_base64: ok, bytes={} encoded_len={}",
        png_bytes.len(),
        encoded.len()
    );

    ok(encoded, trace)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DocConversationMessageMetaCfg {
    #[serde(default)]
    provider_type: Option<String>,
    #[serde(default)]
    model_name: Option<String>,
    #[serde(default)]
    has_image: Option<bool>,
    #[serde(default)]
    tokens_used: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DocConversationMessageCfg {
    id: String,
    doc_path: String,
    timestamp: i64,
    role: String,
    content: String,
    #[serde(default)]
    meta: Option<DocConversationMessageMetaCfg>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DocConversationRecordCfg {
    doc_path: String,
    session_id: String,
    last_active_at: i64,
    #[serde(default)]
    dify_conversation_id: Option<String>,
    #[serde(default)]
    dify_provider_conversations: Option<HashMap<String, String>>,
    #[serde(default)]
    messages: Vec<DocConversationMessageCfg>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ConversationIndexEntryCfg {
    doc_path: String,
    session_id: String,
    last_active_at: i64,
    has_dify_conversation: bool,
    message_count: usize,
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
async fn load_doc_conversations(app: AppHandle) -> ResultPayload<Vec<DocConversationRecordCfg>> {
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
async fn save_doc_conversations(
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

#[cfg(target_os = "macos")]
fn external_open_item_from_url(url: &Url) -> Option<ExternalOpenItem> {
    if url.scheme() != "file" {
        return None;
    }

    let path = url.to_file_path().ok()?;
    let metadata = std::fs::metadata(&path).ok()?;

    Some(ExternalOpenItem {
        path: path.to_string_lossy().to_string(),
        is_folder: metadata.is_dir(),
    })
}

fn queue_external_open_items(items: Vec<ExternalOpenItem>) {
    if items.is_empty() {
        return;
    }

    let mut pending = PENDING_EXTERNAL_OPEN_ITEMS.lock().unwrap();
    pending.extend(items);
}

#[cfg(target_os = "macos")]
fn emit_external_open_items(app: &AppHandle, items: &[ExternalOpenItem]) {
    for item in items {
        let _ = app.emit("native://open_external_file", item);
    }
}

#[tauri::command]
fn take_pending_external_open_items() -> Vec<ExternalOpenItem> {
    let mut pending = PENDING_EXTERNAL_OPEN_ITEMS.lock().unwrap();
    std::mem::take(&mut *pending)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
    // 自定义协议 haomd:// 用于访问本地 markdown 图片等用户文件
    .register_uri_scheme_protocol("haomd", move |_context: UriSchemeContext<tauri::Wry>, _request: Request<Vec<u8>>| {
      // 从 request 中获取 uri
      let uri = _request.uri();
      // uri 可能形如:
      // - haomd://localhost/Users/xxx/xxx.png (macOS/Linux)
      // - https://haomd.localhost/Users/xxx/xxx.png (Windows)
      let raw_path = uri.path();
      log::info!("[tauri] haomd protocol: raw uri={}, raw_path={}", uri, raw_path);

      // 解码 URL，处理可能的重复编码
      // 循环解码直到没有 %XX 格式的编码（%25 除外，因为它就是百分号本身）
      let mut decoded = raw_path.to_string();
      loop {
        let new_decoded = percent_decode_str(&decoded)
          .decode_utf8_lossy()
          .to_string();
        if new_decoded == decoded {
          // 没有变化，解码完成
          break;
        }
        decoded = new_decoded;
      }
      log::info!("[tauri] haomd protocol: fully decoded path={}", decoded);

      // raw_path 已经是正确的绝对路径（以 / 开头）
      let path = std::path::PathBuf::from(&decoded);
      log::info!("[tauri] haomd protocol: final path={:?}, exists={}", path, path.exists());

      // 如果文件不存在，尝试列出父目录的内容来调试
      if !path.exists() {
        if let Some(parent) = path.parent() {
          log::info!("[tauri] haomd protocol: listing parent dir {:?}", parent);
          if let Ok(entries) = std::fs::read_dir(parent) {
            for entry in entries.flatten() {
              log::info!("[tauri] haomd protocol: dir entry {:?}", entry.file_name());
            }
          }
        }
      }

      // 读取文件元数据和内容
      match std::fs::metadata(&path) {
        Ok(meta) => {
          let file_size = meta.len();

          // 解析 Range 请求头（格式: bytes=start-end 或 bytes=start-）
          let range_header = _request.headers().get("range");
          let (status, body_bytes, content_range) = if let Some(range) = range_header {
            // 有 Range 请求：返回部分内容
            let range_str = range.to_str().unwrap_or("");
            log::info!("[tauri] haomd protocol: Range header={}", range_str);

            // 解析 "bytes=0-1023" 格式
            let (start, end) = if let Some(range_spec) = range_str.strip_prefix("bytes=") {
              let parts: Vec<&str> = range_spec.split('-').collect();
              let start_opt = parts.first().and_then(|s| s.parse::<u64>().ok());
              let end_opt = parts.get(1).and_then(|s| s.parse::<u64>().ok());

              let start = start_opt.unwrap_or(0);
              let end = end_opt.unwrap_or(file_size.saturating_sub(1));

              (start, end.min(file_size.saturating_sub(1)))
            } else {
              (0, file_size.saturating_sub(1))
            };

            // 读取指定范围的文件内容
            let data = match std::fs::read(&path) {
              Ok(d) => d,
              Err(e) => {
                log::error!("[tauri] haomd protocol: failed to read file {:?}: {}", path, e);
                return Response::builder()
                  .status(404)
                  .body(Vec::new())
                  .unwrap();
              }
            };

            let start_idx = start as usize;
            let end_idx = (end + 1) as usize;
            if start_idx >= data.len() {
              log::error!("[tauri] haomd protocol: invalid range start={} file_size={}", start, file_size);
              return Response::builder()
                .status(416)  // Range Not Satisfiable
                .header("Content-Range", format!("bytes */{}", file_size))
                .body(Vec::new())
                .unwrap();
            }

            let range_bytes = data[start_idx..end_idx.min(data.len())].to_vec();
            let content_range_header = format!("bytes {}-{}/{}", start, end, file_size);

            (206, range_bytes, Some(content_range_header))
          } else {
            // 无 Range 请求：返回完整文件
            match std::fs::read(&path) {
              Ok(data) => (200, data, None),
              Err(e) => {
                log::error!("[tauri] haomd protocol: failed to read file {:?}: {}", path, e);
                return Response::builder()
                  .status(404)
                  .body(Vec::new())
                  .unwrap();
              }
            }
          };

          log::info!("[tauri] haomd protocol: status={}, size={} bytes", status, body_bytes.len());

          let mime = mime_guess::from_path(&path)
            .first_or_octet_stream()
            .to_string();

          // 构建响应，添加缓存和 Range 支持头
          let mut builder = Response::builder()
            .status(status)
            .header("Content-Type", mime.as_str())
            .header("Cache-Control", "public, max-age=3600")  // 缓存 1 小时
            .header("Accept-Ranges", "bytes");  // 声明支持 Range 请求

          if let Some(cr) = content_range {
            builder = builder.header("Content-Range", cr);
          }

          match builder.body(body_bytes) {
            Ok(response) => response,
            Err(e) => {
              log::error!("[tauri] haomd protocol: failed to build response: {}", e);
              Response::builder()
                .status(500)
                .body(Vec::new())
                .unwrap()
            }
          }
        }
        Err(e) => {
          log::error!("[tauri] haomd protocol: failed to get metadata for {:?}: {}", path, e);
          Response::builder()
            .status(404)
            .body(Vec::new())
            .unwrap()
        }
      }
    })
    .setup(|app| {
      let handle = app.handle();
      let log_plugin = tauri_plugin_log::Builder::default()
        .level(log::LevelFilter::Info)
        .build();
      handle.plugin(log_plugin)?;
      handle.plugin(tauri_plugin_dialog::init())?;
      handle.plugin(tauri_plugin_opener::init())?;

      // 构建原生菜单（参考 VS Code）
      tauri::async_runtime::block_on(async {
        let menu = build_app_menu(handle).await?;
        handle.set_menu(menu)?;
        Ok::<(), tauri::Error>(())
      })?;

      app.on_menu_event(|app, event| {
        let action = event.id().as_ref();

        if action == "help_docs" {
          let app_handle = app.clone();
          tauri::async_runtime::spawn(async move {
            open_markdown_handbook(&app_handle);
          });
          return;
        }

        // 最近文件原生子菜单：菜单项 id -> 文件路径
        if action.starts_with(RECENT_MENU_PREFIX) {
          let payload_opt = {
            let map = RECENT_MENU_MAP.lock().unwrap();
            map.get(action).cloned()
          };
          if let Some(payload) = payload_opt {
            let _ = app.emit("menu://open_recent_file", payload);
          }
          return;
        }

        // File → Open Recent: More... 打开前端最近文件模态窗
        if action == "open_recent_dialog" {
          let _ = app.emit("menu://action", "open_recent_dialog".to_string());
          return;
        }

        // 原生剪贴板粘贴：只读取一次剪贴板，同时检查文本和图片
        if action == "paste" {
          log::info!("[tauri] menu paste triggered");
          match Clipboard::new() {
            Ok(mut cb) => {
              // 先检查文本，如果有文本就走文本粘贴流程
              match cb.get_text() {
                Ok(text) if !text.is_empty() => {
                  log::info!("[tauri] paste: clipboard has text, len={}", text.len());
                  let _ = app.emit("native://paste", text);
                }
                _ => {
                  // 没有可用文本，再检查图片（只读取一次剪贴板）
                  log::info!("[tauri] paste: no text, check image");
                  match cb.get_image() {
                    Ok(img) => {
                      log::info!("[tauri] paste: clipboard image detected, size={}x{}", img.width, img.height);
                      // 发送图片粘贴信号，前端会调用 save_clipboard_image_to_dir 保存图片
                      let _ = app.emit("native://paste_image", "");
                    }
                    Err(err) => {
                      log::error!("[tauri] paste: clipboard has no usable text or image: {}", err);
                      let _ = app.emit("native://paste_error", format!("读取剪贴板失败: {err}"));
                    }
                  }
                }
              }
            }
            Err(err) => {
              log::error!("[tauri] paste: Clipboard::new() failed: {}", err);
              let _ = app.emit("native://paste_error", format!("读取剪贴板失败: {err}"));
            }
          }
          return;
        }

        // 其他菜单统一推送到前端 dispatcher
        let _ = app.emit("menu://action", action.to_string());
        // 注意：quit 事件不立即退出，等待前端处理完确认对话框后再调用 quit 命令
      });

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      read_file,
      read_binary_file,
      write_file,
      write_file_no_recent,
      list_recent,
      log_recent_file,
      clear_recent,
      delete_recent_entry,
      list_pdf_recent,
      log_pdf_recent_file,
      delete_pdf_recent_entry,
      load_pdf_folders,
      save_pdf_folders,
      update_pdf_recent_folder,
      load_file_virtual_folders,
      save_file_virtual_folders,
      list_file_virtual_assignments,
      update_file_virtual_folder_for_path,
      load_sidebar_state,
      save_sidebar_state,
      list_folder,
      create_folder,
      set_title,
      delete_fs_entry,
      rename_fs_entry,
      quit_app,
      load_ai_settings,
      save_ai_settings,
      load_prompt_settings,
      save_prompt_settings,
      load_agent_settings,
      save_agent_settings,
      editor_settings::load_editor_settings,
      editor_settings::save_editor_settings,
      font_catalog::list_system_fonts,
      open_terminal,
      open_in_file_explorer,
      open_word_templates_dir,
      list_word_templates,
      get_word_template_config,
      open_webview_browser,
      pick_editor_background_image,
      export_word_docx,
      fill_docx_template,
      get_system_language,
      is_inkscape_available,
      convert_svg_to_emf,
      convert_svg_to_plain_svg,
      save_clipboard_image_to_dir,
      read_clipboard_image_as_base64,
      load_doc_conversations,
      save_doc_conversations,
      take_pending_external_open_items,
      save_text_with_dialog,
      save_ai_sessions_json_with_dialog,
    ])
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

    for arg in std::env::args().skip(1) {
        if arg.starts_with('-') {
            continue;
        }
        let path = PathBuf::from(&arg);
        if let Ok(metadata) = std::fs::metadata(&path) {
            queue_external_open_items(vec![ExternalOpenItem {
                path: path.to_string_lossy().to_string(),
                is_folder: metadata.is_dir(),
            }]);
        }
    }

    app.run(|_app_handle, _event| {
        #[cfg(target_os = "macos")]
        if let RunEvent::Opened { urls } = _event {
            let items: Vec<ExternalOpenItem> = urls
                .iter()
                .filter_map(external_open_item_from_url)
                .collect();
            if !items.is_empty() {
                queue_external_open_items(items.clone());
                emit_external_open_items(_app_handle, &items);
            }
        }
    });
}
