use super::types::{
    FinalizedImportedWordDocument, ImportedWordDocument, ImportedWordImageAsset,
};
use rand::Rng;
use std::path::{Path, PathBuf};

pub fn create_temp_workspace(
    source_docx_path: &Path,
    markdown: &str,
    assets: &[ImportedWordImageAsset],
    warnings: Vec<String>,
) -> Result<ImportedWordDocument, String> {
    let temp_dir = build_temp_workspace_dir();
    let images_dir = temp_dir.join("images");
    std::fs::create_dir_all(&images_dir).map_err(|e| format!("创建导入临时目录失败: {e}"))?;

    let markdown_path = temp_dir.join("document.md");
    std::fs::write(&markdown_path, markdown).map_err(|e| format!("写入临时 Markdown 失败: {e}"))?;

    for asset in assets {
        let target = images_dir.join(&asset.file_name);
        std::fs::write(target, &asset.bytes).map_err(|e| format!("写入临时图片失败: {e}"))?;
    }

    Ok(ImportedWordDocument {
        markdown: markdown.to_string(),
        temp_dir: temp_dir.to_string_lossy().into_owned(),
        temp_markdown_path: markdown_path.to_string_lossy().into_owned(),
        temp_images_dir: images_dir.to_string_lossy().into_owned(),
        source_docx_path: source_docx_path.to_string_lossy().into_owned(),
        warnings,
    })
}

pub fn finalize_workspace(
    temp_dir: &Path,
    markdown: &str,
    output_path: &Path,
) -> Result<FinalizedImportedWordDocument, String> {
    let parent = output_path
        .parent()
        .ok_or_else(|| "目标 Markdown 路径无效".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| format!("创建目标目录失败: {e}"))?;

    let base_name = output_path
        .file_stem()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .ok_or_else(|| "目标文件名无效".to_string())?;

    let temp_images_dir = temp_dir.join("images");
    let target_assets_dir = parent.join("images").join(base_name);
    std::fs::create_dir_all(&target_assets_dir).map_err(|e| format!("创建目标图片目录失败: {e}"))?;

    let mut final_markdown = markdown.replace("\r\n", "\n");
    if temp_images_dir.is_dir() {
        for entry in std::fs::read_dir(&temp_images_dir).map_err(|e| format!("读取临时图片目录失败: {e}"))? {
            let entry = entry.map_err(|e| format!("读取临时图片目录项失败: {e}"))?;
            if !entry.path().is_file() {
                continue;
            }
            let file_name = entry.file_name().to_string_lossy().into_owned();
            std::fs::copy(entry.path(), target_assets_dir.join(&file_name))
                .map_err(|e| format!("迁移图片失败: {e}"))?;
            final_markdown = final_markdown.replace(
                &format!("images/{file_name}"),
                &format!("images/{base_name}/{file_name}"),
            );
        }
    }

    std::fs::write(output_path, &final_markdown).map_err(|e| format!("写入 Markdown 文件失败: {e}"))?;
    cleanup_workspace(temp_dir)?;

    Ok(FinalizedImportedWordDocument {
        markdown: final_markdown,
        saved_path: output_path.to_string_lossy().into_owned(),
        assets_dir: target_assets_dir.to_string_lossy().into_owned(),
    })
}

pub fn cleanup_workspace(temp_dir: &Path) -> Result<(), String> {
    if !temp_dir.exists() {
        return Ok(());
    }
    std::fs::remove_dir_all(temp_dir).map_err(|e| format!("清理临时导入目录失败: {e}"))
}

pub fn cleanup_all_workspaces() -> Result<(), String> {
    let root = temp_workspace_root();
    if !root.exists() {
        return Ok(());
    }
    for entry in std::fs::read_dir(&root).map_err(|e| format!("读取 Word 导入临时目录失败: {e}"))? {
        let entry = entry.map_err(|e| format!("读取 Word 导入临时目录项失败: {e}"))?;
        let path = entry.path();
        if path.is_dir() {
            cleanup_workspace(&path)?;
        }
    }
    Ok(())
}

fn build_temp_workspace_dir() -> PathBuf {
    let mut rng = rand::thread_rng();
    let token = format!(
        "{}-{:08x}",
        chrono::Local::now().format("%Y%m%d%H%M%S"),
        rng.gen::<u32>()
    );
    temp_workspace_root().join(token)
}

fn temp_workspace_root() -> PathBuf {
    std::env::temp_dir().join("haomd-word-import")
}
