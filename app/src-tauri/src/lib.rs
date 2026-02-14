use std::collections::HashMap;
use std::io::Cursor;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

mod fs_types;
mod editor_settings;

use fs_types::{ErrorCode, FilePayload, RecentFile, ResultPayload, ServiceError, WriteResult};
use log::info;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json;
use sha2::{Digest, Sha256};
use arboard::Clipboard;
use image::{DynamicImage, ImageBuffer, ImageFormat, Rgba};
use rand::{distributions::Alphanumeric, Rng};
use chrono::Local;
use mime_guess;
use percent_encoding::percent_decode_str;
use tauri::http::{Request, Response};
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, UriSchemeContext};
use tokio::fs;
use tokio::sync::Mutex;

const MAX_FILE_BYTES: u64 = 20 * 1024 * 1024; // 20MB
const MAX_RECENT_ITEMS: usize = 100; // 最近文件最大条数
const RECENT_PAGE_SIZE: usize = 20; // Open Recent 子菜单每页显示条数

static FILE_LOCKS: Lazy<Mutex<HashMap<String, std::sync::Arc<Mutex<()>>>>> =
  Lazy::new(|| Mutex::new(HashMap::new()));

// 最近文件原生菜单映射：菜单项 id -> 文件路径
static RECENT_MENU_MAP: Lazy<std::sync::Mutex<HashMap<String, RecentMenuPayload>>> =
  Lazy::new(|| std::sync::Mutex::new(HashMap::new()));

// 最近文件分页状态：当前页（从 0 开始）
static RECENT_PAGE: Lazy<std::sync::Mutex<u32>> =
  Lazy::new(|| std::sync::Mutex::new(0));

const RECENT_MENU_PREFIX: &str = "recent_item_";

fn new_trace_id() -> String {
  let nanos = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_nanos())
    .unwrap_or_default();
  format!("trace_{}", nanos)
}

