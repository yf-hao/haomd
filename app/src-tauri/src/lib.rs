use std::io::Cursor;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

mod ai_config;
mod ai_sessions;
mod alarm_audio;
mod alarm_paths;
mod alarm_sound;
mod alarm_storage;
mod backup_io;
mod backup_scope;
mod backup_settings;
mod calendar_storage;
mod clipboard_io;
mod dialog_io;
mod doc_conversations;
mod editor_settings;
mod external_open;
mod file_io;
mod font_catalog;
mod fs_commands;
mod fs_types;
mod gemini_compat;
mod haomd_paths;
mod image_generation;
mod inkscape;
mod locale;
mod mcp_config;
mod mcp_manager;
mod menu;
mod music_audio;
mod music_paths;
mod music_playlist;
mod music_sound;
mod notes_config;
mod openai_compat;
mod pdf_export;
mod platform;
mod pomodoro_audio;
mod pomodoro_paths;
mod pomodoro_sound;
mod pomodoro_storage;
mod protocol;
mod search_commands;
mod search_db;
mod shared_audio;
mod skill_scripts;
mod skills;
mod state_store;
mod support;
mod word;
mod word_commands;
mod word_import;
mod workflows;
mod workspace_io;

use ai_config::*;
use ai_sessions::*;
use alarm_audio::*;
use alarm_sound::*;
use alarm_storage::*;
use backup_io::*;
use backup_scope::*;
use backup_settings::*;
use calendar_storage::*;
use clipboard_io::*;
use dialog_io::*;
use doc_conversations::*;
use editor_settings::*;
use external_open::*;
use file_io::*;
use fs_commands::*;
use fs_types::{ErrorCode, FilePayload, ResultPayload, ServiceError, WriteResult};
use gemini_compat::*;
use image_generation::*;
use inkscape::*;
use locale::*;
use mcp_config::*;
use mcp_manager::*;
use menu::*;
use music_audio::*;
use music_playlist::*;
use music_sound::*;
use notes_config::*;
use openai_compat::*;
use pdf_export::*;
use platform::*;
use pomodoro_audio::*;
use pomodoro_sound::*;
use pomodoro_storage::*;
use protocol::*;
use search_commands::*;
use serde::{Deserialize, Serialize};
use skill_scripts::*;
use skills::*;
use state_store::*;
pub(crate) use support::*;
use word::*;
use word_commands::*;
use word_import::*;
use workflows::*;
use workspace_io::*;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;
use zip::write::SimpleFileOptions;
use zip::CompressionMethod;
use zip::ZipWriter;

const MAX_RECENT_ITEMS: usize = 100; // 最近文件最大条数

#[cfg(test)]
mod lib_tests;

