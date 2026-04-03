use crate::fs_types::RecentFile;
use crate::locale::{resolve_menu_locale, MenuLocale};
use crate::platform::open_markdown_handbook;
use crate::state_store::read_recent_store;
use arboard::Clipboard;
use once_cell::sync::Lazy;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter};

const RECENT_PAGE_SIZE: usize = 20;
const RECENT_MENU_PREFIX: &str = "recent_item_";

static RECENT_MENU_MAP: Lazy<Mutex<HashMap<String, RecentMenuPayload>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static RECENT_PAGE: Lazy<Mutex<u32>> = Lazy::new(|| Mutex::new(0));

#[derive(Clone, Debug, Serialize)]
pub struct RecentMenuPayload {
    pub path: String,
    pub is_folder: bool,
}

fn abbreviate_path_for_menu(path: &str) -> String {
    let max_chars = 64usize;
    let count = path.chars().count();
    if count <= max_chars {
        return path.to_string();
    }

    let head_len = 28usize;
    let tail_len = 28usize;
    let head: String = path.chars().take(head_len).collect();
    let tail_vec: Vec<char> = path.chars().collect();
    let tail: String = tail_vec[tail_vec.len().saturating_sub(tail_len)..]
        .iter()
        .collect();
    format!("{head}…{tail}")
}

fn format_recent_menu_label(item: &RecentFile) -> String {
    let icon = if item.is_folder { "📁 " } else { "📄 " };
    format!("{}{}", icon, abbreviate_path_for_menu(&item.path))
}

#[derive(Clone, Copy)]
struct MenuTexts {
    about_haomd: &'static str,
    settings: &'static str,
    quit: &'static str,
    open_recent: &'static str,
    clear_recent: &'static str,
    more: &'static str,
    export: &'static str,
    file: &'static str,
    new_file: &'static str,
    open: &'static str,
    open_folder: &'static str,
    save: &'static str,
    save_as: &'static str,
    close_file: &'static str,
    edit: &'static str,
    paste: &'static str,
    find: &'static str,
    replace: &'static str,
    toggle_comment: &'static str,
    format_document: &'static str,
    heading: &'static str,
    paragraph: &'static str,
    heading_1: &'static str,
    heading_2: &'static str,
    heading_3: &'static str,
    heading_4: &'static str,
    heading_5: &'static str,
    heading_6: &'static str,
    format: &'static str,
    emphasis: &'static str,
    strikethrough: &'static str,
    table: &'static str,
    code_block: &'static str,
    math_symbols: &'static str,
    math_greek: &'static str,
    math_discrete: &'static str,
    math_calculus: &'static str,
    math_linear_algebra: &'static str,
    math_relations: &'static str,
    math_arrows: &'static str,
    math_structures: &'static str,
    math_annotation: &'static str,
    layout: &'static str,
    preview_left: &'static str,
    preview_right: &'static str,
    editor_only: &'static str,
    preview_only: &'static str,
    dock_ai_chat: &'static str,
    floating: &'static str,
    dock_left: &'static str,
    dock_right: &'static str,
    view: &'static str,
    toggle_editor: &'static str,
    toggle_preview_only: &'static str,
    toggle_wysiwyg: &'static str,
    toggle_sidebar: &'static str,
    toggle_status_bar: &'static str,
    zoom_in: &'static str,
    zoom_out: &'static str,
    reset_zoom: &'static str,
    go_to_line: &'static str,
    next_tab: &'static str,
    previous_tab: &'static str,
    global_memory: &'static str,
    user_persona: &'static str,
    manage_global_memory: &'static str,
    session: &'static str,
    history: &'static str,
    compress: &'static str,
    clear: &'static str,
    tools: &'static str,
    agent_settings: &'static str,
    ai: &'static str,
    provider_settings: &'static str,
    prompt_settings: &'static str,
    open_ai_chat: &'static str,
    ask_ai_about_file: &'static str,
    ask_ai_about_selection: &'static str,
    help: &'static str,
    markdown_handbook: &'static str,
    release_notes: &'static str,
    report_issue: &'static str,
    about: &'static str,
    html: &'static str,
    print: &'static str,
    word_docx: &'static str,
}

