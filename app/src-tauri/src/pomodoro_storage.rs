use crate::pomodoro_paths::{
    ensure_pomodoro_root_dir, legacy_pomodoro_root_dir, pomodoro_root_dir,
};
use crate::{err_payload, new_trace_id, ok, ErrorCode, ResultPayload};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::AppHandle;
use tokio::fs;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroSettingsRecord {
    pub focus_minutes: u32,
    pub short_break_minutes: u32,
    pub long_break_minutes: u32,
    pub rounds_before_long_break: u32,
    #[serde(default)]
    pub alarm_sound_file: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroStateRecord {
    pub mode: String,
    pub running: bool,
    pub remaining_seconds: u32,
    pub cycle_count: u32,
    #[serde(default)]
    pub target_end_at: Option<String>,
    #[serde(default)]
    pub alarm_visible: bool,
    #[serde(default)]
    pub alarm_reason: Option<String>,
    pub settings: PomodoroSettingsRecord,
    pub updated_at: String,
}

impl Default for PomodoroStateRecord {
    fn default() -> Self {
        Self {
            mode: "idle".to_string(),
            running: false,
            remaining_seconds: 25 * 60,
            cycle_count: 0,
            target_end_at: None,
            alarm_visible: false,
            alarm_reason: None,
            settings: PomodoroSettingsRecord {
                focus_minutes: 25,
                short_break_minutes: 5,
                long_break_minutes: 15,
                rounds_before_long_break: 4,
                alarm_sound_file: None,
            },
            updated_at: String::new(),
        }
    }
}

fn pomodoro_data_dir(app: &AppHandle) -> std::io::Result<PathBuf> {
    Ok(pomodoro_root_dir(app)?.join("pomodoro"))
}

fn pomodoro_state_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    Ok(pomodoro_data_dir(app)?.join("pomodoro.json"))
}

async fn read_json<T>(path: &PathBuf) -> std::io::Result<T>
where
    T: for<'de> Deserialize<'de> + Default,
{
    match fs::read_to_string(path).await {
        Ok(content) => Ok(serde_json::from_str::<T>(&content).unwrap_or_default()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(err) => Err(err),
    }
}

async fn write_json<T>(path: &PathBuf, data: &T) -> std::io::Result<()>
where
    T: Serialize,
{
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    let json = serde_json::to_string_pretty(data)?;
    fs::write(path, json).await
}

async fn ensure_legacy_state_migrated(
    app: &AppHandle,
    current_path: &PathBuf,
) -> std::io::Result<()> {
    if fs::metadata(current_path).await.is_ok() {
        return Ok(());
    }

    let mut legacy_root = legacy_pomodoro_root_dir(app)?;
    legacy_root.push("pomodoro");
    let legacy_path: PathBuf = legacy_root.join("pomodoro.json");
    if fs::metadata(&legacy_path).await.is_ok() {
        if let Some(parent) = current_path.parent() {
            fs::create_dir_all(parent).await?;
        }
        fs::copy(&legacy_path, current_path).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn load_pomodoro_state(app: AppHandle) -> ResultPayload<PomodoroStateRecord> {
    let trace = new_trace_id();
    let _root = match ensure_pomodoro_root_dir(&app).await {
        Ok(root) => root,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("准备番茄闹钟目录失败: {err}"),
                trace,
            )
        }
    };
    let path = match pomodoro_state_path(&app) {
        Ok(path) => path,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取番茄闹钟状态路径失败: {err}"),
                trace,
            )
        }
    };
    if let Err(err) = ensure_legacy_state_migrated(&app, &path).await {
        return err_payload(
            ErrorCode::IoError,
            format!("迁移番茄闹钟状态失败: {err}"),
            trace,
        );
    }

    match read_json::<PomodoroStateRecord>(&path).await {
        Ok(state) => ok(state, trace),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("读取番茄闹钟状态失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
pub async fn save_pomodoro_state(app: AppHandle, state: PomodoroStateRecord) -> ResultPayload<()> {
    let trace = new_trace_id();
    let _root = match ensure_pomodoro_root_dir(&app).await {
        Ok(root) => root,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("准备番茄闹钟目录失败: {err}"),
                trace,
            )
        }
    };
    let path = match pomodoro_state_path(&app) {
        Ok(path) => path,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取番茄闹钟状态路径失败: {err}"),
                trace,
            )
        }
    };
    if let Err(err) = ensure_legacy_state_migrated(&app, &path).await {
        return err_payload(
            ErrorCode::IoError,
            format!("迁移番茄闹钟状态失败: {err}"),
            trace,
        );
    }

    match write_json(&path, &state).await {
        Ok(_) => ok((), trace),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("写入番茄闹钟状态失败: {err}"),
            trace,
        ),
    }
}