macro_rules! app_invoke_handler {
    () => {
        tauri::generate_handler![
            // File IO and app-local state
            read_file,
            read_binary_file,
            export_pdf_with_annotations,
            write_file,
            write_file_no_recent,
            list_recent,
            log_recent_file,
            clear_recent,
            delete_recent_entry,
            list_pdf_recent,
            log_pdf_recent_file,
            delete_pdf_recent_entry,
            load_pdf_folders,
            save_pdf_folders,
            update_pdf_recent_folder,
            load_file_virtual_folders,
            save_file_virtual_folders,
            list_file_virtual_assignments,
            update_file_virtual_folder_for_path,
            load_sidebar_state,
            save_sidebar_state,
            list_folder,
            create_folder,
            set_title,
            delete_fs_entry,
            rename_fs_entry,
            resolve_workspace_directory,
            create_workspace_directory,
            write_workspace_file,
            search_workspace_contents,
            rebuild_search_index,
            quit_app,
            // AI config and editor/document settings
            load_ai_settings,
            save_ai_settings,
            load_prompt_settings,
            save_prompt_settings,
            load_agent_settings,
            save_agent_settings,
            list_skills,
            read_skill,
            save_skill,
            delete_skill,
            list_workflows,
            read_workflow,
            save_workflow,
            delete_workflow,
            run_skill_script,
            run_modelscope_image_generation,
            load_backup_settings,
            save_backup_settings,
            load_backup_scope_settings,
            save_backup_scope_settings,
            load_notes_config,
            save_notes_config,
            load_calendar_reminders,
            save_calendar_reminders,
            load_calendar_repeat_rules,
            save_calendar_repeat_rules,
            load_alarm_rules,
            save_alarm_rules,
            list_alarm_sound_files,
            play_alarm_sound,
            stop_alarm_sound,
            import_alarm_sound,
            play_music_track,
            pause_music_track,
            pause_music_track_by_alarm,
            resume_music_track,
            seek_music_track,
            get_music_track_state,
            get_music_track_duration,
            set_music_track_volume,
            stop_music_track,
            load_pomodoro_state,
            save_pomodoro_state,
            list_pomodoro_alarm_sound_files,
            play_pomodoro_alarm,
            stop_pomodoro_alarm,
            import_pomodoro_alarm_sound,
            list_music_sound_files,
            import_music_sound,
            delete_music_sound,
            move_music_sound,
            load_music_playlist_store,
            save_music_playlist_store,
            editor_settings::load_editor_settings,
            editor_settings::save_editor_settings,
            font_catalog::list_system_fonts,
            load_doc_conversations,
            save_doc_conversations,
            load_ai_sessions_index,
            load_ai_session,
            save_ai_session,
            delete_ai_session,
            load_ai_naming_conv,
            save_ai_naming_conv,
            gemini_generate_content,
            start_openai_compat_chat_stream,
            cancel_openai_compat_chat_stream,
            // Platform integration and export utilities
            open_terminal,
            open_in_file_explorer,
            open_word_templates_dir,
            list_word_templates,
            get_word_template_config,
            get_word_template_notes,
            get_word_template_authoring_metadata,
            save_word_template_artifacts,
            open_webview_browser,
            pick_editor_background_image,
            save_remote_image_with_dialog,
            export_word_docx,
            export_word_docx_with_template,
            fill_docx_template,
            import_word_docx_to_temp_markdown,
            finalize_imported_word_markdown,
            cleanup_imported_word_temp,
            cleanup_stale_imported_word_temps,
            get_system_language,
            export_settings_backup,
            test_webdav_connection,
            export_settings_backup_to_webdav,
            start_export_settings_backup_to_webdav,
            import_settings_backup,
            import_settings_backup_from_webdav,
            start_import_settings_backup_from_webdav,
            is_inkscape_available,
            convert_svg_to_emf,
            convert_svg_to_plain_svg,
            save_clipboard_image_to_dir,
            read_clipboard_image_as_base64,
            take_pending_external_open_items,
            save_text_with_dialog,
            save_ai_sessions_json_with_dialog,
            // MCP config and server management
            load_mcp_settings,
            save_mcp_settings,
            mcp_start_server,
            mcp_test_server,
            mcp_stop_server,
            mcp_list_tools,
            mcp_call_tool,
            mcp_list_running_servers
        ]
    };
}

fn setup_app(app: &mut tauri::App<tauri::Wry>) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle();
    let log_plugin = tauri_plugin_log::Builder::default()
        .level(log::LevelFilter::Info)
        .build();
    handle.plugin(log_plugin)?;
    handle.plugin(tauri_plugin_dialog::init())?;
    handle.plugin(tauri_plugin_opener::init())?;

    tauri::async_runtime::block_on(async {
        let menu = build_app_menu(handle).await?;
        handle.set_menu(menu)?;
        Ok::<(), tauri::Error>(())
    })?;

    app.on_menu_event(|app, event| {
        let action = event.id().as_ref();
        if handle_menu_action(app, action) {
            return;
        }

        let _ = app.emit("menu://action", action.to_string());
    });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(McpProcessManager::new())
        .register_uri_scheme_protocol("haomd", handle_haomd_protocol)
        .setup(setup_app)
        .invoke_handler(app_invoke_handler!())
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    queue_external_open_items_from_cli_args();

    app.run(|app_handle, event| {
        handle_app_run_event(app_handle, &event);
    });
}
