use crate::skills::{sanitize_skill_id, skills_root_dir, SkillDefinitionFile, SkillSummaryCfg};
use crate::{err_payload, new_trace_id, ok, ErrorCode, ResultPayload};
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tokio::fs;

fn parse_skill_frontmatter(markdown: &str) -> Result<(String, String, String), String> {
    let normalized = markdown.strip_prefix('\u{feff}').unwrap_or(markdown);
    if normalized.lines().next().map(str::trim) != Some("---") {
        return Err("SKILL.md 必须以 YAML front matter 开始".to_string());
    }

    let mut name = None;
    let mut description = None;
    let mut body_start = None;
    for (index, line) in normalized.lines().enumerate().skip(1) {
        if line.trim() == "---" {
            body_start = Some(index + 1);
            break;
        }
        if let Some((key, value)) = line.split_once(':') {
            let value = value.trim();
            let value = value
                .strip_prefix('"')
                .and_then(|text| text.strip_suffix('"'))
                .or_else(|| {
                    value
                        .strip_prefix('\'')
                        .and_then(|text| text.strip_suffix('\''))
                })
                .unwrap_or(value)
                .trim()
                .to_string();
            match key.trim() {
                "name" => name = Some(value),
                "description" => description = Some(value),
                _ => {}
            }
        }
    }

    let body_start =
        body_start.ok_or_else(|| "SKILL.md front matter 缺少结束标记 ---".to_string())?;
    let name = name
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "SKILL.md front matter 缺少 name".to_string())?;
    let description = description
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "SKILL.md front matter 缺少 description".to_string())?;
    let body = normalized
        .lines()
        .skip(body_start)
        .collect::<Vec<_>>()
        .join("\n");
    Ok((name, description, body))
}

fn invalid_skill(message: impl Into<String>, trace: String) -> ResultPayload<SkillSummaryCfg> {
    err_payload(ErrorCode::InvalidPath, message, trace)
}

async fn read_skill_markdown(source_dir: &Path) -> Result<String, String> {
    let markdown_path = source_dir.join("SKILL.md");
    match fs::symlink_metadata(&markdown_path).await {
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => {}
        Ok(_) => return Err("SKILL.md 必须是普通文件".to_string()),
        Err(err) => return Err(format!("读取 SKILL.md 失败: {err}")),
    }
    fs::read_to_string(markdown_path)
        .await
        .map_err(|err| format!("读取 SKILL.md 失败: {err}"))
}

async fn persist_imported_skill(
    app: &AppHandle,
    name: String,
    description: String,
    markdown: String,
    trace: String,
) -> ResultPayload<SkillSummaryCfg> {
    let id = sanitize_skill_id(&name);
    let root = match skills_root_dir(app) {
        Ok(root) => root,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取 Skills 目录失败: {err}"),
                trace,
            )
        }
    };
    if let Err(err) = fs::create_dir_all(&root).await {
        return err_payload(
            ErrorCode::IoError,
            format!("创建 Skills 目录失败: {err}"),
            trace,
        );
    }

    let destination = root.join(&id);
    if let Err(err) = fs::create_dir(&destination).await {
        if err.kind() == std::io::ErrorKind::AlreadyExists {
            return invalid_skill(format!("Skill 已存在: {name}"), trace);
        }
        return err_payload(
            ErrorCode::IoError,
            format!("创建 Skill 目录失败: {err}"),
            trace,
        );
    }

    let definition = SkillDefinitionFile {
        id: id.clone(),
        name: name.clone(),
        description: Some(description.clone()),
        enabled: false,
        legacy_trusted: None,
        load_policy: "on_demand".to_string(),
        scripts: Vec::new(),
    };
    let definition_bytes = match serde_json::to_vec_pretty(&definition) {
        Ok(bytes) => bytes,
        Err(err) => {
            let _ = fs::remove_dir_all(&destination).await;
            return err_payload(
                ErrorCode::IoError,
                format!("序列化 Skill 失败: {err}"),
                trace,
            );
        }
    };
    if let Err(err) = fs::write(destination.join("SKILL.md"), markdown).await {
        let _ = fs::remove_dir_all(&destination).await;
        return err_payload(
            ErrorCode::IoError,
            format!("写入 SKILL.md 失败: {err}"),
            trace,
        );
    }
    if let Err(err) = fs::write(destination.join("skill.json"), definition_bytes).await {
        let _ = fs::remove_dir_all(&destination).await;
        return err_payload(
            ErrorCode::IoError,
            format!("写入 skill.json 失败: {err}"),
            trace,
        );
    }

    ok(
        SkillSummaryCfg {
            id,
            name,
            description: Some(description),
            enabled: false,
            script_count: 0,
        },
        trace,
    )
}

#[tauri::command]
pub async fn import_skill_from_directory(
    app: AppHandle,
    source_dir: String,
) -> ResultPayload<SkillSummaryCfg> {
    let trace = new_trace_id();
    let source = match fs::canonicalize(PathBuf::from(source_dir)).await {
        Ok(path) if path.is_dir() => path,
        Ok(_) => return invalid_skill("所选路径不是目录", trace),
        Err(err) => return invalid_skill(format!("无法访问所选目录: {err}"), trace),
    };
    let markdown = match read_skill_markdown(&source).await {
        Ok(markdown) => markdown,
        Err(err) => return invalid_skill(err, trace),
    };
    let (name, description, body) = match parse_skill_frontmatter(&markdown) {
        Ok(parsed) => parsed,
        Err(err) => return invalid_skill(err, trace),
    };

    persist_imported_skill(&app, name, description, body, trace).await
}

#[cfg(test)]
mod tests {
    use super::parse_skill_frontmatter;

    #[test]
    fn parses_codex_skill_frontmatter_and_body() {
        let markdown = "---\nname: review-code\ndescription: Review code for correctness\n---\n\nReview the changes.";
        let parsed = parse_skill_frontmatter(markdown).expect("valid skill frontmatter");

        assert_eq!(parsed.0, "review-code");
        assert_eq!(parsed.1, "Review code for correctness");
        assert_eq!(parsed.2, "\nReview the changes.");
    }

    #[test]
    fn rejects_skill_without_required_description() {
        let error = parse_skill_frontmatter("---\nname: review-code\n---\nBody")
            .expect_err("description is required");

        assert!(error.contains("description"));
    }
}