fn menu_texts(locale: MenuLocale) -> MenuTexts {
    match locale {
        MenuLocale::ZhCn => MenuTexts {
            about_haomd: "关于 HaoMD",
            settings: "设置...",
            quit: "退出",
            open_recent: "打开最近文件",
            clear_recent: "清空最近记录",
            more: "更多...",
            export: "导出",
            file: "文件",
            new_file: "新建",
            open: "打开",
            open_folder: "打开文件夹",
            save: "保存",
            save_as: "另存为",
            close_file: "关闭文件",
            edit: "编辑",
            paste: "粘贴",
            find: "查找",
            replace: "替换",
            toggle_comment: "切换注释",
            format_document: "格式化文档",
            heading: "标题",
            paragraph: "段落",
            heading_1: "一级标题",
            heading_2: "二级标题",
            heading_3: "三级标题",
            heading_4: "四级标题",
            heading_5: "五级标题",
            heading_6: "六级标题",
            format: "格式",
            emphasis: "强调",
            strikethrough: "删除线",
            table: "表格",
            code_block: "代码块",
            math_symbols: "数学符号",
            math_greek: "希腊字母",
            math_discrete: "离散数学",
            math_calculus: "高等数学",
            math_linear_algebra: "线性代数",
            math_relations: "关系运算",
            math_arrows: "箭头",
            math_structures: "常用结构",
            math_annotation: "标注",
            layout: "布局",
            preview_left: "预览在左",
            preview_right: "预览在右",
            editor_only: "仅编辑器",
            preview_only: "仅预览",
            dock_ai_chat: "停靠 AI 对话",
            floating: "浮动",
            dock_left: "停靠左侧",
            dock_right: "停靠右侧",
            view: "视图",
            toggle_editor: "切换编辑器 ",
            toggle_preview_only: "切换仅预览",
            toggle_wysiwyg: "所见即所得模式",
            toggle_sidebar: "切换侧边栏",
            toggle_status_bar: "切换状态栏",
            zoom_in: "放大",
            zoom_out: "缩小",
            reset_zoom: "重置缩放",
            go_to_line: "跳转到行",
            next_tab: "下一个标签",
            previous_tab: "上一个标签",
            global_memory: "全局记忆",
            user_persona: "用户画像",
            manage_global_memory: "管理全局记忆",
            session: "会话",
            history: "历史记录",
            compress: "压缩",
            clear: "清空",
            tools: "工具",
            agent_settings: "Agent 设置",
            ai: "AI",
            provider_settings: "模型服务设置",
            prompt_settings: "提示词设置",
            open_ai_chat: "打开 AI 对话",
            ask_ai_about_file: "向 AI 询问文件",
            ask_ai_about_selection: "向 AI 询问选中内容",
            help: "帮助",
            markdown_handbook: "Markdown 手册",
            release_notes: "版本说明",
            report_issue: "报告问题",
            about: "关于",
            html: "HTML",
            print: "打印",
            word_docx: "Word (.docx)",
        },
        MenuLocale::EnUs => MenuTexts {
            about_haomd: "About HaoMD",
            settings: "Settings...",
            quit: "Quit",
            open_recent: "Open Recent",
            clear_recent: "Clear Recent",
            more: "More...",
            export: "Export",
            file: "File",
            new_file: "New",
            open: "Open",
            open_folder: "Open Folder",
            save: "Save",
            save_as: "Save As",
            close_file: "Close File",
            edit: "Edit",
            paste: "Paste",
            find: "Find",
            replace: "Replace",
            toggle_comment: "Toggle Comment",
            format_document: "Format Document",
            heading: "Heading",
            paragraph: "Paragraph",
            heading_1: "Heading 1",
            heading_2: "Heading 2",
            heading_3: "Heading 3",
            heading_4: "Heading 4",
            heading_5: "Heading 5",
            heading_6: "Heading 6",
            format: "Format",
            emphasis: "Emphasis",
            strikethrough: "Strikethrough",
            table: "Table",
            code_block: "Code Block",
            math_symbols: "Math Symbols",
            math_greek: "Greek Letters",
            math_discrete: "Discrete Math",
            math_calculus: "Calculus",
            math_linear_algebra: "Linear Algebra",
            math_relations: "Relations",
            math_arrows: "Arrows",
            math_structures: "Structures",
            math_annotation: "Annotation",
            layout: "Layout",
            preview_left: "Preview Left",
            preview_right: "Preview Right",
            editor_only: "Editor Only",
            preview_only: "Preview Only",
            dock_ai_chat: "Dock AI Chat",
            floating: "Floating",
            dock_left: "Dock Left",
            dock_right: "Dock Right",
            view: "View",
            toggle_editor: "Toggle Editor",
            toggle_preview_only: "Toggle Preview Only",
            toggle_wysiwyg: "WYSIWYG Mode",
            toggle_sidebar: "Toggle Sidebar",
            toggle_status_bar: "Toggle Status Bar",
            zoom_in: "Zoom In",
            zoom_out: "Zoom Out",
            reset_zoom: "Reset Zoom",
            go_to_line: "Go to Line",
            next_tab: "Next Tab",
            previous_tab: "Previous Tab",
            global_memory: "Global Memory",
            user_persona: "User Persona",
            manage_global_memory: "Manage Global Memory",
            session: "Session",
            history: "History",
            compress: "Compress",
            clear: "Clear",
            tools: "Tools",
            agent_settings: "Agent Settings",
            ai: "AI",
            provider_settings: "Provider Settings",
            prompt_settings: "Prompt Settings",
            open_ai_chat: "Open AI Chat",
            ask_ai_about_file: "Ask AI About File",
            ask_ai_about_selection: "Ask AI About Selection",
            help: "Help",
            markdown_handbook: "Markdown Handbook",
            release_notes: "Release Notes",
            report_issue: "Report Issue",
            about: "About",
            html: "HTML",
            print: "Print",
            word_docx: "Word (.docx)",
        },
    }
}

