#![allow(
    clippy::derivable_impls,
    clippy::double_ended_iterator_last,
    clippy::wildcard_in_or_patterns,
    clippy::if_same_then_else
)]

use crate::alarm_paths::alarm_root_dir;
use crate::backup_scope::load_backup_scope_settings_cfg;
use crate::backup_settings::load_backup_settings_data;
use crate::haomd_paths::{haomd_config_root_dir, haomd_data_root_dir};
use crate::music_paths::music_root_dir;
use crate::notes_config::load_notes_config_data;
use notify::event::{CreateKind, EventKind, ModifyKind, RemoveKind, RenameMode};
use notify::{recommended_watcher, Event, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::AppHandle;

const WEB_DAV_CHANGE_JOURNAL_VERSION: u32 = 1;
const WEB_DAV_EVENT_BATCH_DELAY_MS: u64 = 120;
const WEB_DAV_EVENT_NOISE_THRESHOLD: usize = 256;
const IGNORED_FILE_NAMES: &[&str] = &[
    ".DS_Store",
    "Thumbs.db",
    ".haomd-sync-index.json",
    ".haomd-backup-manifest.json",
    "webdav-change-journal.json",
    "webdav-local-index-cache.json",
    "search_index.sqlite3",
];
const IGNORED_CONFIG_FILE_NAMES: &[&str] = &[
    "recent.json",
    "pdf_recent.json",
    "sidebar_state.json",
    "pdf_folders.json",
    "file_virtual_folders.json",
    "file_virtual_assignments.json",
];

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum WebDavChangeScope {
    Config,
    Music,
    Alarm,
    Notes,
    Documents,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct WebDavChangeJournal {
    version: u32,
    #[serde(default)]
    config: WebDavChangeJournalSection,
    #[serde(default)]
    music: WebDavChangeJournalSection,
    #[serde(default)]
    alarm: WebDavChangeJournalSection,
    #[serde(default)]
    notes: WebDavChangeJournalSection,
    #[serde(default)]
    documents: WebDavChangeJournalSection,
    #[serde(default)]
    seen_paths: HashSet<String>,
    #[serde(default)]
    dirty_paths: HashSet<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct WebDavChangeJournalSection {
    seen_paths: HashSet<String>,
    dirty_paths: HashSet<String>,
}

#[derive(Debug, Default)]
struct WebDavChangeTrackerState {
    journal: WebDavChangeJournal,
    watcher: Option<notify::RecommendedWatcher>,
    watched_roots: HashSet<String>,
    watched_scopes: Vec<WebDavWatchedScopeRoot>,
    mutation_suppression_depth: usize,
    pending_changes: PendingWebDavChanges,
    pending_event_revision: u64,
    pending_event_task: Option<tauri::async_runtime::JoinHandle<()>>,
    flush_revision: u64,
    flush_task: Option<tauri::async_runtime::JoinHandle<()>>,
}

#[derive(Debug, Clone)]
struct WebDavWatchedScopeRoot {
    root: String,
    scope: WebDavChangeScope,
}

#[derive(Debug, Clone)]
struct PendingWebDavChanges {
    file_paths_by_scope: HashMap<WebDavChangeScope, HashSet<String>>,
    subtree_roots_by_scope: HashMap<WebDavChangeScope, HashSet<String>>,
    full_rescan_scopes: HashSet<WebDavChangeScope>,
}

impl Default for PendingWebDavChanges {
    fn default() -> Self {
        Self {
            file_paths_by_scope: HashMap::new(),
            subtree_roots_by_scope: HashMap::new(),
            full_rescan_scopes: HashSet::new(),
        }
    }
}

#[derive(Clone, Default)]
pub struct WebDavChangeTracker {
    inner: Arc<Mutex<WebDavChangeTrackerState>>,
}

fn normalize_path_key(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn is_same_or_descendant(path: &str, parent: &str) -> bool {
    path == parent
        || path
            .strip_prefix(parent)
            .is_some_and(|rest| rest.starts_with('/'))
}

fn insert_compressed_path(paths: &mut HashSet<String>, path: String) -> bool {
    if paths
        .iter()
        .any(|existing| is_same_or_descendant(&path, existing))
    {
        return false;
    }

    paths.retain(|existing| !is_same_or_descendant(existing, &path));
    paths.insert(path)
}

fn compact_paths(paths: HashSet<String>) -> HashSet<String> {
    let mut compacted = HashSet::new();
    let mut sorted = paths.into_iter().collect::<Vec<_>>();
    sorted.sort_by_key(|path| path.matches('/').count());
    for path in sorted {
        insert_compressed_path(&mut compacted, path);
    }
    compacted
}

fn should_prune_journal_path(path: &str) -> bool {
    let path = Path::new(path);
    should_ignore_path(path)
        || path == Path::new("backup")
        || path.starts_with("backup")
        || path
            .components()
            .any(|component| component.as_os_str().to_str() == Some("backup"))
}

fn compact_journal(mut journal: WebDavChangeJournal) -> WebDavChangeJournal {
    if !journal.seen_paths.is_empty() || !journal.dirty_paths.is_empty() {
        journal.config.seen_paths.extend(
            journal
                .seen_paths
                .drain()
                .filter(|path| !should_prune_journal_path(path)),
        );
        journal.config.dirty_paths.extend(
            journal
                .dirty_paths
                .drain()
                .filter(|path| !should_prune_journal_path(path)),
        );
    }
    for section in [
        &mut journal.config,
        &mut journal.music,
        &mut journal.alarm,
        &mut journal.notes,
        &mut journal.documents,
    ] {
        section
            .seen_paths
            .retain(|path| !should_prune_journal_path(path));
        section.seen_paths = compact_paths(std::mem::take(&mut section.seen_paths));
        section
            .dirty_paths
            .retain(|path| !should_prune_journal_path(path));
        section.dirty_paths = compact_paths(std::mem::take(&mut section.dirty_paths));
    }
    journal
}

fn section_mut(
    journal: &mut WebDavChangeJournal,
    scope: WebDavChangeScope,
) -> &mut WebDavChangeJournalSection {
    match scope {
        WebDavChangeScope::Config => &mut journal.config,
        WebDavChangeScope::Music => &mut journal.music,
        WebDavChangeScope::Alarm => &mut journal.alarm,
        WebDavChangeScope::Notes => &mut journal.notes,
        WebDavChangeScope::Documents => &mut journal.documents,
    }
}

fn section_ref(
    journal: &WebDavChangeJournal,
    scope: WebDavChangeScope,
) -> &WebDavChangeJournalSection {
    match scope {
        WebDavChangeScope::Config => &journal.config,
        WebDavChangeScope::Music => &journal.music,
        WebDavChangeScope::Alarm => &journal.alarm,
        WebDavChangeScope::Notes => &journal.notes,
        WebDavChangeScope::Documents => &journal.documents,
    }
}

fn prune_journal_paths_for_roots(
    journal: &mut WebDavChangeJournal,
    watched_scopes: &[WebDavWatchedScopeRoot],
    prune_dirty_paths: bool,
) -> bool {
    let before = journal.config.seen_paths.len()
        + journal.config.dirty_paths.len()
        + journal.music.seen_paths.len()
        + journal.music.dirty_paths.len()
        + journal.alarm.seen_paths.len()
        + journal.alarm.dirty_paths.len()
        + journal.notes.seen_paths.len()
        + journal.notes.dirty_paths.len()
        + journal.documents.seen_paths.len()
        + journal.documents.dirty_paths.len();

    for scope in [
        WebDavChangeScope::Config,
        WebDavChangeScope::Music,
        WebDavChangeScope::Alarm,
        WebDavChangeScope::Notes,
        WebDavChangeScope::Documents,
    ] {
        let roots = watched_scopes
            .iter()
            .filter_map(|item| (item.scope == scope).then_some(&item.root))
            .collect::<Vec<_>>();
        let section = section_mut(journal, scope);
        section
            .seen_paths
            .retain(|path| roots.iter().any(|root| is_same_or_descendant(path, root)));
        section.seen_paths = compact_paths(std::mem::take(&mut section.seen_paths));
        if prune_dirty_paths {
            section
                .dirty_paths
                .retain(|path| roots.iter().any(|root| is_same_or_descendant(path, root)));
            section.dirty_paths = compact_paths(std::mem::take(&mut section.dirty_paths));
        }
    }

    let after = journal.config.seen_paths.len()
        + journal.config.dirty_paths.len()
        + journal.music.seen_paths.len()
        + journal.music.dirty_paths.len()
        + journal.alarm.seen_paths.len()
        + journal.alarm.dirty_paths.len()
        + journal.notes.seen_paths.len()
        + journal.notes.dirty_paths.len()
        + journal.documents.seen_paths.len()
        + journal.documents.dirty_paths.len();
    before != after
}

fn should_ignore_path(path: &Path) -> bool {
    let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    file_name.starts_with("._")
        || file_name.ends_with('~')
        || file_name.ends_with(".tmp")
        || file_name.contains(".tmp-")
        || file_name.ends_with(".swp")
        || file_name.ends_with(".part")
        || IGNORED_FILE_NAMES.contains(&file_name)
        || path.components().any(|component| {
            component.as_os_str().to_str().is_some_and(|value| {
                value == ".haomd-backup-extra" || value == ".git" || value == "node_modules"
            })
        })
}

fn should_ignore_config_relative(relative: &str) -> bool {
    let relative = relative.trim_matches('/');
    if relative.is_empty() {
        return false;
    }
    relative == ".haomd-backup-manifest.json"
        || relative.starts_with(".haomd-backup-extra/")
        || relative == ".haomd-backup-extra"
        || relative.starts_with("backup/")
        || relative == "backup"
        || relative.starts_with("music/")
        || relative == "music"
        || relative.starts_with("alarm/sounds/")
        || relative == "alarm/sounds"
        || relative
            .split('/')
            .last()
            .is_some_and(|name| IGNORED_CONFIG_FILE_NAMES.contains(&name))
}

fn collect_recorded_files_under(
    journal: &WebDavChangeJournal,
    scope: WebDavChangeScope,
    subtree_root: &str,
    files: &mut Vec<PathBuf>,
) {
    let section = section_ref(journal, scope);
    for path in section.seen_paths.iter().chain(section.dirty_paths.iter()) {
        if is_same_or_descendant(path, subtree_root) {
            files.push(PathBuf::from(path));
        }
    }
}

fn scope_roots_for_scopes(
    watched_scopes: &[WebDavWatchedScopeRoot],
    scope: WebDavChangeScope,
) -> Vec<String> {
    watched_scopes
        .iter()
        .filter_map(|item| (item.scope == scope).then_some(item.root.clone()))
        .collect()
}

fn scope_for_path(
    normalized_path: &str,
    watched_scopes: &[WebDavWatchedScopeRoot],
) -> Option<WebDavWatchedScopeRoot> {
    watched_scopes
        .iter()
        .filter(|item| is_same_or_descendant(normalized_path, &item.root))
        .max_by_key(|item| item.root.len())
        .cloned()
}

fn change_journal_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    Ok(haomd_data_root_dir(app)?
        .join("backup")
        .join("webdav-change-journal.json"))
}

async fn load_change_journal(app: &AppHandle) -> Result<WebDavChangeJournal, String> {
    let path =
        change_journal_path(app).map_err(|err| format!("获取 WebDAV 变更日志路径失败: {err}"))?;
    match tokio::fs::read_to_string(&path).await {
        Ok(content) => match serde_json::from_str::<WebDavChangeJournal>(&content) {
            Ok(mut journal) => {
                if journal.version == 0 {
                    journal.version = WEB_DAV_CHANGE_JOURNAL_VERSION;
                }
                Ok(compact_journal(journal))
            }
            Err(err) => {
                eprintln!("[backup] ignore invalid WebDAV change journal: {err}");
                Ok(WebDavChangeJournal {
                    version: WEB_DAV_CHANGE_JOURNAL_VERSION,
                    ..WebDavChangeJournal::default()
                })
            }
        },
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(WebDavChangeJournal {
            version: WEB_DAV_CHANGE_JOURNAL_VERSION,
            ..WebDavChangeJournal::default()
        }),
        Err(err) => {
            eprintln!("[backup] ignore unreadable WebDAV change journal: {err}");
            Ok(WebDavChangeJournal {
                version: WEB_DAV_CHANGE_JOURNAL_VERSION,
                ..WebDavChangeJournal::default()
            })
        }
    }
}

async fn save_change_journal(app: &AppHandle, journal: &WebDavChangeJournal) -> Result<(), String> {
    let path =
        change_journal_path(app).map_err(|err| format!("获取 WebDAV 变更日志路径失败: {err}"))?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|err| format!("创建 WebDAV 变更日志目录失败: {err}"))?;
    }
    let mut next = journal.clone();
    next.version = WEB_DAV_CHANGE_JOURNAL_VERSION;
    let json = serde_json::to_string_pretty(&next)
        .map_err(|err| format!("序列化 WebDAV 变更日志失败: {err}"))?;
    let temp_path = path.with_file_name("webdav-change-journal.json.tmp");
    tokio::fs::write(&temp_path, json)
        .await
        .map_err(|err| format!("写入 WebDAV 变更日志失败: {err}"))?;
    if let Err(err) = tokio::fs::rename(&temp_path, &path).await {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return Err(format!("替换 WebDAV 变更日志失败: {err}"));
    }
    Ok(())
}

impl WebDavChangeTracker {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn begin_mutation_suppression(&self) {
        let mut state = self.inner.lock().expect("WebDAV change tracker poisoned");
        state.mutation_suppression_depth = state.mutation_suppression_depth.saturating_add(1);
        state.pending_event_revision = state.pending_event_revision.saturating_add(1);
        state.flush_revision = state.flush_revision.saturating_add(1);
        if let Some(task) = state.pending_event_task.take() {
            task.abort();
        }
        if let Some(task) = state.flush_task.take() {
            task.abort();
        }
        state.pending_changes = PendingWebDavChanges::default();
    }

    pub fn end_mutation_suppression(&self) {
        let mut state = self.inner.lock().expect("WebDAV change tracker poisoned");
        state.mutation_suppression_depth = state.mutation_suppression_depth.saturating_sub(1);
    }

    fn schedule_flush(&self, app: &AppHandle) {
        let tracker = self.clone();
        let app = app.clone();
        let revision = {
            let mut state = tracker
                .inner
                .lock()
                .expect("WebDAV change tracker poisoned");
            if state.mutation_suppression_depth > 0 {
                None
            } else {
                state.flush_revision = state.flush_revision.saturating_add(1);
                if let Some(task) = state.flush_task.take() {
                    task.abort();
                }
                Some(state.flush_revision)
            }
        };
        let Some(revision) = revision else {
            return;
        };

        let task = tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(600)).await;

            let journal = {
                let mut state = tracker
                    .inner
                    .lock()
                    .expect("WebDAV change tracker poisoned");
                if state.flush_revision != revision {
                    return;
                }
                state.flush_task = None;
                state.journal.clone()
            };

            if let Err(err) = save_change_journal(&app, &journal).await {
                eprintln!("[backup] ignore WebDAV change journal save failure: {err}");
            }
        });

        let mut state = self.inner.lock().expect("WebDAV change tracker poisoned");
        state.flush_task = Some(task);
    }

    pub async fn flush_now(&self, app: &AppHandle) -> Result<(), String> {
        let journal = {
            let mut state = self.inner.lock().expect("WebDAV change tracker poisoned");
            if let Some(task) = state.flush_task.take() {
                task.abort();
            }
            state.flush_revision = state.flush_revision.saturating_add(1);
            state.journal.clone()
        };
        save_change_journal(app, &journal).await
    }

    fn schedule_event_flush(&self, app: &AppHandle) {
        let tracker = self.clone();
        let app = app.clone();
        let revision = {
            let mut state = tracker
                .inner
                .lock()
                .expect("WebDAV change tracker poisoned");
            if state.mutation_suppression_depth > 0 {
                None
            } else {
                state.pending_event_revision = state.pending_event_revision.saturating_add(1);
                if let Some(task) = state.pending_event_task.take() {
                    task.abort();
                }
                Some(state.pending_event_revision)
            }
        };
        let Some(revision) = revision else {
            return;
        };

        let task = tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(
                WEB_DAV_EVENT_BATCH_DELAY_MS,
            ))
            .await;

            let changes = {
                let mut state = tracker
                    .inner
                    .lock()
                    .expect("WebDAV change tracker poisoned");
                if state.pending_event_revision != revision {
                    return;
                }
                state.pending_event_task = None;
                std::mem::take(&mut state.pending_changes)
            };

            tracker.apply_pending_changes(&app, changes);
        });

        let mut state = self.inner.lock().expect("WebDAV change tracker poisoned");
        state.pending_event_task = Some(task);
    }

    fn note_event(&self, app: &AppHandle, event: Event) {
        if matches!(event.kind, EventKind::Access(_)) {
            return;
        }

        let need_rescan = event.need_rescan();
        let event_kind = event.kind;
        let paths = event.paths;
        let watched_scopes = {
            let state = self.inner.lock().expect("WebDAV change tracker poisoned");
            state.watched_scopes.clone()
        };
        {
            let mut state = self.inner.lock().expect("WebDAV change tracker poisoned");
            if state.mutation_suppression_depth > 0 {
                return;
            }
            for path in paths {
                if should_ignore_path(&path) {
                    continue;
                }
                let normalized = normalize_path_key(&path);
                let Some(root) = scope_for_path(&normalized, &watched_scopes) else {
                    continue;
                };
                if root.scope == WebDavChangeScope::Config {
                    let relative = normalized
                        .strip_prefix(&root.root)
                        .unwrap_or(&normalized)
                        .trim_start_matches('/');
                    if should_ignore_config_relative(relative) {
                        continue;
                    }
                }

                let should_force_scope = need_rescan
                    || matches!(
                        event_kind,
                        EventKind::Any
                            | EventKind::Other
                            | EventKind::Create(CreateKind::Other)
                            | EventKind::Modify(ModifyKind::Other)
                            | EventKind::Remove(RemoveKind::Other)
                    );
                if should_force_scope {
                    state.pending_changes.full_rescan_scopes.insert(root.scope);
                    continue;
                }

                match event_kind {
                    EventKind::Create(CreateKind::File)
                    | EventKind::Remove(RemoveKind::File)
                    | EventKind::Modify(ModifyKind::Data(_)) => {
                        state
                            .pending_changes
                            .file_paths_by_scope
                            .entry(root.scope)
                            .or_default()
                            .insert(normalized);
                    }
                    EventKind::Remove(RemoveKind::Folder)
                    | EventKind::Modify(ModifyKind::Name(RenameMode::From))
                    | EventKind::Modify(ModifyKind::Name(RenameMode::Any)) => {
                        state
                            .pending_changes
                            .subtree_roots_by_scope
                            .entry(root.scope)
                            .or_default()
                            .insert(normalized);
                    }
                    EventKind::Modify(ModifyKind::Name(RenameMode::To))
                    | EventKind::Modify(ModifyKind::Name(RenameMode::Both)) => {
                        if matches!(
                            event_kind,
                            EventKind::Modify(ModifyKind::Name(RenameMode::Both))
                        ) {
                            state
                                .pending_changes
                                .file_paths_by_scope
                                .entry(root.scope)
                                .or_default()
                                .insert(normalized);
                        } else {
                            state
                                .pending_changes
                                .file_paths_by_scope
                                .entry(root.scope)
                                .or_default()
                                .insert(normalized);
                        }
                    }
                    EventKind::Create(CreateKind::Folder)
                    | EventKind::Modify(ModifyKind::Metadata(_)) => {}
                    EventKind::Create(CreateKind::Any)
                    | EventKind::Modify(ModifyKind::Any)
                    | EventKind::Remove(RemoveKind::Any)
                    | EventKind::Access(_)
                    | _ => {
                        state.pending_changes.full_rescan_scopes.insert(root.scope);
                    }
                }
            }
        }
        self.schedule_event_flush(app);
    }

    fn note_file_paths_with_scopes(
        &self,
        app: &AppHandle,
        paths: Vec<PathBuf>,
        watched_scopes: &[WebDavWatchedScopeRoot],
    ) {
        if paths.is_empty() {
            return;
        }

        let mut normalized_paths = Vec::new();
        for path in paths {
            if should_ignore_path(&path) {
                continue;
            }
            let normalized = normalize_path_key(&path);
            let Some(root) = scope_for_path(&normalized, watched_scopes) else {
                continue;
            };
            if root.scope == WebDavChangeScope::Config {
                let relative = normalized
                    .strip_prefix(&root.root)
                    .unwrap_or(&normalized)
                    .trim_start_matches('/');
                if should_ignore_config_relative(relative) {
                    continue;
                }
            }
            normalized_paths.push((root.scope, normalized));
        }

        if normalized_paths.is_empty() {
            return;
        }

        let should_flush = {
            let mut state = self.inner.lock().expect("WebDAV change tracker poisoned");
            if state.mutation_suppression_depth > 0 {
                return;
            }
            let mut changed = false;
            for (scope, normalized) in normalized_paths {
                let section = section_mut(&mut state.journal, scope);
                if section.seen_paths.contains(&normalized) {
                    continue;
                }
                section.seen_paths.insert(normalized.clone());
                section.dirty_paths.insert(normalized);
                changed = true;
            }
            changed
        };

        if should_flush {
            self.schedule_flush(app);
        }
    }

    fn apply_pending_changes(&self, app: &AppHandle, changes: PendingWebDavChanges) {
        let watched_scopes = {
            let state = self.inner.lock().expect("WebDAV change tracker poisoned");
            state.watched_scopes.clone()
        };

        let mut files_by_scope: HashMap<WebDavChangeScope, HashSet<String>> = HashMap::new();

        for (scope, roots) in changes.file_paths_by_scope {
            let bucket = files_by_scope.entry(scope).or_default();
            bucket.extend(roots);
        }

        {
            let state = self.inner.lock().expect("WebDAV change tracker poisoned");
            for (scope, roots) in changes.subtree_roots_by_scope {
                for root in roots {
                    let mut recorded = Vec::new();
                    collect_recorded_files_under(&state.journal, scope, &root, &mut recorded);
                    let bucket = files_by_scope.entry(scope).or_default();
                    for path in recorded {
                        bucket.insert(normalize_path_key(&path));
                    }
                }
            }
        }

        for scope in changes.full_rescan_scopes {
            let roots = scope_roots_for_scopes(&watched_scopes, scope);
            let bucket = files_by_scope.entry(scope).or_default();
            if bucket.len() >= WEB_DAV_EVENT_NOISE_THRESHOLD || !roots.is_empty() {
                for root in roots {
                    bucket.insert(root);
                }
            }
        }

        let mut file_paths = Vec::new();
        for (scope, paths) in files_by_scope {
            if paths.len() >= WEB_DAV_EVENT_NOISE_THRESHOLD {
                for root in scope_roots_for_scopes(&watched_scopes, scope) {
                    file_paths.push(PathBuf::from(root));
                }
                continue;
            }
            for path in paths {
                file_paths.push(PathBuf::from(path));
            }
        }

        self.note_file_paths_with_scopes(app, file_paths, &watched_scopes);
    }

    pub fn dirty_paths_snapshot(&self, scope: WebDavChangeScope) -> HashSet<String> {
        let state = self.inner.lock().expect("WebDAV change tracker poisoned");
        section_ref(&state.journal, scope).dirty_paths.clone()
    }

    pub fn clear_synced_paths_for_scopes(&self, app: &AppHandle, scopes: &[WebDavChangeScope]) {
        let should_flush = {
            let mut state = self.inner.lock().expect("WebDAV change tracker poisoned");
            let mut changed = false;
            for scope in scopes {
                let section = section_mut(&mut state.journal, *scope);
                if !section.seen_paths.is_empty() {
                    section.seen_paths.clear();
                    changed = true;
                }
                if !section.dirty_paths.is_empty() {
                    section.dirty_paths.clear();
                    changed = true;
                }
            }
            changed
        };

        if should_flush {
            self.schedule_flush(app);
        }
    }

    pub fn prune_seen_paths(&self, app: &AppHandle) {
        let should_flush = {
            let mut state = self.inner.lock().expect("WebDAV change tracker poisoned");
            let watched_scopes = state.watched_scopes.clone();
            prune_journal_paths_for_roots(&mut state.journal, &watched_scopes, false)
        };

        if should_flush {
            self.schedule_flush(app);
        }
    }

    pub async fn initialize(&self, app: AppHandle) -> Result<(), String> {
        let journal = load_change_journal(&app).await?;
        {
            let mut state = self.inner.lock().expect("WebDAV change tracker poisoned");
            state.journal = journal;
            state.flush_revision = 0;
            if let Some(task) = state.flush_task.take() {
                task.abort();
            }
        }
        self.refresh_watch_roots(app).await
    }

    pub async fn refresh_watch_roots(&self, app: AppHandle) -> Result<(), String> {
        let mut desired_roots: Vec<(PathBuf, WebDavChangeScope)> = Vec::new();

        let backup_settings = load_backup_settings_data(&app)
            .await
            .map_err(|err| format!("读取 backup_settings 失败: {err}"))?;
        if !backup_settings.enabled.unwrap_or(false) {
            let should_flush = {
                let mut state = self.inner.lock().expect("WebDAV change tracker poisoned");
                let roots_to_unwatch = state.watched_roots.iter().cloned().collect::<Vec<_>>();
                if let Some(watcher) = state.watcher.as_mut() {
                    for root in roots_to_unwatch {
                        if let Err(err) = watcher.unwatch(Path::new(&root)) {
                            eprintln!("[backup] ignore WebDAV unwatch failure for {root}: {err}");
                        }
                    }
                }
                state.watched_roots.clear();
                state.watched_scopes.clear();
                prune_journal_paths_for_roots(&mut state.journal, &[], true)
            };
            if should_flush {
                self.schedule_flush(&app);
            }
            return Ok(());
        }

        desired_roots.push((
            haomd_config_root_dir(&app).map_err(|err| format!("获取配置目录失败: {err}"))?,
            WebDavChangeScope::Config,
        ));

        if let Ok(scope) = load_backup_scope_settings_cfg(&app).await {
            if scope.music {
                if let Ok(root) = music_root_dir(&app) {
                    desired_roots.push((root, WebDavChangeScope::Music));
                }
            }

            if scope.alarm {
                if let Ok(root) = alarm_root_dir(&app) {
                    desired_roots.push((root, WebDavChangeScope::Alarm));
                }
            }

            if scope.notes {
                if let Ok(notes_cfg) = load_notes_config_data(&app).await {
                    if let Some(notes_directory) = notes_cfg.notes_directory {
                        let trimmed = notes_directory.trim();
                        if !trimmed.is_empty() {
                            desired_roots.push((PathBuf::from(trimmed), WebDavChangeScope::Notes));
                        }
                    }
                }
            }

            if scope.documents.enabled {
                let selected = if scope.documents.legacy_all_roots
                    && scope.documents.selected_roots.is_empty()
                {
                    Vec::new()
                } else {
                    scope.documents.selected_roots
                };
                for root in selected {
                    let trimmed = root.trim();
                    if !trimmed.is_empty() {
                        desired_roots.push((PathBuf::from(trimmed), WebDavChangeScope::Documents));
                    }
                }
            }
        }

        desired_roots.sort_by(|a, b| a.0.cmp(&b.0));
        desired_roots.dedup_by(|a, b| a.0 == b.0 && a.1 == b.1);

        let desired_keys = desired_roots
            .iter()
            .map(|(path, _)| normalize_path_key(path))
            .collect::<HashSet<_>>();
        let desired_scopes = desired_roots
            .iter()
            .map(|(path, scope)| WebDavWatchedScopeRoot {
                root: normalize_path_key(path),
                scope: *scope,
            })
            .collect::<Vec<_>>();

        let mut state = self.inner.lock().expect("WebDAV change tracker poisoned");
        if state.watcher.is_none() {
            let tracker = self.clone();
            let app_for_events = app.clone();
            let watcher =
                recommended_watcher(move |result: Result<Event, notify::Error>| match result {
                    Ok(event) => {
                        tracker.note_event(&app_for_events, event);
                    }
                    Err(err) => {
                        eprintln!("[backup] WebDAV watcher error: {err}");
                    }
                })
                .map_err(|err| format!("创建 WebDAV 监听器失败: {err}"))?;
            state.watcher = Some(watcher);
        }

        let removed = state
            .watched_roots
            .difference(&desired_keys)
            .cloned()
            .collect::<Vec<_>>();
        let added = desired_roots
            .iter()
            .filter(|(path, _)| !state.watched_roots.contains(&normalize_path_key(path)))
            .map(|(path, _)| path.clone())
            .collect::<Vec<_>>();

        if let Some(watcher) = state.watcher.as_mut() {
            for root in removed {
                if let Err(err) = watcher.unwatch(Path::new(&root)) {
                    eprintln!("[backup] ignore WebDAV unwatch failure for {root}: {err}");
                }
            }
            for root in added {
                if root.exists() {
                    if let Err(err) = watcher.watch(&root, RecursiveMode::Recursive) {
                        eprintln!(
                            "[backup] ignore WebDAV watch failure for {}: {err}",
                            root.display()
                        );
                    }
                }
            }
        }
        state.watched_roots = desired_keys;
        state.watched_scopes = desired_scopes;
        let watched_scopes = state.watched_scopes.clone();
        let should_flush = prune_journal_paths_for_roots(&mut state.journal, &watched_scopes, true);
        drop(state);
        if should_flush {
            self.schedule_flush(&app);
        }
        Ok(())
    }
}
