use crate::editor_settings::{editor_settings_path, EditorSettingsCfg};
use tauri::AppHandle;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MenuLocale {
    ZhCn,
    EnUs,
}

pub fn detect_system_menu_locale() -> MenuLocale {
    let locale_value = ["LC_ALL", "LC_MESSAGES", "LANG"]
        .into_iter()
        .find_map(|key| std::env::var(key).ok())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if locale_value.starts_with("zh") {
        MenuLocale::ZhCn
    } else {
        MenuLocale::EnUs
    }
}

pub fn menu_locale_language_tag(locale: MenuLocale) -> &'static str {
    match locale {
        MenuLocale::ZhCn => "zh-CN",
        MenuLocale::EnUs => "en-US",
    }
}

pub async fn resolve_menu_locale(app: &AppHandle) -> MenuLocale {
    let path = match editor_settings_path(app) {
        Ok(path) => path,
        Err(_) => return detect_system_menu_locale(),
    };

    let bytes = match tokio::fs::read(path).await {
        Ok(bytes) => bytes,
        Err(_) => return detect_system_menu_locale(),
    };

    let cfg: EditorSettingsCfg = match serde_json::from_slice(&bytes) {
        Ok(cfg) => cfg,
        Err(_) => return detect_system_menu_locale(),
    };

    match cfg.language.as_deref() {
        Some("zh-CN") => MenuLocale::ZhCn,
        Some("en-US") => MenuLocale::EnUs,
        _ => detect_system_menu_locale(),
    }
}

#[tauri::command]
pub async fn get_system_language(app: AppHandle) -> Result<String, String> {
    Ok(menu_locale_language_tag(resolve_menu_locale(&app).await).to_string())
}