pub fn is_recent_menu_action(action: &str) -> bool {
    action.starts_with(RECENT_MENU_PREFIX)
}

pub fn recent_menu_payload(action: &str) -> Option<RecentMenuPayload> {
    let map = RECENT_MENU_MAP.lock().unwrap();
    map.get(action).cloned()
}

pub fn handle_menu_action(app: &AppHandle, action: &str) -> bool {
    if action == "help_docs" {
        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            open_markdown_handbook(&app_handle);
        });
        return true;
    }

    if is_recent_menu_action(action) {
        if let Some(payload) = recent_menu_payload(action) {
            let _ = app.emit("menu://open_recent_file", payload);
        }
        return true;
    }

    if action == "open_recent_dialog" {
        let _ = app.emit("menu://action", "open_recent_dialog".to_string());
        return true;
    }

    if action == "paste" {
        log::info!("[tauri] menu paste triggered");
        match Clipboard::new() {
            Ok(mut cb) => match cb.get_text() {
                Ok(text) if !text.is_empty() => {
                    log::info!("[tauri] paste: clipboard has text, len={}", text.len());
                    let _ = app.emit("native://paste", text);
                }
                _ => {
                    log::info!("[tauri] paste: no text, check image");
                    match cb.get_image() {
                        Ok(img) => {
                            log::info!(
                                "[tauri] paste: clipboard image detected, size={}x{}",
                                img.width,
                                img.height
                            );
                            let _ = app.emit("native://paste_image", "");
                        }
                        Err(err) => {
                            log::error!(
                                "[tauri] paste: clipboard has no usable text or image: {}",
                                err
                            );
                            let _ =
                                app.emit("native://paste_error", format!("读取剪贴板失败: {err}"));
                        }
                    }
                }
            },
            Err(err) => {
                log::error!("[tauri] paste: Clipboard::new() failed: {}", err);
                let _ = app.emit("native://paste_error", format!("读取剪贴板失败: {err}"));
            }
        }
        return true;
    }

    false
}

