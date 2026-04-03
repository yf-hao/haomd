use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn save_text_with_dialog(
    app: AppHandle,
    default_file_name: String,
    content: String,
) -> Result<(), String> {
    let dialog = app.dialog().file().set_title("Save AI History as Markdown");
    let dialog = dialog
        .add_filter("Markdown", &["md"])
        .add_filter("Text", &["txt"])
        .set_file_name(&default_file_name);

    let content_to_write = content.clone();
    dialog.save_file(move |file_path| {
        if let Some(path) = file_path {
            if let Some(path_str) = path.as_path() {
                let path_buf = path_str.to_path_buf();
                if let Some(parent) = path_buf.parent() {
                    if let Err(err) = std::fs::create_dir_all(parent) {
                        log::error!("[save_text_with_dialog] 创建目录失败: {}", err);
                        return;
                    }
                }

                if let Err(err) = std::fs::write(&path_buf, content_to_write.as_bytes()) {
                    log::error!("[save_text_with_dialog] 写入文件失败: {}", err);
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn save_ai_sessions_json_with_dialog(
    app: AppHandle,
    default_file_name: String,
    content: String,
) -> Result<(), String> {
    let dialog = app
        .dialog()
        .file()
        .set_title("Save AI Sessions as JSON")
        .set_file_name(&default_file_name);

    let content_to_write = content.clone();
    dialog.save_file(move |file_path| {
        if let Some(path) = file_path {
            if let Some(path_str) = path.as_path() {
                let path_buf = path_str.to_path_buf();
                if let Some(parent) = path_buf.parent() {
                    if let Err(err) = std::fs::create_dir_all(parent) {
                        log::error!("[save_ai_sessions_json_with_dialog] 创建目录失败: {}", err);
                        return;
                    }
                }

                if let Err(err) = std::fs::write(&path_buf, content_to_write.as_bytes()) {
                    log::error!("[save_ai_sessions_json_with_dialog] 写入文件失败: {}", err);
                }
            }
        }
    });

    Ok(())
}
