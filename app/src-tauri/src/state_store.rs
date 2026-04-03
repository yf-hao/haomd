use crate::fs_types::RecentFile;
use crate::{err_payload, new_trace_id, ok, refresh_app_menu, ErrorCode, ResultPayload};
use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tokio::fs;

fn recent_store_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    if let Ok(mut dir) = app.path().config_dir() {
        dir.push("haomd");
        std::fs::create_dir_all(&dir)?;
        return Ok(dir.join("recent.json"));
    }

    let dir = std::env::current_dir()?;
    Ok(dir.join("recent.json"))
}

fn pdf_recent_store_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    if let Ok(mut dir) = app.path().config_dir() {
        dir.push("haomd");
        std::fs::create_dir_all(&dir)?;
        return Ok(dir.join("pdf_recent.json"));
    }

    let dir = std::env::current_dir()?;
    Ok(dir.join("pdf_recent.json"))
}

fn pdf_folders_store_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    if let Ok(mut dir) = app.path().config_dir() {
        dir.push("haomd");
        std::fs::create_dir_all(&dir)?;
        return Ok(dir.join("pdf_folders.json"));
    }

    let dir = std::env::current_dir()?;
    Ok(dir.join("pdf_folders.json"))
}

fn file_virtual_folders_store_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    if let Ok(mut dir) = app.path().config_dir() {
        dir.push("haomd");
        std::fs::create_dir_all(&dir)?;
        return Ok(dir.join("file_virtual_folders.json"));
    }

    let dir = std::env::current_dir()?;
    Ok(dir.join("file_virtual_folders.json"))
}

fn file_virtual_assignments_store_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    if let Ok(mut dir) = app.path().config_dir() {
        dir.push("haomd");
        std::fs::create_dir_all(&dir)?;
        return Ok(dir.join("file_virtual_assignments.json"));
    }

    let dir = std::env::current_dir()?;
    Ok(dir.join("file_virtual_assignments.json"))
}

