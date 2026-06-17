use crate::{
    build_template_replacements, build_word_export_workspace,
    build_word_export_workspace_with_template, load_word_template_docx_overlay, new_trace_id,
    package_docx_workspace, resolve_word_template_docx_path, resolve_word_template_paths,
    rewrite_docx_template, WordBlockCfg, WordDocPayloadCfg, WordTemplateConfigCfg,
};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

#[tauri::command]
pub async fn export_word_docx(payload_json: String, output_path: String) -> Result<(), String> {
    let payload: WordDocPayloadCfg =
        serde_json::from_str(&payload_json).map_err(|e| format!("解析导出数据失败: {e}"))?;
    let output = PathBuf::from(&output_path);
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建输出目录失败: {e}"))?;
    }

    let work_dir = std::env::temp_dir().join(format!(
        "haomd-word-export-{}",
        new_trace_id().replace("trace_", "")
    ));
    if work_dir.exists() {
        let _ = std::fs::remove_dir_all(&work_dir);
    }

    let result = (|| -> Result<(), String> {
        build_word_export_workspace(&work_dir, &payload)?;
        package_docx_workspace(&work_dir, &output)?;
        Ok(())
    })();

    let _ = std::fs::remove_dir_all(&work_dir);
    result
}

#[tauri::command]
pub async fn fill_docx_template(
    app: AppHandle,
    template_id: String,
    model_json: String,
    rich_blocks_json: String,
    output_path: String,
) -> Result<(), String> {
    let (docx_path, json_path) = resolve_word_template_paths(&app, &template_id)?;
    let template_overlay = load_word_template_docx_overlay(&docx_path)?;
    let template_cfg: WordTemplateConfigCfg = serde_json::from_slice(
        &std::fs::read(&json_path).map_err(|e| format!("读取模板配置失败: {e}"))?,
    )
    .map_err(|e| format!("解析模板配置失败: {e}"))?;
    let model: serde_json::Value =
        serde_json::from_str(&model_json).map_err(|e| format!("解析模板数据失败: {e}"))?;
    let rich_blocks: HashMap<String, Vec<WordBlockCfg>> =
        serde_json::from_str(&rich_blocks_json)
            .map_err(|e| format!("解析模板富文本数据失败: {e}"))?;

    if let Some(parent) = Path::new(&output_path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建输出目录失败: {e}"))?;
    }

    let replacements = build_template_replacements(
        &template_cfg,
        &model,
        &rich_blocks,
        Some(&template_overlay.convention_styles),
    )?;
    rewrite_docx_template(&docx_path, Path::new(&output_path), &replacements)
}

#[tauri::command]
pub async fn export_word_docx_with_template(
    app: AppHandle,
    template_id: String,
    payload_json: String,
    output_path: String,
) -> Result<(), String> {
    let payload: WordDocPayloadCfg =
        serde_json::from_str(&payload_json).map_err(|e| format!("解析导出数据失败: {e}"))?;
    let template_docx = resolve_word_template_docx_path(&app, &template_id)?;
    let template_overlay = load_word_template_docx_overlay(&template_docx)?;
    let output = PathBuf::from(&output_path);
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建输出目录失败: {e}"))?;
    }

    let work_dir = std::env::temp_dir().join(format!(
        "haomd-word-export-template-{}",
        new_trace_id().replace("trace_", "")
    ));
    if work_dir.exists() {
        let _ = std::fs::remove_dir_all(&work_dir);
    }

    let result = (|| -> Result<(), String> {
        build_word_export_workspace_with_template(&work_dir, &payload, &template_overlay)?;
        package_docx_workspace(&work_dir, &output)?;
        Ok(())
    })();

    let _ = std::fs::remove_dir_all(&work_dir);
    result
}