fn service_error(code: ErrorCode, message: impl Into<String>, trace_id: Option<String>) -> ServiceError {
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

fn err_payload<T>(code: ErrorCode, message: impl Into<String>, trace_id: String) -> ResultPayload<T> {
  ResultPayload::Err {
    error: service_error(code, message, Some(trace_id)),
  }
}

fn normalize_path(input: &str) -> Result<PathBuf, ServiceError> {
  if input.trim().is_empty() {
    return Err(service_error(
      ErrorCode::InvalidPath,
      "路径不能为空",
      None,
    ));
  }

  let mut path = PathBuf::from(input);
  if path.is_relative() {
    let cwd = std::env::current_dir().map_err(|e| service_error(ErrorCode::IoError, format!("获取当前目录失败: {e}"), None))?;
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
  map
    .entry(key)
    .or_insert_with(|| std::sync::Arc::new(Mutex::new(())))
    .clone()
}

fn hash_bytes(bytes: &[u8]) -> String {
  let mut hasher = Sha256::new();
  hasher.update(bytes);
  format!("{:x}", hasher.finalize())
}

fn mtime_ms(meta: &std::fs::Metadata) -> u64 {
  meta
    .modified()
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
struct EditorSettingsCfg {
  #[serde(default)]
  ai_compression: Option<AiCompressionCfg>,
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
    extra: std::collections::HashMap::new(),
  }
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

fn editor_settings_path(app: &AppHandle) -> std::io::Result<PathBuf> {
  if let Ok(mut dir) = app.path().config_dir() {
    dir.push("haomd");
    std::fs::create_dir_all(&dir)?;
    return Ok(dir.join("editor_settings.json"));
  }

  let dir = std::env::current_dir()?;
  Ok(dir.join("editor_settings.json"))
}

async fn read_sidebar_state(app: &AppHandle) -> std::io::Result<SidebarState> {
  let path = sidebar_state_path(app)?;
  match fs::read(&path).await {
    Ok(bytes) => {
      let state: SidebarState = serde_json::from_slice(&bytes)
        .unwrap_or(SidebarState { root: None, expanded_paths: Vec::new(), standalone_files: Vec::new(), folder_roots: Vec::new(), highlighted_files: Vec::new() });
      Ok(state)
    }
    Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(SidebarState { root: None, expanded_paths: Vec::new(), standalone_files: Vec::new(), folder_roots: Vec::new(), highlighted_files: Vec::new() }),
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
async fn read_file(app: AppHandle, path: String, trace_id: Option<String>) -> ResultPayload<FilePayload> {
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
    Err(err) => return err_payload(ErrorCode::IoError, format!("读取元数据失败: {err}"), trace),
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
      payload.path,
      trace,
      err
    );
  } else {
    refresh_app_menu(&app).await;
  }

  ok(payload, trace)
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
          return err_payload(ErrorCode::CONFLICT, "hash 不匹配，可能存在外部修改", trace);
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
    Err(err) => return err_payload(ErrorCode::IoError, format!("获取写入后元数据失败: {err}"), trace),
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
      result.path,
      trace,
      err
    );
  } else {
    refresh_app_menu(&app).await;
  }

  ok(result, trace)
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
    Err(err) => return err_payload(ErrorCode::IoError, format!("读取最近文件失败: {err}"), trace),
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
    Err(err) => err_payload(ErrorCode::IoError, format!("更新最近文件失败: {err}"), trace),
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
    Err(err) => err_payload(ErrorCode::IoError, format!("清空最近文件失败: {err}"), trace),
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
    Err(err) => return err_payload(ErrorCode::IoError, format!("读取最近文件失败: {err}"), trace),
  };
  list.retain(|item| item.path != path);
  match write_recent_store(&app, &list).await {
    Ok(()) => {
      refresh_app_menu(&app).await;
      ok((), trace)
    }
    Err(err) => err_payload(ErrorCode::IoError, format!("写入最近文件失败: {err}"), trace),
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
    let name = entry
      .file_name()
      .to_string_lossy()
      .into_owned();
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
    return err_payload(
      ErrorCode::IoError,
      format!("遍历目录失败: {err}"),
      trace,
    );
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

async fn build_app_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
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

  let page_label = if total == 0 {
    "Page 0 / 0".to_string()
  } else {
    format!("Page {} / {}", current_page + 1, max_page + 1)
  };

  // HaoMD 菜单
  let haomd_menu = SubmenuBuilder::new(app, "HaoMD")
    .item(&MenuItemBuilder::new("About HaoMD").id("haomd_about").build(app)?)
    .item(&MenuItemBuilder::new("Quit").id("quit").accelerator("CmdOrCtrl+Q").build(app)?)
    .build()?;

  // Open Recent 原生子菜单
  let mut open_recent_builder = SubmenuBuilder::new(app, "Open Recent");
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
      open_recent_builder = open_recent_builder.item(
        &MenuItemBuilder::new(&label)
          .id(&id)
          .build(app)?,
      );
    }
  }

  // 分页控制：仅在总页数大于 1 时展示
  open_recent_builder = if max_page > 0 {
    open_recent_builder
      .separator()
      .item(&MenuItemBuilder::new(&page_label).id("recent_page_info").build(app)?)
      .item(&MenuItemBuilder::new("Previous Page").id("recent_prev_page").build(app)?)
      .item(&MenuItemBuilder::new("Next Page").id("recent_next_page").build(app)?)
      .separator()
  } else {
    // 只有一页（或无记录）时，不展示分页信息和按钮
    open_recent_builder
      .separator()
  };

  open_recent_builder = open_recent_builder
    .item(&MenuItemBuilder::new("Clear Recent").id("clear_recent").build(app)?);

  let open_recent_menu = open_recent_builder.build()?;

  // File 菜单
  let file_menu = SubmenuBuilder::new(app, "File")
    .item(&MenuItemBuilder::new("New").id("new_file").accelerator("CmdOrCtrl+n").build(app)?)
    .separator()
    .item(&MenuItemBuilder::new("Open").id("open_file").accelerator("CmdOrCtrl+o").build(app)?)
    .item(&MenuItemBuilder::new("Open Folder").id("open_folder").accelerator("CmdOrCtrl+Shift+o").build(app)?)
    .item(&open_recent_menu)
    .separator()
    .item(&MenuItemBuilder::new("Save").id("save").accelerator("CmdOrCtrl+s").build(app)?)
    .item(&MenuItemBuilder::new("Save As").id("save_as").accelerator("CmdOrCtrl+Shift+s").build(app)?)
    .separator()
    .item(&MenuItemBuilder::new("Close File").id("close_file").accelerator("CmdOrCtrl+w").build(app)?)
    .build()?;

  // Edit 菜单
  let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&MenuItemBuilder::new("Undo").id("undo").build(app)?)
        .item(&MenuItemBuilder::new("Redo").id("redo").build(app)?)
        .separator()
        .item(&MenuItemBuilder::new("Cut").id("cut").build(app)?)
        .item(&MenuItemBuilder::new("Copy").id("copy").accelerator("CmdOrCtrl+C").build(app)?)
        .item(&MenuItemBuilder::new("Paste").id("paste").accelerator("CmdOrCtrl+v").build(app)?)
        .separator()
        .item(&MenuItemBuilder::new("Find").id("find").build(app)?)
        .item(&MenuItemBuilder::new("Replace").id("replace").build(app)?)
        .item(&MenuItemBuilder::new("Select All").id("select_all").build(app)?)
        .item(&MenuItemBuilder::new("Toggle Comment").id("toggle_comment").build(app)?)
        .item(&MenuItemBuilder::new("Format Document").id("format_document").build(app)?)
        .build()?;

  let selection_menu = SubmenuBuilder::new(app, "Selection")
        .item(&MenuItemBuilder::new("Expand Selection").id("expand_selection").build(app)?)
        .item(&MenuItemBuilder::new("Shrink Selection").id("shrink_selection").build(app)?)
        .item(&MenuItemBuilder::new("Select Line").id("select_line").build(app)?)
        .item(&MenuItemBuilder::new("Select All Matches").id("select_all_matches").build(app)?)
        .build()?;

  let layout_menu = SubmenuBuilder::new(app, "Layout")
        .item(&MenuItemBuilder::new("Preview Left").id("layout_preview_left").build(app)?)
        .item(&MenuItemBuilder::new("Preview Right").id("layout_preview_right").build(app)?)
        .item(&MenuItemBuilder::new("Editor Only").id("layout_editor_only").build(app)?)
        .item(&MenuItemBuilder::new("Preview Only").id("layout_preview_only").build(app)?)
        .build()?;

  let dock_ai_chat_menu = SubmenuBuilder::new(app, "Dock AI Chat")
        .item(&MenuItemBuilder::new("Floating").id("view_ai_chat_floating").accelerator("CmdOrCtrl+Shift+F").build(app)?)
        .item(&MenuItemBuilder::new("Dock Left").id("view_ai_chat_dock_left").accelerator("CmdOrCtrl+Shift+L").build(app)?)
        .item(&MenuItemBuilder::new("Dock Right").id("view_ai_chat_dock_right").accelerator("CmdOrCtrl+Shift+R").build(app)?)
        .build()?;

  let view_menu = SubmenuBuilder::new(app, "View")
        .item(&MenuItemBuilder::new("Toggle Preview (⌘P)").id("toggle_preview").accelerator("CmdOrCtrl+P").build(app)?)
        .item(&MenuItemBuilder::new("Split View").id("split_view").build(app)?)
        .item(&MenuItemBuilder::new("Toggle Sidebar").id("toggle_sidebar").build(app)?)
        .item(&MenuItemBuilder::new("Toggle Status Bar").id("toggle_status_bar").build(app)?)
        .item(&MenuItemBuilder::new("Zoom In").id("zoom_in").accelerator("CmdOrCtrl+=").build(app)?)
        .item(&MenuItemBuilder::new("Zoom Out").id("zoom_out").accelerator("CmdOrCtrl+-").build(app)?)
        .item(&MenuItemBuilder::new("Reset Zoom").id("zoom_reset").accelerator("CmdOrCtrl+0").build(app)?)
        .item(&MenuItemBuilder::new("Word Wrap").id("word_wrap").build(app)?)
        .item(&MenuItemBuilder::new("Developer Tools").id("devtools").accelerator("CmdOrCtrl+Shift+I").build(app)?)
        .item(&dock_ai_chat_menu)
        .item(&layout_menu)
        .build()?;

  let go_menu = SubmenuBuilder::new(app, "Go")
        .item(&MenuItemBuilder::new("Go to Line").id("go_line").accelerator("CmdOrCtrl+L").build(app)?)
        .item(&MenuItemBuilder::new("Go to Symbol").id("go_symbol").build(app)?)
        .item(&MenuItemBuilder::new("Next Tab").id("next_tab").accelerator("Ctrl+Tab").build(app)?)
        .item(&MenuItemBuilder::new("Previous Tab").id("prev_tab").accelerator("Ctrl+Shift+Tab").build(app)?)
        .item(&MenuItemBuilder::new("Back").id("go_back").build(app)?)
        .item(&MenuItemBuilder::new("Forward").id("go_forward").build(app)?)
        .build()?;

  let ai_conversation_menu = SubmenuBuilder::new(app, "Session")
        .item(&MenuItemBuilder::new("History").id("ai_conversation_history").build(app)?)
        .item(&MenuItemBuilder::new("Compress").id("ai_conversation_compress").build(app)?)
        .item(&MenuItemBuilder::new("Clear").id("ai_conversation_clear").build(app)?)
        .build()?;

  let ai_menu = SubmenuBuilder::new(app, "AI")
        .item(&MenuItemBuilder::new("Provider Settings").id("ai_settings").accelerator("CmdOrCtrl+,").build(app)?)
        .item(&MenuItemBuilder::new("Prompt Settings").id("ai_prompt_settings").build(app)?)
        .item(&MenuItemBuilder::new("Open AI Chat").id("ai_chat").accelerator("CmdOrCtrl+Shift+C").build(app)?)
        .item(&MenuItemBuilder::new("Ask AI About File").id("ai_ask_file").accelerator("CmdOrCtrl+Shift+A").build(app)?)
        .item(&MenuItemBuilder::new("Ask AI About Selection").id("ai_ask_selection").accelerator("CmdOrCtrl+Shift+S").build(app)?)
        .item(&ai_conversation_menu)
        .build()?;

  let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&MenuItemBuilder::new("Docs").id("help_docs").build(app)?)
        .item(&MenuItemBuilder::new("Release Notes").id("help_release").build(app)?)
        .item(&MenuItemBuilder::new("Report Issue").id("help_issue").build(app)?)
        .item(&MenuItemBuilder::new("About").id("help_about").build(app)?)
        .build()?;

  let menu = MenuBuilder::new(app)
    .item(&haomd_menu)
    .item(&file_menu)
    .item(&edit_menu)
    .item(&selection_menu)
    .item(&view_menu)
    .item(&go_menu)
    .item(&ai_menu)
    .item(&help_menu)
    .build()?;

  Ok(menu)
}

