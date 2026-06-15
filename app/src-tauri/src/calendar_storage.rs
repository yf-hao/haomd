use crate::haomd_paths::haomd_data_root_dir;
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

fn calendar_data_dir(app: &AppHandle) -> std::io::Result<PathBuf> {
    Ok(haomd_data_root_dir(app)?.join("calendar"))
}

fn legacy_calendar_data_dir(app: &AppHandle) -> std::io::Result<PathBuf> {
    let mut dir = app
        .path()
        .app_data_dir()
        .map_err(|err| std::io::Error::other(err.to_string()))?;
    dir.push("calendar");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn reminders_store_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    Ok(calendar_data_dir(app)?.join("reminders.json"))
}

fn repeat_rules_store_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    Ok(calendar_data_dir(app)?.join("repeat-rules.json"))
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

async fn migrate_legacy_calendar_data(app: &AppHandle, current_dir: &Path) -> std::io::Result<()> {
    let legacy_dir = legacy_calendar_data_dir(app)?;
    if legacy_dir == current_dir {
        return Ok(());
    }
    if fs::metadata(current_dir).await.is_ok() {
        return Ok(());
    }
    let Ok(metadata) = fs::metadata(&legacy_dir).await else {
        return Ok(());
    };
    if !metadata.is_dir() {
        return Ok(());
    }

    fs::create_dir_all(current_dir).await?;
    let legacy_reminders = legacy_dir.join("reminders.json");
    let current_reminders = current_dir.join("reminders.json");
    if fs::metadata(&legacy_reminders).await.is_ok() {
        let _ = fs::copy(&legacy_reminders, &current_reminders).await;
    }
    let legacy_repeat_rules = legacy_dir.join("repeat-rules.json");
    let current_repeat_rules = current_dir.join("repeat-rules.json");
    if fs::metadata(&legacy_repeat_rules).await.is_ok() {
        let _ = fs::copy(&legacy_repeat_rules, &current_repeat_rules).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn load_calendar_reminders(app: AppHandle) -> ResultPayload<Vec<CalendarReminderRecord>> {
    let trace = new_trace_id();
    let path = match reminders_store_path(&app) {
        Ok(path) => path,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取日历提醒路径失败: {err}"),
                trace,
            )
        }
    };

    if let Some(parent) = path.parent() {
        if let Err(err) = migrate_legacy_calendar_data(&app, parent).await {
            return err_payload(
                ErrorCode::IoError,
                format!("迁移日历提醒数据失败: {err}"),
                trace,
            );
        }
    }

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
    let path = match reminders_store_path(&app) {
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
    let path = match repeat_rules_store_path(&app) {
        Ok(path) => path,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取重复提醒路径失败: {err}"),
                trace,
            )
        }
    };

    if let Some(parent) = path.parent() {
        if let Err(err) = migrate_legacy_calendar_data(&app, parent).await {
            return err_payload(
                ErrorCode::IoError,
                format!("迁移重复提醒数据失败: {err}"),
                trace,
            );
        }
    }

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
    let path = match repeat_rules_store_path(&app) {
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
