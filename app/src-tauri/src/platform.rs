use super::*;
use std::process::Command;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WordTemplateEntry {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) dir: String,
    pub(crate) docx_path: String,
    pub(crate) json_path: String,
}

pub(crate) fn open_path_in_file_explorer(target_path: &str) -> Result<(), String> {
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
pub(crate) async fn open_in_file_explorer(target_path: String) -> Result<(), String> {
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

pub(crate) fn resolve_word_templates_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {e}"))?;
    let templates_dir = app_data_dir.join("word_templates");
    std::fs::create_dir_all(&templates_dir)
        .map_err(|e| format!("无法创建 word_templates 目录: {e}"))?;
    Ok(templates_dir)
}

#[tauri::command]
pub(crate) async fn open_word_templates_dir(app: AppHandle) -> Result<String, String> {
    let templates_dir = resolve_word_templates_dir(&app)?;
    let target = templates_dir.to_string_lossy().into_owned();
    open_path_in_file_explorer(&target)?;
    Ok(target)
}

#[tauri::command]
pub(crate) async fn list_word_templates(app: AppHandle) -> Result<Vec<WordTemplateEntry>, String> {
    let templates_dir = resolve_word_templates_dir(&app)?;

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
pub(crate) async fn get_word_template_config(
    app: AppHandle,
    template_id: String,
) -> Result<String, String> {
    let (_, json_path) = resolve_word_template_paths(&app, &template_id)?;
    std::fs::read_to_string(&json_path).map_err(|e| format!("读取模板配置失败: {e}"))
}

pub(crate) fn open_markdown_handbook(app: &AppHandle) {
    let resource_dir = match app.path().resource_dir() {
        Ok(dir) => dir,
        Err(err) => {
            log::error!("[Help] failed to get resource_dir: {}", err);
            return;
        }
    };

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
pub(crate) async fn open_webview_browser(app: AppHandle, url: String) -> Result<(), String> {
    if url.trim().is_empty() {
        return Err("url is empty".to_string());
    }

    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("无法打开浏览器: {e}"))?;

    Ok(())
}

#[tauri::command]
pub(crate) async fn open_terminal(cwd: String) -> Result<(), String> {
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
