use std::fs::OpenOptions;
use std::io::Write;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub(crate) fn append_ai_chat_scroll_debug(
    app: AppHandle,
    line: String,
    reset: bool,
) -> Result<String, String> {
    static WRITE_LOCK: Mutex<()> = Mutex::new(());
    let _guard = WRITE_LOCK.lock().map_err(|error| error.to_string())?;
    let mut path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    path.push("ai-chat-scroll-debug.log");
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .append(!reset)
        .truncate(reset)
        .open(&path)
        .map_err(|error| error.to_string())?;
    writeln!(file, "{line}").map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}