fn sidebar_state_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    if let Ok(mut dir) = app.path().config_dir() {
        dir.push("haomd");
        std::fs::create_dir_all(&dir)?;
        return Ok(dir.join("sidebar_state.json"));
    }

    let dir = std::env::current_dir()?;
    Ok(dir.join("sidebar_state.json"))
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct SidebarState {
    pub(crate) root: Option<String>,
    pub(crate) expanded_paths: Vec<String>,
    #[serde(default)]
    pub(crate) standalone_files: Vec<String>,
    #[serde(default)]
    pub(crate) folder_roots: Vec<String>,
    #[serde(default)]
    pub(crate) highlighted_files: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct PdfRecentEntry {
    pub(crate) path: String,
    pub(crate) display_name: String,
    pub(crate) last_opened_at: u64,
    #[serde(default)]
    pub(crate) folder_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct PdfFolder {
    pub(crate) id: String,
    pub(crate) name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct FileVirtualFolder {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) order: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct FileVirtualAssignment {
    pub(crate) path: String,
    pub(crate) folder_id: Option<String>,
    pub(crate) updated_at: u64,
}

pub(crate) async fn read_sidebar_state(app: &AppHandle) -> std::io::Result<SidebarState> {
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

pub(crate) async fn write_sidebar_state(
    app: &AppHandle,
    state: &SidebarState,
) -> std::io::Result<()> {
    let path = sidebar_state_path(app)?;
    let bytes = serde_json::to_vec_pretty(state)?;
    fs::write(path, bytes).await
}

pub(crate) async fn read_recent_store(app: &AppHandle) -> std::io::Result<Vec<RecentFile>> {
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

pub(crate) async fn write_recent_store(
    app: &AppHandle,
    items: &[RecentFile],
) -> std::io::Result<()> {
    let path = recent_store_path(app)?;
    let bytes = serde_json::to_vec_pretty(items)?;
    fs::write(path, bytes).await
}

pub(crate) async fn read_pdf_recent_store(app: &AppHandle) -> std::io::Result<Vec<PdfRecentEntry>> {
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

pub(crate) async fn write_pdf_recent_store(
    app: &AppHandle,
    items: &[PdfRecentEntry],
) -> std::io::Result<()> {
    let path = pdf_recent_store_path(app)?;
    let bytes = serde_json::to_vec_pretty(items)?;
    fs::write(path, bytes).await
}

pub(crate) async fn read_pdf_folders_store(app: &AppHandle) -> std::io::Result<Vec<PdfFolder>> {
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

pub(crate) async fn write_pdf_folders_store(
    app: &AppHandle,
    items: &[PdfFolder],
) -> std::io::Result<()> {
    let path = pdf_folders_store_path(app)?;
    let bytes = serde_json::to_vec_pretty(items)?;
    fs::write(path, bytes).await
}

pub(crate) async fn read_file_virtual_folders_store(
    app: &AppHandle,
) -> std::io::Result<Vec<FileVirtualFolder>> {
    let path = file_virtual_folders_store_path(app)?;
    match fs::read(&path).await {
        Ok(bytes) => {
            let items: Vec<FileVirtualFolder> = serde_json::from_slice(&bytes).unwrap_or_default();
            info!(
                "[tauri][FilesVirtual] read_file_virtual_folders_store: path={:?}, count={}",
                &path,
                items.len()
            );
            Ok(items)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            info!(
                "[tauri][FilesVirtual] read_file_virtual_folders_store: path={:?} not found, return empty",
                &path
            );
            Ok(vec![])
        }
        Err(err) => Err(err),
    }
}

pub(crate) async fn write_file_virtual_folders_store(
    app: &AppHandle,
    items: &[FileVirtualFolder],
) -> std::io::Result<()> {
    let path = file_virtual_folders_store_path(app)?;
    info!(
        "[tauri][FilesVirtual] write_file_virtual_folders_store: path={:?}, count={}",
        &path,
        items.len()
    );
    let bytes = serde_json::to_vec_pretty(items)?;
    fs::write(path, bytes).await
}

pub(crate) async fn read_file_virtual_assignments_store(
    app: &AppHandle,
) -> std::io::Result<Vec<FileVirtualAssignment>> {
    let path = file_virtual_assignments_store_path(app)?;
    match fs::read(&path).await {
        Ok(bytes) => {
            let items: Vec<FileVirtualAssignment> =
                serde_json::from_slice(&bytes).unwrap_or_default();
            info!(
                "[tauri][FilesVirtual] read_file_virtual_assignments_store: path={:?}, count={}",
                &path,
                items.len()
            );
            Ok(items)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            info!(
                "[tauri][FilesVirtual] read_file_virtual_assignments_store: path={:?} not found, return empty",
                &path
            );
            Ok(vec![])
        }
        Err(err) => Err(err),
    }
}

pub(crate) async fn write_file_virtual_assignments_store(
    app: &AppHandle,
    items: &[FileVirtualAssignment],
) -> std::io::Result<()> {
    let path = file_virtual_assignments_store_path(app)?;
    info!(
        "[tauri][FilesVirtual] write_file_virtual_assignments_store: path={:?}, count={}",
        &path,
        items.len()
    );
    let bytes = serde_json::to_vec_pretty(items)?;
    fs::write(path, bytes).await
}

pub(crate) async fn upsert_pdf_recent(app: &AppHandle, path: &str) -> std::io::Result<()> {
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
    } else {
        list.push(PdfRecentEntry {
            path: path.to_string(),
            display_name,
            last_opened_at: now_ms,
            folder_id: None,
        });
    }

    list.sort_by(|a, b| b.last_opened_at.cmp(&a.last_opened_at));
    if list.len() > crate::MAX_RECENT_ITEMS {
        list.truncate(crate::MAX_RECENT_ITEMS);
    }

    write_pdf_recent_store(app, &list).await
}

pub(crate) async fn delete_pdf_recent(app: &AppHandle, path: &str) -> std::io::Result<()> {
    let mut list = read_pdf_recent_store(app).await?;
    list.retain(|item| item.path != path);
    write_pdf_recent_store(app, &list).await
}

pub(crate) async fn update_recent(
    app: &AppHandle,
    path: &str,
    is_folder: bool,
) -> std::io::Result<()> {
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

    list.sort_by(|a, b| b.last_opened_at.cmp(&a.last_opened_at));
    if list.len() > crate::MAX_RECENT_ITEMS {
        list.truncate(crate::MAX_RECENT_ITEMS);
    }

    write_recent_store(app, &list).await
}

#[tauri::command]
pub async fn list_recent(
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

    list.sort_by(|a, b| b.last_opened_at.cmp(&a.last_opened_at));

    let offset = offset.unwrap_or(0) as usize;
    let limit = limit.unwrap_or(10) as usize;

    if offset >= list.len() {
        return ok(Vec::new(), trace);
    }

    let end = std::cmp::min(offset + limit, list.len());
    ok(list[offset..end].to_vec(), trace)
}

#[tauri::command]
pub async fn log_recent_file(
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
pub async fn clear_recent(app: AppHandle, trace_id: Option<String>) -> ResultPayload<()> {
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
pub async fn delete_recent_entry(
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
pub async fn list_pdf_recent(
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
pub async fn log_pdf_recent_file(
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
pub async fn delete_pdf_recent_entry(
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
pub async fn load_pdf_folders(
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
pub async fn save_pdf_folders(
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
pub async fn update_pdf_recent_folder(
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
pub async fn load_file_virtual_folders(
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
pub async fn save_file_virtual_folders(
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
pub async fn list_file_virtual_assignments(
    app: AppHandle,
    trace_id: Option<String>,
) -> ResultPayload<Vec<FileVirtualAssignment>> {
    let trace = trace_id.unwrap_or_else(new_trace_id);
    match read_file_virtual_assignments_store(&app).await {
        Ok(mut list) => {
            let original_len = list.len();
            list.retain(|item| item.folder_id.is_some());
            let removed = original_len.saturating_sub(list.len());
            if removed > 0 {
                info!(
                    "[tauri][FilesVirtual] list_file_virtual_assignments: gc removed {} legacy items, remaining={}",
                    removed,
                    list.len()
                );
                if let Err(err) = write_file_virtual_assignments_store(&app, &list).await {
                    warn!(
                        "[tauri][FilesVirtual] list_file_virtual_assignments: gc write failed: {}",
                        err
                    );
                }
            } else {
                info!(
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
pub async fn update_file_virtual_folder_for_path(
    app: AppHandle,
    path: String,
    folder_id: Option<String>,
    trace_id: Option<String>,
) -> ResultPayload<FileVirtualAssignment> {
    let trace = trace_id.unwrap_or_else(new_trace_id);
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

    let result_entry;
    if folder_id.is_none() {
        let original_len = list.len();
        list.retain(|item| item.path != path);
        info!(
            "[tauri][FilesVirtual] update_file_virtual_folder_for_path(delete): path={:?}, removed={}, total_assignments={}",
            &path,
            original_len.saturating_sub(list.len()),
            list.len()
        );

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

        if let Some(item) = list.iter_mut().find(|item| item.path == path) {
            *item = new_entry.clone();
        } else {
            list.push(new_entry.clone());
        }

        info!(
            "[tauri][FilesVirtual] update_file_virtual_folder_for_path: path={:?}, folder_id={:?}, total_assignments={}",
            &path,
            &folder_id,
            list.len()
        );

        result_entry = new_entry;
    }

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
pub async fn load_sidebar_state(
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
pub async fn save_sidebar_state(
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