pub async fn build_app_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let texts = menu_texts(resolve_menu_locale(app).await);
    let mut recent = read_recent_store(app).await.unwrap_or_default();
    recent.sort_by(|a, b| b.last_opened_at.cmp(&a.last_opened_at));

    let total = recent.len();
    let page_size = RECENT_PAGE_SIZE as u32;
    let max_page = if total == 0 {
        0
    } else {
        ((total.saturating_sub(1)) as u32) / page_size
    };

    let current_page = {
        let mut guard = RECENT_PAGE.lock().unwrap();
        if *guard > max_page {
            *guard = max_page;
        }
        *guard
    };

    let start = (current_page * page_size) as usize;
    let end = ((current_page + 1) * page_size) as usize;

    let slice = if start >= total {
        &recent[0..0]
    } else {
        &recent[start..std::cmp::min(end, total)]
    };

    let haomd_menu = SubmenuBuilder::new(app, "HaoMD")
        .item(
            &MenuItemBuilder::new(texts.about_haomd)
                .id("haomd_about")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::new(texts.settings)
                .id("haomd_settings")
                .accelerator("CmdOrCtrl+,")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::new(texts.quit)
                .id("quit")
                .accelerator("CmdOrCtrl+Q")
                .build(app)?,
        )
        .build()?;

    let mut open_recent_builder = SubmenuBuilder::new(app, texts.open_recent);
    {
        let mut map = RECENT_MENU_MAP.lock().unwrap();
        map.clear();

        for (idx, item) in slice.iter().enumerate() {
            let id = format!("{RECENT_MENU_PREFIX}{idx}");
            map.insert(
                id.clone(),
                RecentMenuPayload {
                    path: item.path.clone(),
                    is_folder: item.is_folder,
                },
            );

            let label = format_recent_menu_label(item);
            open_recent_builder =
                open_recent_builder.item(&MenuItemBuilder::new(&label).id(&id).build(app)?);
        }
    }

    if !slice.is_empty() {
        open_recent_builder = open_recent_builder.separator();
    }

    open_recent_builder = open_recent_builder.item(
        &MenuItemBuilder::new(texts.clear_recent)
            .id("clear_recent")
            .build(app)?,
    );
    open_recent_builder = open_recent_builder.item(
        &MenuItemBuilder::new(texts.more)
            .id("open_recent_dialog")
            .build(app)?,
    );
    let open_recent_menu = open_recent_builder.build()?;

    let export_menu = SubmenuBuilder::new(app, texts.export)
        .item(
            &MenuItemBuilder::new(texts.html)
                .id("export_html")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.word_docx)
                .id("export_word")
                .build(app)?,
        )
        .build()?;

    let file_menu = SubmenuBuilder::new(app, texts.file)
        .item(
            &MenuItemBuilder::new(texts.new_file)
                .id("new_file")
                .accelerator("CmdOrCtrl+n")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::new(texts.open)
                .id("open_file")
                .accelerator("CmdOrCtrl+o")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.open_folder)
                .id("open_folder")
                .accelerator("CmdOrCtrl+Shift+o")
                .build(app)?,
        )
        .item(&open_recent_menu)
        .separator()
        .item(
            &MenuItemBuilder::new(texts.save)
                .id("save")
                .accelerator("CmdOrCtrl+s")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.save_as)
                .id("save_as")
                .accelerator("CmdOrCtrl+Shift+s")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.print)
                .id("export_pdf")
                .accelerator("CmdOrCtrl+p")
                .build(app)?,
        )
        .separator()
        .item(&export_menu)
        .separator()
        .item(
            &MenuItemBuilder::new(texts.close_file)
                .id("close_file")
                .accelerator("CmdOrCtrl+w")
                .build(app)?,
        )
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, texts.edit)
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(
            &MenuItemBuilder::new(texts.paste)
                .id("paste")
                .accelerator("CmdOrCtrl+v")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::new(texts.find)
                .id("find")
                .accelerator("CmdOrCtrl+f")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.replace)
                .id("replace")
                .build(app)?,
        )
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .item(
            &MenuItemBuilder::new(texts.toggle_comment)
                .id("toggle_comment")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.format_document)
                .id("format_document")
                .build(app)?,
        )
        .build()?;

    let heading_menu = SubmenuBuilder::new(app, texts.heading)
        .item(
            &MenuItemBuilder::new(texts.paragraph)
                .id("format_heading_paragraph")
                .accelerator("CmdOrCtrl+0")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.heading_1)
                .id("format_heading_1")
                .accelerator("CmdOrCtrl+1")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.heading_2)
                .id("format_heading_2")
                .accelerator("CmdOrCtrl+2")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.heading_3)
                .id("format_heading_3")
                .accelerator("CmdOrCtrl+3")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.heading_4)
                .id("format_heading_4")
                .accelerator("CmdOrCtrl+4")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.heading_5)
                .id("format_heading_5")
                .accelerator("CmdOrCtrl+5")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.heading_6)
                .id("format_heading_6")
                .accelerator("CmdOrCtrl+6")
                .build(app)?,
        )
        .build()?;

    let math_symbols_menu = SubmenuBuilder::new(app, texts.math_symbols)
        .item(
            &MenuItemBuilder::new(texts.math_greek)
                .id("format_math_cat_greek")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.math_discrete)
                .id("format_math_cat_discrete")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.math_calculus)
                .id("format_math_cat_calculus")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.math_linear_algebra)
                .id("format_math_cat_linear_algebra")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.math_relations)
                .id("format_math_cat_relations")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.math_arrows)
                .id("format_math_cat_arrows")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.math_structures)
                .id("format_math_cat_structures")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.math_annotation)
                .id("format_math_cat_annotation")
                .build(app)?,
        )
        .build()?;

    let format_menu = SubmenuBuilder::new(app, texts.format)
        .item(&heading_menu)
        .item(
            &MenuItemBuilder::new(texts.emphasis)
                .id("format_emphasize_selection")
                .accelerator("CmdOrCtrl+B")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.strikethrough)
                .id("format_strikethrough")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.table)
                .id("format_insert_table")
                .accelerator("CmdOrCtrl+T")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.code_block)
                .id("format_insert_code_block")
                .accelerator("CmdOrCtrl+Alt+C")
                .build(app)?,
        )
        .separator()
        .item(&math_symbols_menu)
        .build()?;

    let layout_menu = SubmenuBuilder::new(app, texts.layout)
        .item(
            &MenuItemBuilder::new(texts.preview_left)
                .id("layout_preview_left")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.preview_right)
                .id("layout_preview_right")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.editor_only)
                .id("layout_editor_only")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.preview_only)
                .id("layout_preview_only")
                .build(app)?,
        )
        .build()?;

    let dock_ai_chat_menu = SubmenuBuilder::new(app, texts.dock_ai_chat)
        .item(
            &MenuItemBuilder::new(texts.floating)
                .id("view_ai_chat_floating")
                .accelerator("CmdOrCtrl+Shift+F")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.dock_left)
                .id("view_ai_chat_dock_left")
                .accelerator("CmdOrCtrl+Shift+L")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.dock_right)
                .id("view_ai_chat_dock_right")
                .accelerator("CmdOrCtrl+Shift+R")
                .build(app)?,
        )
        .build()?;

    let view_menu = SubmenuBuilder::new(app, texts.view)
        .item(
            &MenuItemBuilder::new(texts.toggle_editor)
                .id("toggle_preview")
                .accelerator("CmdOrCtrl+P")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.toggle_preview_only)
                .id("toggle_preview_only")
                .accelerator("CmdOrCtrl+Shift+P")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.toggle_wysiwyg)
                .id("toggle_wysiwyg")
                .accelerator("CmdOrCtrl+Alt+W")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.toggle_sidebar)
                .id("toggle_sidebar")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.toggle_status_bar)
                .id("toggle_status_bar")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.zoom_in)
                .id("zoom_in")
                .accelerator("CmdOrCtrl+=")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.zoom_out)
                .id("zoom_out")
                .accelerator("CmdOrCtrl+-")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.reset_zoom)
                .id("zoom_reset")
                .accelerator("CmdOrCtrl+Shift+0")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.go_to_line)
                .id("go_line")
                .accelerator("CmdOrCtrl+L")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.next_tab)
                .id("next_tab")
                .accelerator("Ctrl+Tab")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.previous_tab)
                .id("prev_tab")
                .accelerator("Ctrl+Shift+Tab")
                .build(app)?,
        )
        .item(&dock_ai_chat_menu)
        .item(&layout_menu)
        .build()?;

    let global_memory_menu = SubmenuBuilder::new(app, texts.global_memory)
        .item(
            &MenuItemBuilder::new(texts.user_persona)
                .id("ai_session_globalMemory_userPersona")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.manage_global_memory)
                .id("ai_session_globalMemory_manage")
                .build(app)?,
        )
        .build()?;

    let ai_conversation_menu = SubmenuBuilder::new(app, texts.session)
        .item(
            &MenuItemBuilder::new(texts.history)
                .id("ai_conversation_history")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.compress)
                .id("ai_conversation_compress")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.clear)
                .id("ai_conversation_clear")
                .build(app)?,
        )
        .item(&global_memory_menu)
        .build()?;

    let tools_menu = SubmenuBuilder::new(app, texts.tools).build()?;

    let ai_menu = SubmenuBuilder::new(app, texts.ai)
        .item(
            &MenuItemBuilder::new(texts.provider_settings)
                .id("ai_settings")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.agent_settings)
                .id("agent_settings")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.prompt_settings)
                .id("ai_prompt_settings")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.open_ai_chat)
                .id("ai_chat")
                .accelerator("CmdOrCtrl+K")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.ask_ai_about_file)
                .id("ai_ask_file")
                .accelerator("CmdOrCtrl+D")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.ask_ai_about_selection)
                .id("ai_ask_selection")
                .accelerator("CmdOrCtrl+L")
                .build(app)?,
        )
        .item(&ai_conversation_menu)
        .build()?;

    let help_menu = SubmenuBuilder::new(app, texts.help)
        .item(
            &MenuItemBuilder::new(texts.markdown_handbook)
                .id("help_docs")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.release_notes)
                .id("help_release")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.report_issue)
                .id("help_issue")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new(texts.about)
                .id("help_about")
                .build(app)?,
        )
        .build()?;

    MenuBuilder::new(app)
        .item(&haomd_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&format_menu)
        .item(&view_menu)
        .item(&tools_menu)
        .item(&ai_menu)
        .item(&help_menu)
        .build()
}

pub async fn refresh_app_menu(app: &AppHandle) {
    if let Ok(menu) = build_app_menu(app).await {
        let _ = app.set_menu(menu);
    }
}
