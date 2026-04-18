use crate::{err_payload, new_trace_id, ok, ErrorCode, ResultPayload};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tokio::fs;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SkillScriptCfg {
    pub id: String,
    pub label: String,
    pub runtime: String,
    pub entry: String,
    pub approval_policy: String,
    #[serde(default)]
    pub args_schema: Option<String>,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SkillDocumentCfg {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub enabled: bool,
    pub trusted: bool,
    pub load_policy: String,
    #[serde(default)]
    pub markdown: String,
    #[serde(default)]
    pub scripts: Vec<SkillScriptCfg>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SkillSummaryCfg {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub enabled: bool,
    pub trusted: bool,
    pub script_count: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SkillDefinitionFile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub enabled: bool,
    pub trusted: bool,
    pub load_policy: String,
    #[serde(default)]
    pub scripts: Vec<SkillDefinitionScriptCfg>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SkillDefinitionScriptCfg {
    pub id: String,
    pub label: String,
    pub runtime: String,
    pub entry: String,
    pub approval_policy: String,
    #[serde(default)]
    pub args_schema: Option<String>,
}

pub(crate) fn skills_root_dir(app: &AppHandle) -> std::io::Result<PathBuf> {
    if let Ok(mut dir) = app.path().config_dir() {
        dir.push("haomd");
        dir.push("skills");
        std::fs::create_dir_all(&dir)?;
        return Ok(dir);
    }
    let dir = std::env::current_dir()?.join("skills");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub(crate) fn sanitize_skill_id(input: &str) -> String {
    let trimmed = input.trim().to_lowercase();
    let mut output = String::new();
    let mut prev_dash = false;
    for ch in trimmed.chars() {
        let allowed = ch.is_ascii_alphanumeric();
        if allowed {
            output.push(ch);
            prev_dash = false;
        } else if !prev_dash {
            output.push('-');
            prev_dash = true;
        }
    }
    let normalized = output.trim_matches('-').to_string();
    if normalized.is_empty() {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or_default();
        format!("skill-{}", millis)
    } else {
        normalized
    }
}

fn ensure_relative_script_entry(entry: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(entry.trim());
    if path.as_os_str().is_empty() {
        return Err("脚本 entry 不能为空".to_string());
    }
    if path.is_absolute() {
        return Err("脚本 entry 必须是相对路径".to_string());
    }
    for component in path.components() {
        match component {
            Component::Normal(_) => {}
            _ => return Err("脚本 entry 包含非法路径片段".to_string()),
        }
    }
    Ok(path)
}

pub(crate) async fn read_skill_document_from_dir(dir: &Path) -> Result<SkillDocumentCfg, String> {
    let skill_json_path = dir.join("skill.json");
    let markdown_path = dir.join("SKILL.md");
    let skill_bytes = fs::read(&skill_json_path)
        .await
        .map_err(|e| format!("读取 skill.json 失败: {e}"))?;
    let definition: SkillDefinitionFile =
        serde_json::from_slice(&skill_bytes).map_err(|e| format!("解析 skill.json 失败: {e}"))?;
    let markdown = match fs::read_to_string(&markdown_path).await {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(err) => return Err(format!("读取 SKILL.md 失败: {err}")),
    };

    let mut scripts = Vec::new();
    for script in definition.scripts {
        let entry_path = ensure_relative_script_entry(&script.entry)?;
        let content = match fs::read_to_string(dir.join(&entry_path)).await {
            Ok(text) => text,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(err) => return Err(format!("读取脚本 {} 失败: {err}", script.entry)),
        };
        scripts.push(SkillScriptCfg {
            id: script.id,
            label: script.label,
            runtime: script.runtime,
            entry: script.entry,
            approval_policy: script.approval_policy,
            args_schema: script.args_schema,
            content,
        });
    }

    Ok(SkillDocumentCfg {
        id: definition.id,
        name: definition.name,
        description: definition.description,
        enabled: definition.enabled,
        trusted: definition.trusted,
        load_policy: definition.load_policy,
        markdown,
        scripts,
    })
}

#[tauri::command]
pub async fn list_skills(app: AppHandle) -> ResultPayload<Vec<SkillSummaryCfg>> {
    let trace = new_trace_id();
    let root = match skills_root_dir(&app) {
        Ok(root) => root,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取 Skills 目录失败: {err}"),
                trace,
            );
        }
    };
    let mut entries = match fs::read_dir(&root).await {
        Ok(entries) => entries,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("读取 Skills 目录失败: {err}"),
                trace,
            )
        }
    };
    let mut skills = Vec::new();
    loop {
        match entries.next_entry().await {
            Ok(Some(entry)) => {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                match read_skill_document_from_dir(&path).await {
                    Ok(doc) => skills.push(SkillSummaryCfg {
                        id: doc.id,
                        name: doc.name,
                        description: doc.description,
                        enabled: doc.enabled,
                        trusted: doc.trusted,
                        script_count: doc.scripts.len(),
                    }),
                    Err(_) => continue,
                }
            }
            Ok(None) => break,
            Err(err) => {
                return err_payload(
                    ErrorCode::IoError,
                    format!("遍历 Skills 目录失败: {err}"),
                    trace,
                )
            }
        }
    }
    skills.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    ok(skills, trace)
}

