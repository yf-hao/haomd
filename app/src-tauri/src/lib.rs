use std::io::Cursor;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

mod ai_config;
mod clipboard_io;
mod dialog_io;
mod doc_conversations;
mod editor_settings;
mod external_open;
mod file_io;
mod font_catalog;
mod fs_commands;
mod fs_types;
mod inkscape;
mod locale;
mod menu;
mod platform;
mod protocol;
mod state_store;
mod support;
mod word;
mod word_commands;

use ai_config::*;
use clipboard_io::*;
use dialog_io::*;
use doc_conversations::*;
use editor_settings::*;
use external_open::*;
use file_io::*;
use fs_commands::*;
use fs_types::{ErrorCode, FilePayload, ResultPayload, ServiceError, WriteResult};
use inkscape::*;
use locale::*;
use menu::*;
use platform::*;
use protocol::*;
use serde::{Deserialize, Serialize};
use state_store::*;
pub(crate) use support::*;
use word::*;
use word_commands::*;

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
            quit_app,
            // AI config and editor/document settings
            load_ai_settings,
            save_ai_settings,
            load_prompt_settings,
            save_prompt_settings,
            load_agent_settings,
            save_agent_settings,
            editor_settings::load_editor_settings,
            editor_settings::save_editor_settings,
            font_catalog::list_system_fonts,
            load_doc_conversations,
            save_doc_conversations,
            // Platform integration and export utilities
            open_terminal,
            open_in_file_explorer,
            open_word_templates_dir,
            list_word_templates,
            get_word_template_config,
            open_webview_browser,
            pick_editor_background_image,
            export_word_docx,
            fill_docx_template,
            get_system_language,
            is_inkscape_available,
            convert_svg_to_emf,
            convert_svg_to_plain_svg,
            save_clipboard_image_to_dir,
            read_clipboard_image_as_base64,
            take_pending_external_open_items,
            save_text_with_dialog,
            save_ai_sessions_json_with_dialog
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
        let menu = build_app_menu(&handle).await?;
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
