use crate::haomd_paths::haomd_config_subdir;
use super::*;
use std::process::Command;

pub(crate) const WORD_TEMPLATE_JSON_FILE: &str = "template.json";
pub(crate) const WORD_TEMPLATE_MARKDOWN_FILE: &str = "usage.md";
pub(crate) const WORD_TEMPLATE_DOCX_FILE: &str = "template.docx";
pub(crate) const WORD_TEMPLATE_AUTHORING_FILE: &str = "authoring.json";

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WordTemplateAuthoringMetadata {
    #[serde(default)]
    pub template_request: String,
    #[serde(default)]
    pub sample_markdown: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WordTemplateEntry {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) dir: String,
    pub(crate) docx_path: String,
    pub(crate) json_path: String,
    pub(crate) markdown_path: String,
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
    haomd_config_subdir(app, "word_templates")
        .map_err(|e| format!("无法创建 word_templates 目录: {e}"))
}

pub(crate) fn resolve_word_template_dir(
    app: &AppHandle,
    template_id: &str,
) -> Result<PathBuf, String> {
    let normalized_id = template_id.trim();
    if normalized_id.is_empty() {
        return Err("template_id is empty".to_string());
    }
    Ok(resolve_word_templates_dir(app)?.join(normalized_id))
}

pub(crate) fn build_word_template_asset_paths(
    template_dir: &std::path::Path,
) -> (PathBuf, PathBuf, PathBuf) {
    (
        template_dir.join(WORD_TEMPLATE_JSON_FILE),
        template_dir.join(WORD_TEMPLATE_MARKDOWN_FILE),
        template_dir.join(WORD_TEMPLATE_DOCX_FILE),
    )
}

pub(crate) fn build_word_template_authoring_path(template_dir: &std::path::Path) -> PathBuf {
    template_dir.join(WORD_TEMPLATE_AUTHORING_FILE)
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
        let template_dir = entry.path();
        if !template_dir.is_dir() {
            continue;
        }
        let id = template_dir
            .file_name()
            .and_then(|s| s.to_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "unknown-template".to_string());
        let (json_path, markdown_path, docx_path) = build_word_template_asset_paths(&template_dir);
        if !docx_path.is_file() && !json_path.is_file() {
            continue;
        }

        let name = if json_path.is_file() {
            std::fs::read_to_string(&json_path)
                .ok()
                .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
                .and_then(|value| {
                    value
                        .get("name")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                })
                .unwrap_or_else(|| id.clone())
        } else {
            id.clone()
        };

        items.push(WordTemplateEntry {
            id,
            name,
            dir: template_dir.to_string_lossy().into_owned(),
            docx_path: if docx_path.exists() {
                docx_path.to_string_lossy().into_owned()
            } else {
                String::new()
            },
            json_path: if json_path.exists() {
                json_path.to_string_lossy().into_owned()
            } else {
                String::new()
            },
            markdown_path: if markdown_path.exists() {
                markdown_path.to_string_lossy().into_owned()
            } else {
                String::new()
            },
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
    let (json_path, _, _) =
        build_word_template_asset_paths(&resolve_word_template_dir(&app, &template_id)?);
    if !json_path.exists() {
        return Err(format!("未找到模板配置文件: {}", json_path.display()));
    }
    std::fs::read_to_string(&json_path).map_err(|e| format!("读取模板配置失败: {e}"))
}

#[tauri::command]
pub(crate) async fn get_word_template_notes(
    app: AppHandle,
    template_id: String,
) -> Result<String, String> {
    let (_, markdown_path, _) =
        build_word_template_asset_paths(&resolve_word_template_dir(&app, &template_id)?);
    if !markdown_path.exists() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&markdown_path).map_err(|e| format!("读取模板说明失败: {e}"))
}

#[tauri::command]
pub(crate) async fn get_word_template_authoring_metadata(
    app: AppHandle,
    template_id: String,
) -> Result<String, String> {
    let template_dir = resolve_word_template_dir(&app, &template_id)?;
    let authoring_path = build_word_template_authoring_path(&template_dir);
    if !authoring_path.exists() {
        return Ok("{}".to_string());
    }
    let raw = std::fs::read_to_string(&authoring_path)
        .map_err(|e| format!("读取模板作者信息失败: {e}"))?;
    let normalized = serde_json::to_string_pretty(
        &serde_json::from_str::<WordTemplateAuthoringMetadata>(&raw)
            .map_err(|e| format!("解析模板作者信息失败: {e}"))?,
    )
    .map_err(|e| format!("格式化模板作者信息失败: {e}"))?;
    Ok(normalized)
}

#[tauri::command]
pub(crate) async fn save_word_template_artifacts(
    app: AppHandle,
    template_id: String,
    template_json: String,
    usage_markdown: String,
    template_request: String,
    sample_markdown: String,
) -> Result<(), String> {
    let normalized_id = template_id.trim();
    if normalized_id.is_empty() {
        return Err("template_id is empty".to_string());
    }

    let template_dir = resolve_word_template_dir(&app, normalized_id)?;
    std::fs::create_dir_all(&template_dir).map_err(|e| format!("无法创建模板目录失败: {e}"))?;
    let (json_path, markdown_path, _) = build_word_template_asset_paths(&template_dir);
    let authoring_path = build_word_template_authoring_path(&template_dir);

    let normalized_json = serde_json::to_string_pretty(
        &serde_json::from_str::<serde_json::Value>(&template_json)
            .map_err(|e| format!("模板 JSON 非法: {e}"))?,
    )
    .map_err(|e| format!("模板 JSON 格式化失败: {e}"))?;

    std::fs::write(&json_path, normalized_json).map_err(|e| format!("写入模板配置失败: {e}"))?;
    std::fs::write(&markdown_path, usage_markdown).map_err(|e| format!("写入模板说明失败: {e}"))?;
    let authoring_json = serde_json::to_string_pretty(&WordTemplateAuthoringMetadata {
        template_request,
        sample_markdown,
    })
    .map_err(|e| format!("格式化模板作者信息失败: {e}"))?;
    std::fs::write(&authoring_path, authoring_json)
        .map_err(|e| format!("写入模板作者信息失败: {e}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn should_build_word_template_asset_paths_from_template_dir() {
        let template_dir = Path::new("/tmp/word_templates/meeting-notes");
        let (json_path, markdown_path, docx_path) = build_word_template_asset_paths(template_dir);

        assert_eq!(
            json_path,
            Path::new("/tmp/word_templates/meeting-notes/template.json")
        );
        assert_eq!(
            markdown_path,
            Path::new("/tmp/word_templates/meeting-notes/usage.md")
        );
        assert_eq!(
            docx_path,
            Path::new("/tmp/word_templates/meeting-notes/template.docx")
        );
    }
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