#[tauri::command]
pub async fn read_skill(
    app: AppHandle,
    skill_id: String,
) -> ResultPayload<Option<SkillDocumentCfg>> {
    let trace = new_trace_id();
    let root = match skills_root_dir(&app) {
        Ok(root) => root,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取 Skills 目录失败: {err}"),
                trace,
            );
        }
    };
    let path = root.join(sanitize_skill_id(&skill_id));
    match fs::metadata(&path).await {
        Ok(meta) if meta.is_dir() => {}
        Ok(_) => return ok(None, trace),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return ok(None, trace),
        Err(err) => {
            return err_payload(ErrorCode::IoError, format!("读取 Skill 失败: {err}"), trace)
        }
    }
    match read_skill_document_from_dir(&path).await {
        Ok(doc) => ok(Some(doc), trace),
        Err(err) => err_payload(ErrorCode::IoError, err, trace),
    }
}

#[tauri::command]
pub async fn save_skill(app: AppHandle, cfg: SkillDocumentCfg) -> ResultPayload<()> {
    let trace = new_trace_id();
    let root = match skills_root_dir(&app) {
        Ok(root) => root,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取 Skills 目录失败: {err}"),
                trace,
            );
        }
    };
    let skill_id = sanitize_skill_id(&cfg.id);
    let dir = root.join(&skill_id);
    if let Err(err) = fs::create_dir_all(&dir).await {
        return err_payload(
            ErrorCode::IoError,
            format!("创建 Skill 目录失败: {err}"),
            trace,
        );
    }

    let existing = read_skill_document_from_dir(&dir).await.ok();
    let mut next_entries = HashSet::new();
    let mut scripts_for_json = Vec::new();

    if let Err(err) = fs::write(dir.join("SKILL.md"), cfg.markdown.as_bytes()).await {
        return err_payload(
            ErrorCode::IoError,
            format!("写入 SKILL.md 失败: {err}"),
            trace,
        );
    }

    for script in &cfg.scripts {
        let entry_path = match ensure_relative_script_entry(&script.entry) {
            Ok(path) => path,
            Err(err) => return err_payload(ErrorCode::InvalidPath, err, trace),
        };
        next_entries.insert(entry_path.clone());
        let full_path = dir.join(&entry_path);
        if let Some(parent) = full_path.parent() {
            if let Err(err) = fs::create_dir_all(parent).await {
                return err_payload(
                    ErrorCode::IoError,
                    format!("创建脚本目录失败: {err}"),
                    trace,
                );
            }
        }
        if let Err(err) = fs::write(&full_path, script.content.as_bytes()).await {
            return err_payload(ErrorCode::IoError, format!("写入脚本失败: {err}"), trace);
        }
        scripts_for_json.push(SkillDefinitionScriptCfg {
            id: script.id.trim().to_string(),
            label: script.label.trim().to_string(),
            runtime: script.runtime.trim().to_string(),
            entry: entry_path.to_string_lossy().to_string(),
            approval_policy: script.approval_policy.trim().to_string(),
            args_schema: script.args_schema.clone(),
        });
    }

    if let Some(existing_doc) = existing {
        for script in existing_doc.scripts {
            if let Ok(entry_path) = ensure_relative_script_entry(&script.entry) {
                if !next_entries.contains(&entry_path) {
                    let _ = fs::remove_file(dir.join(entry_path)).await;
                }
            }
        }
    }

    let definition = SkillDefinitionFile {
        id: skill_id,
        name: cfg.name.trim().to_string(),
        description: cfg.description.filter(|v| !v.trim().is_empty()),
        enabled: cfg.enabled,
        trusted: cfg.trusted,
        load_policy: if cfg.load_policy.trim().is_empty() {
            "on_demand".to_string()
        } else {
            cfg.load_policy.trim().to_string()
        },
        scripts: scripts_for_json,
    };

    let bytes = match serde_json::to_vec_pretty(&definition) {
        Ok(bytes) => bytes,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("序列化 Skill 失败: {err}"),
                trace,
            )
        }
    };
    if let Err(err) = fs::write(dir.join("skill.json"), bytes).await {
        return err_payload(
            ErrorCode::IoError,
            format!("写入 skill.json 失败: {err}"),
            trace,
        );
    }

    ok((), trace)
}

#[tauri::command]
pub async fn delete_skill(app: AppHandle, skill_id: String) -> ResultPayload<()> {
    let trace = new_trace_id();
    let root = match skills_root_dir(&app) {
        Ok(root) => root,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取 Skills 目录失败: {err}"),
                trace,
            );
        }
    };
    let dir = root.join(sanitize_skill_id(&skill_id));
    match fs::remove_dir_all(&dir).await {
        Ok(()) => ok((), trace),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => ok((), trace),
        Err(err) => err_payload(ErrorCode::IoError, format!("删除 Skill 失败: {err}"), trace),
    }
}