async fn refresh_app_menu(app: &AppHandle) {
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
      let cfg: AiSettingsCfg = serde_json::from_str(DEFAULT_AI_SETTINGS_JSON).unwrap_or(AiSettingsCfg {
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
      let cfg: PromptSettingsCfg = serde_json::from_slice(&bytes).unwrap_or(PromptSettingsCfg {
        roles: Vec::new(),
        default_role_id: None,
      });
      ok(cfg, trace)
    }
    Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
      ok(
        PromptSettingsCfg {
          roles: Vec::new(),
          default_role_id: None,
        },
        trace,
      )
    }
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
async fn open_in_file_explorer(target_path: String) -> Result<(), String> {
  use std::path::Path;

  if target_path.trim().is_empty() {
    return Err("target_path is empty".to_string());
  }

  let path = Path::new(&target_path);
  if !path.exists() {
    return Err(format!("路径不存在: {}", target_path));
  }

  #[cfg(target_os = "macos")]
  {
    Command::new("open")
      .arg(&target_path)
      .spawn()
      .map_err(|e| format!("无法打开 Finder: {e}"))?;
  }

  #[cfg(target_os = "windows")]
  {
    Command::new("explorer")
      .arg(&target_path)
      .spawn()
      .map_err(|e| format!("无法打开文件管理器: {e}"))?;
  }

  #[cfg(target_os = "linux")]
  {
    Command::new("xdg-open")
      .arg(&target_path)
      .spawn()
      .map_err(|e| format!("无法打开文件管理器: {e}"))?;
  }

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
  log::info!("[tauri] save_clipboard_image_to_dir: target_dir={}, suggested_name={:?}", target_dir, suggested_name);

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
      return err_payload(
        ErrorCode::IoError,
        format!("访问剪贴板失败: {err}"),
        trace,
      );
    }
  };

  let img = match cb.get_image() {
    Ok(img) => {
      log::info!("[tauri] save_clipboard_image_to_dir: got image {}x{}", img.width, img.height);
      img
    }
    Err(err) => {
      log::error!("[tauri] save_clipboard_image_to_dir: get_image failed: {}", err);
      return err_payload(
        ErrorCode::UNSUPPORTED,
        format!("剪贴板中没有图片或格式不支持: {err}"),
        trace,
      );
    }
  };

  let width = img.width as u32;
  let height = img.height as u32;

  let buffer: ImageBuffer<Rgba<u8>, _> = match ImageBuffer::from_raw(width, height, img.bytes.into_owned()) {
    Some(buf) => buf,
    None => {
      return err_payload(
        ErrorCode::UNSUPPORTED,
        "图片数据无效",
        trace,
      );
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
  log::info!("[tauri] save_clipboard_image_to_dir: saving to {:?}", full_path);
  if let Err(err) = buffer.save(&full_path) {
    log::error!("[tauri] save_clipboard_image_to_dir: save failed: {}", err);
    return err_payload(
      ErrorCode::IoError,
      format!("写入图片失败: {err}"),
      trace,
    );
  }

  log::info!("[tauri] save_clipboard_image_to_dir: ok, file_name={}", file_name);
  ok(ClipboardImageResult { file_name }, trace)
}

#[tauri::command]
async fn read_clipboard_image_as_base64() -> ResultPayload<String> {
  let trace = new_trace_id();
  log::info!("[tauri] read_clipboard_image_as_base64: start");

  let mut cb = match Clipboard::new() {
    Ok(c) => c,
    Err(err) => {
      return err_payload(
        ErrorCode::IoError,
        format!("访问剪贴板失败: {err}"),
        trace,
      );
    }
  };

  let img = match cb.get_image() {
    Ok(img) => {
      log::info!("[tauri] read_clipboard_image_as_base64: got image {}x{}", img.width, img.height);
      img
    }
    Err(err) => {
      log::error!("[tauri] read_clipboard_image_as_base64: get_image failed: {}", err);
      return err_payload(
        ErrorCode::UNSUPPORTED,
        format!("剪贴板中没有图片或格式不支持: {err}"),
        trace,
      );
    }
  };

  let width = img.width as u32;
  let height = img.height as u32;

  let buffer: ImageBuffer<Rgba<u8>, _> = match ImageBuffer::from_raw(width, height, img.bytes.into_owned()) {
    Some(buf) => buf,
    None => {
      return err_payload(
        ErrorCode::UNSUPPORTED,
        "图片数据无效",
        trace,
      );
    }
  };

  let dyn_img = DynamicImage::ImageRgba8(buffer);
  let mut png_bytes: Vec<u8> = Vec::new();
  {
    let mut cursor = Cursor::new(&mut png_bytes);
    if let Err(err) = dyn_img.write_to(&mut cursor, ImageFormat::Png) {
      log::error!("[tauri] read_clipboard_image_as_base64: encode png failed: {}", err);
      return err_payload(
        ErrorCode::IoError,
        format!("编码 PNG 失败: {err}"),
        trace,
      );
    }
  }

  let encoded = base64::encode(&png_bytes);
  log::info!("[tauri] read_clipboard_image_as_base64: ok, bytes={} encoded_len={}", png_bytes.len(), encoded.len());

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
      let records: Vec<DocConversationRecordCfg> = serde_json::from_slice(&bytes).unwrap_or_default();
      Ok(records)
    }
    Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
    Err(err) => Err(err),
  }
}

