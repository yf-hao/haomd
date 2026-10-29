use crate::{err_payload, new_trace_id, normalize_path, ok, search_db, ErrorCode, ResultPayload};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{AppHandle, Manager};
use tokio::fs;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum FsEntryKind {
    File,
    Dir,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FsEntry {
    pub path: String,
    pub name: String,
    pub kind: FsEntryKind,
}

fn collect_entries(dir: &Path, acc: &mut Vec<FsEntry>) -> std::io::Result<()> {
    let rd = std::fs::read_dir(dir)?;
    for entry_res in rd {
        let entry = entry_res?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        // 不遍历隐藏目录，避免其后代进入文件浏览器的扁平条目列表。
        if name.starts_with('.') {
            continue;
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skips_hidden_directories_and_all_descendants() {
        let root = std::env::temp_dir().join(format!(
            "haomd-hidden-{}-{}", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(root.join("vgms/.git/hooks/deep")).unwrap();
        std::fs::create_dir_all(root.join(".haomd/notes")).unwrap();
        std::fs::write(root.join("vgms/.git/hooks/deep/note.md"), "hidden").unwrap();
        std::fs::write(root.join(".hidden.md"), "hidden").unwrap();
        std::fs::write(root.join("vgms/visible.md"), "visible").unwrap();
        let mut entries = Vec::new();
        collect_entries(&root, &mut entries).unwrap();
        let mut names: Vec<_> = entries.iter().map(|entry| entry.name.as_str()).collect();
        names.sort();
        assert_eq!(names, vec!["vgms", "visible.md"]);
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[tauri::command]
pub async fn list_folder(
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
            );
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
pub async fn delete_fs_entry(
    app: AppHandle,
    path: String,
    trace_id: Option<String>,
) -> ResultPayload<()> {
    let trace = trace_id.unwrap_or_else(new_trace_id);
    let normalized = match normalize_path(&path) {
        Ok(p) => p,
        Err(e) => return ResultPayload::Err { error: e },
    };

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
                Ok(()) => {
                    let _ = search_db::delete_search_index_entry(&app, &normalized);
                    ok((), trace)
                }
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
pub async fn rename_fs_entry(
    app: AppHandle,
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
        Ok(()) => {
            let _ = search_db::rename_search_index_entry(&app, &src, &dst);
            ok((), trace)
        }
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
pub async fn copy_fs_entry(source_path: String, target_directory: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::file_copy::copy_entry(Path::new(&source_path), Path::new(&target_directory))
            .map(|path| path.to_string_lossy().into_owned())
            .map_err(|error| format!("复制失败: {error}"))
    }).await.map_err(|error| format!("复制任务失败: {error}"))?
}

#[tauri::command]
pub async fn create_folder(
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

#[tauri::command]
pub async fn set_title(app: AppHandle, title: String) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "window not found".to_string())?;
    window
        .set_title(&title)
        .map_err(|e: tauri::Error| e.to_string())
}

#[tauri::command]
pub async fn quit_app() {
    std::process::exit(0);
}
