use crate::haomd_paths::haomd_config_root_dir;
use crate::{err_payload, new_trace_id, ok, ErrorCode, ResultPayload};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tokio::fs;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CalendarReminderRecord {
    pub id: String,
    pub date: String,
    pub time: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CalendarRepeatRuleRecord {
    pub id: String,
    pub title: String,
    pub time: String,
    pub start_date: String,
    pub frequency: String,
    #[serde(default)]
    pub weekdays: Vec<u8>,
    #[serde(default)]
    pub interval_weeks: Option<u32>,
    #[serde(default)]
    pub until: Option<String>,
    #[serde(default)]
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CalendarMarkerRecord {
    pub id: String,
    pub date: String,
    pub title: String,
    #[serde(default = "default_marker_color")]
    pub color: String,
    pub created_at: String,
    pub updated_at: String,
}

fn default_marker_color() -> String {
    "blue".to_string()
}

fn calendar_data_dir(app: &AppHandle) -> std::io::Result<PathBuf> {
    Ok(haomd_config_root_dir(app)?.join("calendar"))
}

fn legacy_calendar_data_dirs(app: &AppHandle) -> std::io::Result<Vec<PathBuf>> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| std::io::Error::other(err.to_string()))?;
    let app_data_parent = app_data_dir
        .parent()
        .ok_or_else(|| std::io::Error::other("应用数据目录无父目录"))?;
    Ok(vec![
        app_data_parent.join("haomd").join("calendar"),
        app_data_dir.join("calendar"),
    ])
}

fn sort_reminders(mut reminders: Vec<CalendarReminderRecord>) -> Vec<CalendarReminderRecord> {
    reminders.sort_by(compare_reminders);
    reminders
}

fn sort_repeat_rules(mut rules: Vec<CalendarRepeatRuleRecord>) -> Vec<CalendarRepeatRuleRecord> {
    rules.sort_by(compare_repeat_rules);
    rules
}

fn compare_reminders(a: &CalendarReminderRecord, b: &CalendarReminderRecord) -> Ordering {
    let by_date = a.date.cmp(&b.date);
    if by_date != Ordering::Equal {
        return by_date;
    }
    let by_time = a.time.cmp(&b.time);
    if by_time != Ordering::Equal {
        return by_time;
    }
    a.created_at.cmp(&b.created_at)
}

fn compare_repeat_rules(a: &CalendarRepeatRuleRecord, b: &CalendarRepeatRuleRecord) -> Ordering {
    let by_start = a.start_date.cmp(&b.start_date);
    if by_start != Ordering::Equal {
        return by_start;
    }
    let by_time = a.time.cmp(&b.time);
    if by_time != Ordering::Equal {
        return by_time;
    }
    a.created_at.cmp(&b.created_at)
}

async fn read_json_vec<T>(path: &Path) -> std::io::Result<Vec<T>>
where
    T: for<'de> Deserialize<'de>,
{
    match fs::read_to_string(path).await {
        Ok(content) => Ok(serde_json::from_str::<Vec<T>>(&content).unwrap_or_default()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(err) => Err(err),
    }
}

async fn write_json_vec<T>(path: &Path, data: &[T]) -> std::io::Result<()>
where
    T: Serialize,
{
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    let json = serde_json::to_string_pretty(data)?;
    fs::write(path, json).await
}

async fn prepare_calendar_store_path(app: &AppHandle, file_name: &str) -> std::io::Result<PathBuf> {
    let current_dir = calendar_data_dir(app)?;
    fs::create_dir_all(&current_dir).await?;
    let current_path = current_dir.join(file_name);
    if fs::metadata(&current_path).await.is_ok() {
        return Ok(current_path);
    }

    for legacy_dir in legacy_calendar_data_dirs(app)? {
        if legacy_dir == current_dir {
            continue;
        }
        let legacy_path = legacy_dir.join(file_name);
        if fs::metadata(&legacy_path).await.is_ok() {
            fs::copy(&legacy_path, &current_path).await?;
            break;
        }
    }
    Ok(current_path)
}

#[tauri::command]
pub async fn load_calendar_reminders(app: AppHandle) -> ResultPayload<Vec<CalendarReminderRecord>> {
    let trace = new_trace_id();
    let path = match prepare_calendar_store_path(&app, "reminders.json").await {
        Ok(path) => path,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取日历提醒路径失败: {err}"),
                trace,
            )
        }
    };

    match read_json_vec::<CalendarReminderRecord>(&path).await {
        Ok(reminders) => ok(sort_reminders(reminders), trace),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("读取日历提醒失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
pub async fn save_calendar_reminders(
    app: AppHandle,
    reminders: Vec<CalendarReminderRecord>,
) -> ResultPayload<()> {
    let trace = new_trace_id();
    let path = match prepare_calendar_store_path(&app, "reminders.json").await {
        Ok(path) => path,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取日历提醒路径失败: {err}"),
                trace,
            )
        }
    };

    let sorted = sort_reminders(reminders);
    match write_json_vec(&path, &sorted).await {
        Ok(_) => ok((), trace),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("写入日历提醒失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
pub async fn load_calendar_repeat_rules(
    app: AppHandle,
) -> ResultPayload<Vec<CalendarRepeatRuleRecord>> {
    let trace = new_trace_id();
    let path = match prepare_calendar_store_path(&app, "repeat-rules.json").await {
        Ok(path) => path,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取重复提醒路径失败: {err}"),
                trace,
            )
        }
    };

    match read_json_vec::<CalendarRepeatRuleRecord>(&path).await {
        Ok(rules) => ok(sort_repeat_rules(rules), trace),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("读取重复提醒失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
pub async fn save_calendar_repeat_rules(
    app: AppHandle,
    rules: Vec<CalendarRepeatRuleRecord>,
) -> ResultPayload<()> {
    let trace = new_trace_id();
    let path = match prepare_calendar_store_path(&app, "repeat-rules.json").await {
        Ok(path) => path,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取重复提醒路径失败: {err}"),
                trace,
            )
        }
    };

    let sorted = sort_repeat_rules(rules);
    match write_json_vec(&path, &sorted).await {
        Ok(_) => ok((), trace),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("写入重复提醒失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
pub async fn load_calendar_markers(app: AppHandle) -> ResultPayload<Vec<CalendarMarkerRecord>> {
    let trace = new_trace_id();
    let path = match prepare_calendar_store_path(&app, "markers.json").await {
        Ok(path) => path,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取日历标记路径失败: {err}"),
                trace,
            )
        }
    };
    match read_json_vec::<CalendarMarkerRecord>(&path).await {
        Ok(markers) => {
            let mut markers = markers;
            markers.sort_by(|a, b| {
                a.date
                    .cmp(&b.date)
                    .then_with(|| a.created_at.cmp(&b.created_at))
            });
            ok(markers, trace)
        }
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("读取日历标记失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
pub async fn save_calendar_markers(
    app: AppHandle,
    markers: Vec<CalendarMarkerRecord>,
) -> ResultPayload<()> {
    let trace = new_trace_id();
    let path = match prepare_calendar_store_path(&app, "markers.json").await {
        Ok(path) => path,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取日历标记路径失败: {err}"),
                trace,
            )
        }
    };
    let mut markers = markers;
    markers.sort_by(|a, b| {
        a.date
            .cmp(&b.date)
            .then_with(|| a.created_at.cmp(&b.created_at))
    });
    match write_json_vec(&path, &markers).await {
        Ok(_) => ok((), trace),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("写入日历标记失败: {err}"),
            trace,
        ),
    }
}