async fn write_doc_conversations(app: &AppHandle, records: &[DocConversationRecordCfg]) -> std::io::Result<()> {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
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

      // 读取文件内容
      match std::fs::read(&path) {
        Ok(data) => {
          log::info!("[tauri] haomd protocol: successfully read file, size={} bytes", data.len());
          let mime = mime_guess::from_path(&path)
            .first_or_octet_stream()
            .to_string();

          match Response::builder()
            .status(200)
            .header("Content-Type", mime.as_str())
            .body(data)
          {
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
          log::error!("[tauri] haomd protocol: failed to read file {:?}: {}", path, e);
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

      // 构建原生菜单（参考 VS Code）
      tauri::async_runtime::block_on(async {
        let menu = build_app_menu(&handle).await?;
        handle.set_menu(menu)?;
        Ok::<(), tauri::Error>(())
      })?;

      app.on_menu_event(|app, event| {
        let action = event.id().as_ref();

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

        // 最近文件分页控制：上一页 / 下一页
        if action == "recent_prev_page" || action == "recent_next_page" {
          let app_handle = app.clone();
          let action_id = action.to_string();
          tauri::async_runtime::spawn(async move {
            if let Ok(list) = read_recent_store(&app_handle).await {
              let total = list.len();
              let page_size = RECENT_PAGE_SIZE as u32;
              let max_page = if total == 0 {
                0
              } else {
                ((total.saturating_sub(1)) as u32) / page_size
              };

              {
                let mut page = RECENT_PAGE.lock().unwrap();
                if action_id == "recent_prev_page" {
                  if *page > 0 {
                    *page -= 1;
                  }
                } else if action_id == "recent_next_page" {
                  if *page < max_page {
                    *page += 1;
                  }
                }
              }

              refresh_app_menu(&app_handle).await;
            }
          });
          return;
        }

        // 分页信息项：点击时忽略
        if action == "recent_page_info" {
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
      write_file,
      list_recent,
      log_recent_file,
      clear_recent,
      delete_recent_entry,
      load_sidebar_state,
      save_sidebar_state,
      list_folder,
      set_title,
      delete_fs_entry,
      quit_app,
      load_ai_settings,
      save_ai_settings,
      load_prompt_settings,
      save_prompt_settings,
      editor_settings::load_editor_settings,
      open_terminal,
      open_in_file_explorer,
      save_clipboard_image_to_dir,
      read_clipboard_image_as_base64,
      load_doc_conversations,
      save_doc_conversations,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
