use crate::{
    err_payload, new_trace_id, ok, refresh_app_menu, search_db, service_error, update_recent,
    ErrorCode, FilePayload, ResultPayload, ServiceError, WriteResult,
};
use log::info;
use once_cell::sync::Lazy;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use tokio::fs;
use tokio::sync::Mutex;

use tauri::AppHandle;

pub(crate) const MAX_FILE_BYTES: u64 = 500 * 1024 * 1024; // 500MB
pub(crate) static FILE_LOCKS: Lazy<Mutex<HashMap<String, std::sync::Arc<Mutex<()>>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub(crate) fn normalize_path(input: &str) -> Result<PathBuf, ServiceError> {
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

pub(crate) fn hash_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn mtime_ms(meta: &std::fs::Metadata) -> u64 {
    use std::time::UNIX_EPOCH;

    meta.modified()
        .ok()
        .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
pub async fn read_file(
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
            return err_payload(ErrorCode::NotFound, "文件不存在", trace);
        }
        Err(err) => {
            return err_payload(ErrorCode::IoError, format!("读取元数据失败: {err}"), trace);
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
pub async fn read_binary_file(
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
            return err_payload(ErrorCode::IoError, format!("读取元数据失败: {err}"), trace);
        }
    };

    if meta.len() > MAX_FILE_BYTES {
        return err_payload(ErrorCode::TooLarge, "文件过大，已超过上限", trace);
    }

    let bytes = match fs::read(&normalized).await {
        Ok(b) => b,
        Err(err) => return err_payload(ErrorCode::IoError, format!("读取文件失败: {err}"), trace),
    };

    ok(bytes, trace)
}

async fn write_file_impl(
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
            );
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

    ok(result, trace)
}

#[tauri::command]
pub async fn write_file(
    app: AppHandle,
    path: String,
    content: String,
    expected_mtime: Option<u64>,
    expected_hash: Option<String>,
    trace_id: Option<String>,
) -> ResultPayload<WriteResult> {
    let result = write_file_impl(path, content, expected_mtime, expected_hash, trace_id).await;

    if let ResultPayload::Ok { data, trace_id } = &result {
        info!(
            "action=write_file outcome=ok path={} trace_id={} size_check=done",
            data.path,
            trace_id.clone().unwrap_or_default()
        );
        if let Ok(normalized) = normalize_path(&data.path) {
            let _ = search_db::upsert_search_index_entry(&app, &normalized);
        }
        if let Err(err) = update_recent(&app, &data.path, false).await {
            info!(
                "action=log_recent_from_write outcome=err path={} trace_id={} error={}",
                data.path,
                trace_id.clone().unwrap_or_default(),
                err
            );
        } else {
            refresh_app_menu(&app).await;
        }
    }

    result
}

#[tauri::command]
pub async fn write_file_no_recent(
    app: AppHandle,
    path: String,
    content: String,
    expected_mtime: Option<u64>,
    expected_hash: Option<String>,
    trace_id: Option<String>,
) -> ResultPayload<WriteResult> {
    let result = write_file_impl(path, content, expected_mtime, expected_hash, trace_id).await;

    if let ResultPayload::Ok { data, trace_id } = &result {
        info!(
            "action=write_file_no_recent outcome=ok path={} trace_id={} size_check=done",
            data.path,
            trace_id.clone().unwrap_or_default()
        );
        if let Ok(normalized) = normalize_path(&data.path) {
            let _ = search_db::upsert_search_index_entry(&app, &normalized);
        }
    }

    result
}
