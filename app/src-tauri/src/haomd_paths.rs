use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};

pub fn haomd_config_root_dir<R: Runtime>(app: &AppHandle<R>) -> std::io::Result<PathBuf> {
    if let Ok(mut dir) = app.path().config_dir() {
        dir.push("haomd");
        std::fs::create_dir_all(&dir)?;
        return Ok(dir);
    }

    let mut dir = std::env::current_dir()?;
    dir.push("haomd");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn haomd_config_file<R: Runtime>(app: &AppHandle<R>, file_name: &str) -> std::io::Result<PathBuf> {
    Ok(haomd_config_root_dir(app)?.join(file_name))
}

pub fn haomd_config_subdir<R: Runtime>(app: &AppHandle<R>, subdir: &str) -> std::io::Result<PathBuf> {
    let dir = haomd_config_root_dir(app)?.join(subdir);
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn haomd_data_root_dir<R: Runtime>(app: &AppHandle<R>) -> std::io::Result<PathBuf> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| std::io::Error::other(err.to_string()))?;
    let Some(parent) = app_data_dir.parent() else {
        return Err(std::io::Error::other("应用数据目录无父目录"));
    };
    let dir = parent.join("haomd");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}
