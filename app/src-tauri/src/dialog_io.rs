use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn save_remote_image_with_dialog(
    app: AppHandle,
    default_file_name: String,
    image_url: String,
) -> Result<(), String> {
    let response = reqwest::get(&image_url)
        .await
        .map_err(|err| format!("下载图片失败: {err}"))?;
    if !response.status().is_success() {
        return Err(format!("下载图片失败: HTTP {}", response.status().as_u16()));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|err| format!("读取图片内容失败: {err}"))?
        .to_vec();

    let dialog = app.dialog().file().set_title("Save Generated Image");
    let dialog = dialog
        .add_filter("Images", &["png", "jpg", "jpeg", "webp"])
        .set_file_name(&default_file_name);

    dialog.save_file(move |file_path| {
        if let Some(path) = file_path {
            if let Some(path_str) = path.as_path() {
                let path_buf = path_str.to_path_buf();
                if let Some(parent) = path_buf.parent() {
                    if let Err(err) = std::fs::create_dir_all(parent) {
                        log::error!("[save_remote_image_with_dialog] 创建目录失败: {}", err);
                        return;
                    }
                }

                if let Err(err) = std::fs::write(&path_buf, &bytes) {
                    log::error!("[save_remote_image_with_dialog] 写入文件失败: {}", err);
                }
            }
        }
    });

    Ok(())
}

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
