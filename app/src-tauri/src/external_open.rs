use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::AppHandle;

#[cfg(target_os = "macos")]
use tauri::Emitter;

#[cfg(target_os = "macos")]
use tauri::RunEvent;

#[cfg(target_os = "macos")]
use url::Url;

static PENDING_EXTERNAL_OPEN_ITEMS: Lazy<std::sync::Mutex<Vec<ExternalOpenItem>>> =
    Lazy::new(|| std::sync::Mutex::new(Vec::new()));

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExternalOpenItem {
    pub path: String,
    pub is_folder: bool,
}

#[cfg(target_os = "macos")]
pub fn external_open_item_from_url(url: &Url) -> Option<ExternalOpenItem> {
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

pub fn queue_external_open_items(items: Vec<ExternalOpenItem>) {
    if items.is_empty() {
        return;
    }

    let mut pending = PENDING_EXTERNAL_OPEN_ITEMS.lock().unwrap();
    pending.extend(items);
}

pub fn queue_external_open_items_from_cli_args() {
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
}

#[cfg(target_os = "macos")]
pub fn emit_external_open_items(app: &AppHandle, items: &[ExternalOpenItem]) {
    for item in items {
        let _ = app.emit("native://open_external_file", item);
    }
}

#[tauri::command]
pub fn take_pending_external_open_items() -> Vec<ExternalOpenItem> {
    let mut pending = PENDING_EXTERNAL_OPEN_ITEMS.lock().unwrap();
    std::mem::take(&mut *pending)
}

#[cfg(target_os = "macos")]
pub fn handle_app_run_event(app_handle: &AppHandle, event: &tauri::RunEvent) {
    if let RunEvent::Opened { urls } = event {
        let items: Vec<ExternalOpenItem> = urls
            .iter()
            .filter_map(external_open_item_from_url)
            .collect();
        if !items.is_empty() {
            queue_external_open_items(items.clone());
            emit_external_open_items(app_handle, &items);
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn handle_app_run_event(_app_handle: &AppHandle, _event: &tauri::RunEvent) {}
