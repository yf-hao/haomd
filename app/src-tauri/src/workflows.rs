use crate::haomd_paths::haomd_config_subdir;
use crate::{err_payload, new_trace_id, ok, ErrorCode, ResultPayload};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tokio::fs;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkflowStepCfg {
    pub id: String,
    pub r#type: String,
    pub skill_id: String,
    pub script_id: String,
    #[serde(default)]
    pub input_template: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkflowDocumentCfg {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub enabled: bool,
    pub approval_policy: String,
    pub failure_policy: String,
    #[serde(default)]
    pub input_schema: String,
    #[serde(default)]
    pub output_from: String,
    #[serde(default)]
    pub markdown: String,
    #[serde(default)]
    pub steps: Vec<WorkflowStepCfg>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkflowSummaryCfg {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub enabled: bool,
    pub step_count: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct WorkflowDefinitionFile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub enabled: bool,
    pub approval_policy: String,
    pub failure_policy: String,
    #[serde(default)]
    pub input_schema: String,
    #[serde(default)]
    pub output_from: String,
    #[serde(default)]
    pub steps: Vec<WorkflowStepCfg>,
}

fn workflows_root_dir(app: &AppHandle) -> std::io::Result<PathBuf> {
    haomd_config_subdir(app, "workflows")
}

fn sanitize_workflow_id(input: &str) -> String {
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
        format!("workflow-{}", millis)
    } else {
        normalized
    }
}

async fn read_workflow_document_from_dir(
    dir: &std::path::Path,
) -> Result<WorkflowDocumentCfg, String> {
    let workflow_json_path = dir.join("workflow.json");
    let markdown_path = dir.join("WORKFLOW.md");
    let workflow_bytes = fs::read(&workflow_json_path)
        .await
        .map_err(|e| format!("读取 workflow.json 失败: {e}"))?;
    let definition: WorkflowDefinitionFile = serde_json::from_slice(&workflow_bytes)
        .map_err(|e| format!("解析 workflow.json 失败: {e}"))?;
    let markdown = match fs::read_to_string(&markdown_path).await {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(err) => return Err(format!("读取 WORKFLOW.md 失败: {err}")),
    };

    Ok(WorkflowDocumentCfg {
        id: definition.id,
        name: definition.name,
        description: definition.description,
        enabled: definition.enabled,
        approval_policy: definition.approval_policy,
        failure_policy: definition.failure_policy,
        input_schema: definition.input_schema,
        output_from: definition.output_from,
        markdown,
        steps: definition.steps,
    })
}

#[tauri::command]
pub async fn list_workflows(app: AppHandle) -> ResultPayload<Vec<WorkflowSummaryCfg>> {
    let trace = new_trace_id();
    let root = match workflows_root_dir(&app) {
        Ok(root) => root,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取 Workflows 目录失败: {err}"),
                trace,
            );
        }
    };
    let mut entries = match fs::read_dir(&root).await {
        Ok(entries) => entries,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("读取 Workflows 目录失败: {err}"),
                trace,
            );
        }
    };
    let mut workflows = Vec::new();
    loop {
        match entries.next_entry().await {
            Ok(Some(entry)) => {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                match read_workflow_document_from_dir(&path).await {
                    Ok(doc) => workflows.push(WorkflowSummaryCfg {
                        id: doc.id,
                        name: doc.name,
                        description: doc.description,
                        enabled: doc.enabled,
                        step_count: doc.steps.len(),
                    }),
                    Err(_) => continue,
                }
            }
            Ok(None) => break,
            Err(err) => {
                return err_payload(
                    ErrorCode::IoError,
                    format!("遍历 Workflows 目录失败: {err}"),
                    trace,
                );
            }
        }
    }
    workflows.sort_by_cached_key(|workflow| workflow.name.to_lowercase());
    ok(workflows, trace)
}

#[tauri::command]
pub async fn read_workflow(
    app: AppHandle,
    workflow_id: String,
) -> ResultPayload<Option<WorkflowDocumentCfg>> {
    let trace = new_trace_id();
    let root = match workflows_root_dir(&app) {
        Ok(root) => root,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取 Workflows 目录失败: {err}"),
                trace,
            );
        }
    };
    let path = root.join(sanitize_workflow_id(&workflow_id));
    match fs::metadata(&path).await {
        Ok(meta) if meta.is_dir() => {}
        Ok(_) => return ok(None, trace),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return ok(None, trace),
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("读取 Workflow 失败: {err}"),
                trace,
            );
        }
    }
    match read_workflow_document_from_dir(&path).await {
        Ok(doc) => ok(Some(doc), trace),
        Err(err) => err_payload(ErrorCode::IoError, err, trace),
    }
}

#[tauri::command]
pub async fn save_workflow(app: AppHandle, cfg: WorkflowDocumentCfg) -> ResultPayload<()> {
    let trace = new_trace_id();
    let root = match workflows_root_dir(&app) {
        Ok(root) => root,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取 Workflows 目录失败: {err}"),
                trace,
            );
        }
    };
    let workflow_id = sanitize_workflow_id(&cfg.id);
    let dir = root.join(&workflow_id);
    if let Err(err) = fs::create_dir_all(&dir).await {
        return err_payload(
            ErrorCode::IoError,
            format!("创建 Workflow 目录失败: {err}"),
            trace,
        );
    }

    if let Err(err) = fs::write(dir.join("WORKFLOW.md"), cfg.markdown.as_bytes()).await {
        return err_payload(
            ErrorCode::IoError,
            format!("写入 WORKFLOW.md 失败: {err}"),
            trace,
        );
    }

    let definition = WorkflowDefinitionFile {
        id: workflow_id,
        name: cfg.name.trim().to_string(),
        description: cfg.description.filter(|v| !v.trim().is_empty()),
        enabled: cfg.enabled,
        approval_policy: cfg.approval_policy.trim().to_string(),
        failure_policy: cfg.failure_policy.trim().to_string(),
        input_schema: cfg.input_schema,
        output_from: cfg.output_from,
        steps: cfg.steps,
    };

    let bytes = match serde_json::to_vec_pretty(&definition) {
        Ok(bytes) => bytes,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("序列化 Workflow 失败: {err}"),
                trace,
            );
        }
    };
    if let Err(err) = fs::write(dir.join("workflow.json"), bytes).await {
        return err_payload(
            ErrorCode::IoError,
            format!("写入 workflow.json 失败: {err}"),
            trace,
        );
    }

    ok((), trace)
}

#[tauri::command]
pub async fn delete_workflow(app: AppHandle, workflow_id: String) -> ResultPayload<()> {
    let trace = new_trace_id();
    let root = match workflows_root_dir(&app) {
        Ok(root) => root,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取 Workflows 目录失败: {err}"),
                trace,
            );
        }
    };
    let dir = root.join(sanitize_workflow_id(&workflow_id));
    match fs::remove_dir_all(&dir).await {
        Ok(()) => ok((), trace),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => ok((), trace),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("删除 Workflow 失败: {err}"),
            trace,
        ),
    }
}
