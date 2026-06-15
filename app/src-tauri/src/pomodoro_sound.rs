use crate::alarm_sound::{ensure_alarm_sound_available, import_alarm_sound, list_alarm_sound_files};
use crate::ResultPayload;
use serde::Serialize;
use std::path::PathBuf;
use tauri::AppHandle;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroAlarmSoundRecord {
    pub file_name: String,
    pub target_path: String,
}

pub async fn ensure_pomodoro_alarm_sound_available(
    app: &AppHandle,
    file_name: &str,
) -> std::io::Result<PathBuf> {
    ensure_alarm_sound_available(app, file_name).await
}

#[tauri::command]
pub async fn list_pomodoro_alarm_sound_files(app: AppHandle) -> ResultPayload<Vec<String>> {
    list_alarm_sound_files(app).await
}

#[tauri::command]
pub async fn import_pomodoro_alarm_sound(
    app: AppHandle,
    source_path: String,
) -> ResultPayload<PomodoroAlarmSoundRecord> {
    match import_alarm_sound(app, source_path).await {
        crate::fs_types::ResultPayload::Ok { data, trace_id } => {
            crate::fs_types::ResultPayload::Ok {
                data: PomodoroAlarmSoundRecord {
                    file_name: data.file_name,
                    target_path: data.target_path,
                },
                trace_id,
            }
        }
        crate::fs_types::ResultPayload::Err { error } => {
            crate::fs_types::ResultPayload::Err { error }
        }
    }
}
