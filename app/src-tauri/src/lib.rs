use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

mod fs_types;

use fs_types::{ErrorCode, FilePayload, RecentFile, ResultPayload, ServiceError, WriteResult};
use log::info;
use once_cell::sync::Lazy;
use serde_json;
use sha2::{Digest, Sha256};
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager};
use tokio::fs;
use tokio::sync::Mutex;

const MAX_FILE_BYTES: u64 = 20 * 1024 * 1024; // 20MB

static FILE_LOCKS: Lazy<Mutex<HashMap<String, std::sync::Arc<Mutex<()>>>>> =
  Lazy::new(|| Mutex::new(HashMap::new()));

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

async fn read_recent_store(_app: &AppHandle) -> std::io::Result<Vec<RecentFile>> {
  let dir = std::env::current_dir()?;
  let path = dir.join("recent.json");
  match fs::read(&path).await {
    Ok(bytes) => {
      let items: Vec<RecentFile> = serde_json::from_slice(&bytes).unwrap_or_default();
      Ok(items)
    }
    Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
    Err(err) => Err(err),
  }
}

#[tauri::command]
async fn read_file(path: String, trace_id: Option<String>) -> ResultPayload<FilePayload> {
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

  ok(payload, trace)
}

#[tauri::command]
async fn write_file(
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

  ok(result, trace)
}

#[tauri::command]
async fn list_recent(app: AppHandle, trace_id: Option<String>) -> ResultPayload<Vec<RecentFile>> {
  let trace = trace_id.unwrap_or_else(new_trace_id);
  match read_recent_store(&app).await {
    Ok(list) => ok(list, trace),
    Err(err) => err_payload(ErrorCode::IoError, format!("读取最近文件失败: {err}"), trace),
  }
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      let handle = app.handle();
      let log_plugin = tauri_plugin_log::Builder::default()
        .level(log::LevelFilter::Info)
        .build();
      handle.plugin(log_plugin)?;
      handle.plugin(tauri_plugin_dialog::init())?;

      // 构建原生菜单（参考 VS Code）
      let haomd_menu = SubmenuBuilder::new(app, "HaoMD")
        .item(&MenuItemBuilder::new("About HaoMD").id("haomd_about").build(app)?)
        .item(&MenuItemBuilder::new("Quit").id("quit").accelerator("CmdOrCtrl+Q").build(app)?)
        .build()?;

      let file_menu = SubmenuBuilder::new(app, "File")
        .item(&MenuItemBuilder::new("New (⌘N)").id("new_file").accelerator("CmdOrCtrl+n").build(app)?)
        .separator()
        .item(&MenuItemBuilder::new("Open").id("open_file").accelerator("CmdOrCtrl+o").build(app)?)
        .item(&MenuItemBuilder::new("Open Folder").id("open_folder").accelerator("CmdOrCtrl+Shift+o").build(app)?)
        .item(&MenuItemBuilder::new("Open Recent").id("open_recent").accelerator("CmdOrCtrl+Alt+h").build(app)?)
        .item(&MenuItemBuilder::new("Clear Recent").id("clear_recent").build(app)?)
        .separator()
        .item(&MenuItemBuilder::new("Save").id("save").accelerator("CmdOrCtrl+s").build(app)?)
        .item(&MenuItemBuilder::new("Save As").id("save_as").accelerator("CmdOrCtrl+Shift+s").build(app)?)
        .separator()
        .item(&MenuItemBuilder::new("Close File").id("close_file").accelerator("CmdOrCtrl+w").build(app)?)
        .build()?;

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

      let ai_menu = SubmenuBuilder::new(app, "AI")
        .item(&MenuItemBuilder::new("Open AI Chat").id("ai_chat").build(app)?)
        .item(&MenuItemBuilder::new("Set API Key").id("ai_set_key").build(app)?)
        .item(&MenuItemBuilder::new("AI Settings").id("ai_settings").build(app)?)
        .item(&MenuItemBuilder::new("Ask AI About File").id("ai_ask_file").build(app)?)
        .item(&MenuItemBuilder::new("Ask AI About Selection").id("ai_ask_selection").build(app)?)
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

      app.set_menu(menu)?;

      app.on_menu_event(|app, event| {
        let action = event.id().as_ref();
        // 统一推送到前端 dispatcher
        let _ = app.emit("menu://action", action.to_string());
        if action == "quit" {
          std::process::exit(0);
        }
      });

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      read_file,
      write_file,
      list_recent,
      set_title
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
