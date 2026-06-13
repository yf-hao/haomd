mod docx;
mod markdown;
mod types;
mod workspace;

pub use types::{FinalizedImportedWordDocument, ImportedWordDocument};

#[tauri::command]
pub async fn import_word_docx_to_temp_markdown(path: String) -> Result<ImportedWordDocument, String> {
    let source_path = std::path::PathBuf::from(path);
    let parsed = docx::import_docx(&source_path)?;
    let markdown = markdown::render_markdown(&parsed.blocks);
    workspace::create_temp_workspace(&source_path, &markdown, &parsed.assets, parsed.warnings)
}

#[tauri::command]
pub async fn finalize_imported_word_markdown(
    temp_dir: String,
    markdown: String,
    output_path: String,
) -> Result<FinalizedImportedWordDocument, String> {
    workspace::finalize_workspace(
        std::path::Path::new(&temp_dir),
        &markdown,
        std::path::Path::new(&output_path),
    )
}

#[tauri::command]
pub async fn cleanup_imported_word_temp(temp_dir: String) -> Result<(), String> {
    workspace::cleanup_workspace(std::path::Path::new(&temp_dir))
}

#[tauri::command]
pub async fn cleanup_stale_imported_word_temps() -> Result<(), String> {
    workspace::cleanup_all_workspaces()
}
