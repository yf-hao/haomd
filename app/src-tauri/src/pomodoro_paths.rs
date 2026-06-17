use crate::haomd_paths::haomd_data_root_dir;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tokio::fs;

pub fn pomodoro_root_dir(app: &AppHandle) -> std::io::Result<PathBuf> {
    haomd_data_root_dir(app)
}

pub fn legacy_pomodoro_root_dir(app: &AppHandle) -> std::io::Result<PathBuf> {
    app.path()
        .app_data_dir()
        .map_err(|err| std::io::Error::other(err.to_string()))
}

pub async fn ensure_pomodoro_root_dir(app: &AppHandle) -> std::io::Result<PathBuf> {
    let root = pomodoro_root_dir(app)?;
    fs::create_dir_all(&root).await?;
    migrate_legacy_pomodoro_root(app, &root).await?;
    Ok(root)
}

async fn migrate_legacy_pomodoro_root(
    app: &AppHandle,
    target_root: &PathBuf,
) -> std::io::Result<()> {
    let legacy_root = legacy_pomodoro_root_dir(app)?;
    if legacy_root == *target_root {
        return Ok(());
    }
    if fs::metadata(target_root).await.is_ok() {
        return Ok(());
    }
    let Ok(metadata) = fs::metadata(&legacy_root).await else {
        return Ok(());
    };
    if !metadata.is_dir() {
        return Ok(());
    }

    copy_dir_recursive(&legacy_root, target_root).await
}

async fn copy_dir_recursive(source: &PathBuf, target: &PathBuf) -> std::io::Result<()> {
    fs::create_dir_all(target).await?;
    let mut stack = vec![source.clone()];
    while let Some(current) = stack.pop() {
        let relative = current
            .strip_prefix(source)
            .unwrap_or(&current)
            .to_path_buf();
        let current_target = target.join(relative);
        fs::create_dir_all(&current_target).await?;
        let mut entries = fs::read_dir(&current).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            let file_type = entry.file_type().await?;
            if file_type.is_dir() {
                stack.push(path);
                continue;
            }
            let relative_file = path.strip_prefix(source).unwrap_or(&path).to_path_buf();
            let target_file = target.join(relative_file);
            if let Some(parent) = target_file.parent() {
                fs::create_dir_all(parent).await?;
            }
            fs::copy(&path, &target_file).await?;
        }
    }
    Ok(())
}
