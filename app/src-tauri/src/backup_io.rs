use crate::alarm_paths::alarm_root_dir;
use crate::backup_scope::BackupScopeSettingsCfg;
use crate::haomd_paths::{haomd_config_root_dir, haomd_data_root_dir};
use crate::notes_config::notes_config_path;
use crate::webdav_change_tracker::{WebDavChangeScope, WebDavChangeTracker};
use crate::{err_payload, new_trace_id, ok, ErrorCode, ResultPayload};
use futures_util::stream::{self, StreamExt};
use once_cell::sync::Lazy;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, CONTENT_LENGTH, USER_AGENT};
use reqwest::StatusCode;
use reqwest::{Body, Client, Method};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::future;
use std::hash::{Hash, Hasher};
use std::io::{Cursor, Read, Seek, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::time::{sleep, Duration};
use url::Url;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

const WEBDAV_SYNC_INDEX_FILE: &str = ".haomd-sync-index.json";
const BACKUP_MANIFEST_FILE: &str = ".haomd-backup-manifest.json";
const BACKUP_EXTRA_ROOT: &str = ".haomd-backup-extra";
const EXCLUDED_BACKUP_FILE_NAMES: &[&str] = &[
    "recent.json",
    "pdf_recent.json",
    "sidebar_state.json",
    "pdf_folders.json",
    "file_virtual_folders.json",
    "file_virtual_assignments.json",
    "search_index.sqlite3",
];
const BACKUP_WEBDAV_IMPORT_STARTED_EVENT: &str = "backup://webdav_import_started";
const BACKUP_WEBDAV_IMPORT_FINISHED_EVENT: &str = "backup://webdav_import_finished";
const BACKUP_WEBDAV_IMPORT_PROGRESS_EVENT: &str = "backup://webdav_import_progress";
const BACKUP_WEBDAV_EXPORT_STARTED_EVENT: &str = "backup://webdav_export_started";
const BACKUP_WEBDAV_EXPORT_PROGRESS_EVENT: &str = "backup://webdav_export_progress";
const BACKUP_WEBDAV_EXPORT_FINISHED_EVENT: &str = "backup://webdav_export_finished";
const WEB_DAV_LOCAL_INDEX_CACHE_VERSION: u32 = 2;
const WEBDAV_PARALLEL_DOWNLOAD_LIMIT: usize = 4;
const WEBDAV_PARALLEL_UPLOAD_LIMIT: usize = 4;
const WEBDAV_PARALLEL_UPLOAD_MAX_SIZE: u64 = 512 * 1024;
const WEBDAV_UPLOAD_CHUNK_SIZE: usize = 64 * 1024;
const WEBDAV_UPLOAD_BUFFERED_MAX_SIZE: u64 = 64 * 1024 * 1024;
const WEBDAV_UPLOAD_BUFFERED_RETRY_MAX_SIZE: u64 = 256 * 1024 * 1024;
const WEBDAV_UPLOAD_SEND_RETRIES: usize = 3;
static WEBDAV_IMPORT_RUNNING: Lazy<AtomicBool> = Lazy::new(|| AtomicBool::new(false));
static WEBDAV_EXPORT_RUNNING: Lazy<AtomicBool> = Lazy::new(|| AtomicBool::new(false));

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WebDavImportFinishedEvent {
    pub success: bool,
    pub message: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WebDavImportProgressEvent {
    pub phase: WebDavImportProgressPhase,
    pub current: usize,
    pub total: usize,
    pub path: String,
    pub size: u64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub enum WebDavImportProgressPhase {
    Scanning,
    Downloading,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WebDavExportFinishedEvent {
    pub success: bool,
    pub message: Option<String>,
    pub summary: Option<WebDavBackupUploadSummary>,
    pub no_uploads: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WebDavBackupUploadSummary {
    pub total_files: usize,
    pub uploaded_files: usize,
    pub skipped_files: usize,
    pub deleted_files: usize,
    pub incremental: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WebDavExportProgressEvent {
    pub phase: WebDavExportProgressPhase,
    pub current: usize,
    pub total: usize,
    pub path: String,
    pub size: u64,
    pub file_count: usize,
    pub dir_count: usize,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub enum WebDavExportProgressPhase {
    Scanning,
    Uploading,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BackupManifest {
    version: u32,
    scopes: Vec<BackupManifestScope>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BackupManifestScope {
    kind: BackupManifestScopeKind,
    stage_path: String,
    source_path: String,
    target_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
enum BackupManifestScopeKind {
    Music,
    Alarm,
    Notes,
    Documents,
}

#[derive(Debug, Clone)]
struct BackupPackage {
    root: PathBuf,
    temp_dir: PathBuf,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DocumentRootIndex {
    version: u32,
    roots: Vec<DocumentRootIndexEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DocumentRootIndexEntry {
    id: String,
    target_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WebDavLocalIndexCache {
    version: u32,
    roots: HashMap<String, WebDavLocalIndexCacheRoot>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WebDavLocalIndexCacheRoot {
    directories: HashMap<String, WebDavLocalDirectoryCacheEntry>,
    files: HashMap<String, WebDavSyncFileEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WebDavLocalDirectoryCacheEntry {
    #[serde(default)]
    modified: u64,
    #[serde(default)]
    file_count: usize,
    #[serde(default)]
    dir_count: usize,
    #[serde(default)]
    total_size: u64,
    #[serde(default)]
    child_fingerprint: u64,
    #[serde(default)]
    child_entries: Vec<WebDavLocalDirectoryChildEntry>,
    #[serde(default)]
    dirs: Vec<String>,
    #[serde(default)]
    files: Vec<WebDavSyncFileEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
enum WebDavLocalDirectoryChildKind {
    File,
    Directory,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WebDavLocalDirectoryChildEntry {
    name: String,
    kind: WebDavLocalDirectoryChildKind,
}

fn backup_root_dir(app: &AppHandle) -> std::io::Result<PathBuf> {
    haomd_config_root_dir(app)
}

fn webdav_local_index_cache_key(root: &Path, skip_relative: Option<fn(&Path) -> bool>) -> String {
    let mode = if skip_relative.is_some() {
        "skip-config"
    } else {
        "plain"
    };
    format!("{}|{mode}", normalize_path_key(root))
}

fn webdav_local_directory_cache_key(root: &Path, path: &Path) -> Result<String, String> {
    let relative = path
        .strip_prefix(root)
        .map_err(|err| format!("解析本地目录缓存路径失败: {err}"))?;
    if relative.as_os_str().is_empty() {
        Ok(String::new())
    } else {
        Ok(normalize_path_key(relative))
    }
}

fn webdav_local_index_cache_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    Ok(haomd_data_root_dir(app)?
        .join("backup")
        .join("webdav-local-index-cache.json"))
}

fn webdav_should_parallel_upload(size: u64) -> bool {
    size <= WEBDAV_PARALLEL_UPLOAD_MAX_SIZE
}

fn emit_webdav_export_progress(
    app: &AppHandle,
    phase: WebDavExportProgressPhase,
    current: usize,
    total: usize,
    path: String,
    size: u64,
    file_count: usize,
    dir_count: usize,
) {
    let _ = app.emit(
        BACKUP_WEBDAV_EXPORT_PROGRESS_EVENT,
        WebDavExportProgressEvent {
            phase,
            current,
            total,
            path,
            size,
            file_count,
            dir_count,
        },
    );
}

fn emit_webdav_import_progress(
    app: &AppHandle,
    phase: WebDavImportProgressPhase,
    current: usize,
    total: usize,
    path: String,
    size: u64,
) {
    let _ = app.emit(
        BACKUP_WEBDAV_IMPORT_PROGRESS_EVENT,
        WebDavImportProgressEvent {
            phase,
            current,
            total,
            path,
            size,
        },
    );
}

#[derive(Debug)]
struct WebDavScanProgressReporter {
    app: AppHandle,
    total: usize,
    current: AtomicUsize,
}

impl WebDavScanProgressReporter {
    fn new(app: &AppHandle, total: usize) -> Self {
        Self {
            app: app.clone(),
            total,
            current: AtomicUsize::new(0),
        }
    }

    fn emit(&self, path: &Path, file_count: usize, dir_count: usize) {
        let current = self.current.fetch_add(1, Ordering::Relaxed) + 1;
        emit_webdav_export_progress(
            &self.app,
            WebDavExportProgressPhase::Scanning,
            current,
            self.total,
            path.to_string_lossy().to_string(),
            0,
            file_count,
            dir_count,
        );
    }
}

async fn load_webdav_local_index_cache(app: &AppHandle) -> Result<WebDavLocalIndexCache, String> {
    let path = webdav_local_index_cache_path(app)
        .map_err(|err| format!("获取 WebDAV 本地索引缓存路径失败: {err}"))?;
    match tokio::fs::read_to_string(&path).await {
        Ok(content) => {
            let mut cache: WebDavLocalIndexCache = match serde_json::from_str(&content) {
                Ok(cache) => cache,
                Err(err) => {
                    eprintln!("[backup] ignore invalid WebDAV local index cache: {err}");
                    return Ok(WebDavLocalIndexCache {
                        version: WEB_DAV_LOCAL_INDEX_CACHE_VERSION,
                        roots: HashMap::new(),
                    });
                }
            };
            if cache.version == 0 {
                cache.version = WEB_DAV_LOCAL_INDEX_CACHE_VERSION;
            }
            Ok(cache)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(WebDavLocalIndexCache {
            version: WEB_DAV_LOCAL_INDEX_CACHE_VERSION,
            roots: HashMap::new(),
        }),
        Err(err) => {
            eprintln!("[backup] ignore unreadable WebDAV local index cache: {err}");
            Ok(WebDavLocalIndexCache {
                version: WEB_DAV_LOCAL_INDEX_CACHE_VERSION,
                roots: HashMap::new(),
            })
        }
    }
}

async fn save_webdav_local_index_cache(
    app: &AppHandle,
    cache: &WebDavLocalIndexCache,
) -> Result<(), String> {
    let path = webdav_local_index_cache_path(app)
        .map_err(|err| format!("获取 WebDAV 本地索引缓存路径失败: {err}"))?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|err| format!("创建 WebDAV 本地索引缓存目录失败: {err}"))?;
    }
    let mut next = cache.clone();
    next.version = WEB_DAV_LOCAL_INDEX_CACHE_VERSION;
    let json = serde_json::to_string_pretty(&next)
        .map_err(|err| format!("序列化 WebDAV 本地索引缓存失败: {err}"))?;
    tokio::fs::write(&path, json)
        .await
        .map_err(|err| format!("写入 WebDAV 本地索引缓存失败: {err}"))
}

async fn upload_webdav_body_from_path(path: &Path, buffered: bool) -> Result<Body, String> {
    if buffered {
        let bytes = tokio::fs::read(path)
            .await
            .map_err(|err| format!("读取本地文件失败 {}: {err}", path.display()))?;
        return Ok(Body::from(bytes));
    }

    let file = tokio::fs::File::open(path)
        .await
        .map_err(|err| format!("打开本地文件失败 {}: {err}", path.display()))?;
    let stream = stream::try_unfold(file, |mut file| async move {
        let mut buffer = vec![0; WEBDAV_UPLOAD_CHUNK_SIZE];
        let read = file.read(&mut buffer).await?;
        if read == 0 {
            Ok::<Option<(Vec<u8>, tokio::fs::File)>, std::io::Error>(None)
        } else {
            buffer.truncate(read);
            Ok::<Option<(Vec<u8>, tokio::fs::File)>, std::io::Error>(Some((buffer, file)))
        }
    });
    Ok(Body::wrap_stream(stream))
}

fn webdav_upload_should_use_buffered_body(file_size: u64, attempt: usize) -> bool {
    if file_size <= WEBDAV_UPLOAD_BUFFERED_MAX_SIZE {
        return true;
    }

    attempt > 0 && file_size <= WEBDAV_UPLOAD_BUFFERED_RETRY_MAX_SIZE
}

fn webdav_upload_send_error_is_transient(err: &reqwest::Error) -> bool {
    err.is_timeout() || err.is_connect() || err.is_request() || err.is_body()
}

async fn upload_webdav_file(
    app: AppHandle,
    client: Client,
    root: PathBuf,
    base_url: String,
    username: String,
    password: String,
    remote_root: String,
    entry: WebDavSyncFileEntry,
    progress_current: usize,
    progress_total: usize,
) -> Result<(), String> {
    let relative = entry.path.clone();
    let path = root.join(&relative);
    let target = resolve_webdav_url(&base_url, &join_remote_relative(&remote_root, &relative));
    let content_length = HeaderValue::from_str(&entry.size.to_string())
        .map_err(|err| format!("设置上传文件长度失败 {relative}: {err}"))?;

    emit_webdav_export_progress(
        &app,
        WebDavExportProgressPhase::Uploading,
        progress_current,
        progress_total,
        relative.clone(),
        entry.size,
        0,
        0,
    );

    for attempt in 0..WEBDAV_UPLOAD_SEND_RETRIES {
        let buffered = webdav_upload_should_use_buffered_body(entry.size, attempt);
        let body = upload_webdav_body_from_path(&path, buffered).await?;
        let response = webdav_request(&client, Method::PUT, &target, &username, &password)
            .header(CONTENT_LENGTH, content_length.clone())
            .body(body)
            .send()
            .await;

        match response {
            Ok(response) => {
                if response.status().is_success() {
                    return Ok(());
                }
                return Err(format!(
                    "上传文件失败 {relative}: HTTP {}",
                    response.status()
                ));
            }
            Err(err) => {
                if attempt + 1 < WEBDAV_UPLOAD_SEND_RETRIES
                    && webdav_upload_send_error_is_transient(&err)
                {
                    let delay_ms = 400_u64 * 2_u64.pow(attempt as u32);
                    sleep(Duration::from_millis(delay_ms)).await;
                    continue;
                }
                let suffix = if entry.size > WEBDAV_UPLOAD_BUFFERED_RETRY_MAX_SIZE {
                    "；文件过大，无法继续切换为固定长度重试"
                } else if attempt > 0 {
                    "；已重试后仍失败"
                } else {
                    ""
                };
                return Err(format!("上传文件失败 {relative}: {err}{suffix}"));
            }
        }
    }
    Ok(())
}

async fn upload_webdav_delete(
    client: Client,
    base_url: String,
    username: String,
    password: String,
    remote_root: String,
    relative: String,
) -> Result<(), String> {
    let target = resolve_webdav_url(&base_url, &join_remote_relative(&remote_root, &relative));
    let response = webdav_request(&client, Method::DELETE, &target, &username, &password)
        .send()
        .await
        .map_err(|err| format!("删除远端文件失败 {relative}: {err}"))?;
    if !(response.status().is_success() || response.status() == StatusCode::NOT_FOUND) {
        return Err(format!(
            "删除远端文件失败 {relative}: HTTP {}",
            response.status()
        ));
    }
    Ok(())
}

async fn run_bounded_webdav_tasks<F, Fut>(tasks: Vec<F>, limit: usize) -> Result<(), String>
where
    F: FnOnce() -> Fut,
    Fut: future::Future<Output = Result<(), String>>,
{
    let mut stream = stream::iter(tasks.into_iter().map(|task| task())).buffer_unordered(limit);
    while let Some(result) = stream.next().await {
        result?;
    }
    Ok(())
}

fn backup_temp_dir(prefix: &str) -> std::io::Result<PathBuf> {
    let dir =
        std::env::temp_dir().join(format!("{prefix}-{}", new_trace_id().replace("trace_", "")));
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn expand_tilde_path(value: &str) -> PathBuf {
    let trimmed = value.trim();
    if trimmed == "~" {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home);
        }
    }
    if let Some(rest) = trimmed.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join(rest);
        }
    }
    PathBuf::from(trimmed)
}

fn normalize_path_key(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn encode_path_key(path: &Path) -> String {
    normalize_path_key(path)
        .as_bytes()
        .iter()
        .map(|byte| format!("{:02x}", byte))
        .collect()
}

fn decode_path_key(encoded: &str) -> Option<PathBuf> {
    if encoded.len() % 2 != 0 {
        return None;
    }
    let mut bytes = Vec::with_capacity(encoded.len() / 2);
    let chars: Vec<char> = encoded.chars().collect();
    for idx in (0..chars.len()).step_by(2) {
        let hex = [chars[idx], chars[idx + 1]];
        let value = u8::from_str_radix(&hex.iter().collect::<String>(), 16).ok()?;
        bytes.push(value);
    }
    String::from_utf8(bytes).ok().map(PathBuf::from)
}

fn is_config_backup_artifact(relative: &Path) -> bool {
    matches!(
        relative.file_name().and_then(|name| name.to_str()),
        Some(".haomd-backup-manifest.json")
    ) || relative
        .components()
        .next()
        .and_then(|component| component.as_os_str().to_str())
        == Some(".haomd-backup-extra")
}

fn copy_tree_contents(
    source_root: &Path,
    source_dir: &Path,
    target_dir: &Path,
    skip_relative: Option<fn(&Path) -> bool>,
) -> Result<(), String> {
    if !source_dir.exists() {
        return Ok(());
    }

    std::fs::create_dir_all(target_dir).map_err(|err| format!("创建备份暂存目录失败: {err}"))?;

    for entry in
        std::fs::read_dir(source_dir).map_err(|err| format!("读取备份来源目录失败: {err}"))?
    {
        let entry = entry.map_err(|err| format!("读取备份来源目录失败: {err}"))?;
        let entry_path = entry.path();
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();

        if file_name == ".DS_Store" || file_name == "Thumbs.db" || file_name.starts_with("._") {
            continue;
        }

        let relative = entry_path
            .strip_prefix(source_root)
            .map_err(|err| format!("解析备份来源相对路径失败: {err}"))?
            .to_path_buf();
        if let Some(predicate) = skip_relative {
            if predicate(&relative) {
                continue;
            }
        }

        let target_path = target_dir.join(&relative);
        if entry_path.is_dir() {
            copy_tree_contents(source_root, &entry_path, target_dir, skip_relative)?;
        } else if entry_path.is_file() {
            if let Some(parent) = target_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|err| format!("创建备份暂存目录失败: {err}"))?;
            }
            std::fs::copy(&entry_path, &target_path)
                .map_err(|err| format!("复制备份文件失败 {}: {err}", relative.display()))?;
        }
    }

    Ok(())
}

fn read_notes_directory(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let path =
        notes_config_path(app).map_err(|err| format!("获取 notes_config 路径失败: {err}"))?;
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(format!("读取 notes_config 失败: {err}")),
    };

    let config: crate::notes_config::NotesConfigData =
        serde_json::from_slice(&bytes).map_err(|err| format!("解析 notes_config 失败: {err}"))?;
    let Some(notes_directory) = config.notes_directory.as_deref() else {
        return Ok(None);
    };
    let target = expand_tilde_path(notes_directory);
    if target.as_os_str().is_empty() {
        return Ok(None);
    }
    Ok(Some(target))
}

fn build_backup_manifest(
    app: &AppHandle,
    scope_settings: &BackupScopeSettingsCfg,
) -> Result<BackupManifest, String> {
    let mut scopes = Vec::new();

    if scope_settings.music {
        let music_root = haomd_data_root_dir(app)
            .map_err(|err| format!("获取 music 目录失败: {err}"))?
            .join("music");
        if music_root.exists() {
            scopes.push(BackupManifestScope {
                kind: BackupManifestScopeKind::Music,
                stage_path: format!("{BACKUP_EXTRA_ROOT}/music"),
                source_path: music_root.to_string_lossy().to_string(),
                target_path: music_root.to_string_lossy().to_string(),
            });
        }
    }

    if scope_settings.alarm {
        let alarm_sound_root = alarm_root_dir(app)
            .map_err(|err| format!("获取闹钟目录失败: {err}"))?
            .join("sounds");
        if alarm_sound_root.exists() {
            scopes.push(BackupManifestScope {
                kind: BackupManifestScopeKind::Alarm,
                stage_path: format!("{BACKUP_EXTRA_ROOT}/alarm/sounds"),
                source_path: alarm_sound_root.to_string_lossy().to_string(),
                target_path: alarm_sound_root.to_string_lossy().to_string(),
            });
        }
    }

    if scope_settings.notes {
        if let Some(notes_dir) = read_notes_directory(app)? {
            if notes_dir.exists() {
                scopes.push(BackupManifestScope {
                    kind: BackupManifestScopeKind::Notes,
                    stage_path: format!("{BACKUP_EXTRA_ROOT}/notes"),
                    source_path: notes_dir.to_string_lossy().to_string(),
                    target_path: notes_dir.to_string_lossy().to_string(),
                });
            }
        }
    }

    Ok(BackupManifest { version: 1, scopes })
}

fn backup_manifest_restore_scopes(manifest: Option<&BackupManifest>) -> Vec<WebDavChangeScope> {
    let mut scopes = vec![WebDavChangeScope::Config];
    let Some(manifest) = manifest else {
        return scopes;
    };

    for scope in &manifest.scopes {
        let maybe_scope = match scope.kind {
            BackupManifestScopeKind::Music => Some(WebDavChangeScope::Music),
            BackupManifestScopeKind::Alarm => Some(WebDavChangeScope::Alarm),
            BackupManifestScopeKind::Notes => Some(WebDavChangeScope::Notes),
            BackupManifestScopeKind::Documents => Some(WebDavChangeScope::Documents),
        };
        if let Some(scope) = maybe_scope {
            if !scopes.contains(&scope) {
                scopes.push(scope);
            }
        }
    }

    scopes
}

fn build_document_root_entries(document_roots: &[String]) -> Vec<DocumentRootIndexEntry> {
    document_roots
        .iter()
        .filter_map(|root| {
            let path = normalized_document_root(root)?;
            Some(DocumentRootIndexEntry {
                id: encode_path_key(&path),
                target_path: normalize_path_key(&path),
            })
        })
        .collect()
}

fn normalized_document_root(root: &str) -> Option<PathBuf> {
    let trimmed = root.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(PathBuf::from(trimmed))
}

fn selected_document_roots(
    scope_settings: &BackupScopeSettingsCfg,
    document_roots: &[String],
) -> Result<Vec<String>, String> {
    if !scope_settings.documents.enabled {
        return Ok(Vec::new());
    }

    let selected = if scope_settings.documents.selected_roots.is_empty()
        && scope_settings.documents.legacy_all_roots
    {
        document_roots
    } else {
        &scope_settings.documents.selected_roots
    };

    let roots = selected
        .iter()
        .filter_map(|root| normalized_document_root(root))
        .map(|root| normalize_path_key(&root))
        .fold(Vec::new(), |mut roots, root| {
            if !roots.contains(&root) {
                roots.push(root);
            }
            roots
        });

    if roots.is_empty() {
        return Err("请选择至少一个 Documents 目录".to_string());
    }

    Ok(roots)
}

async fn can_short_circuit_webdav_export(
    app: &AppHandle,
    base_url: &str,
    username: &str,
    password: &str,
    remote_root: &str,
    scope_settings: &BackupScopeSettingsCfg,
    document_roots: &[String],
    user_agent: Option<&str>,
) -> Result<bool, String> {
    let Some(tracker) = app.try_state::<WebDavChangeTracker>() else {
        return Ok(false);
    };

    let scope_dirty_paths = [
        (
            WebDavChangeScope::Config,
            tracker.dirty_paths_snapshot(WebDavChangeScope::Config),
        ),
        (
            WebDavChangeScope::Music,
            tracker.dirty_paths_snapshot(WebDavChangeScope::Music),
        ),
        (
            WebDavChangeScope::Alarm,
            tracker.dirty_paths_snapshot(WebDavChangeScope::Alarm),
        ),
        (
            WebDavChangeScope::Notes,
            tracker.dirty_paths_snapshot(WebDavChangeScope::Notes),
        ),
        (
            WebDavChangeScope::Documents,
            tracker.dirty_paths_snapshot(WebDavChangeScope::Documents),
        ),
    ];

    for (scope, dirty_paths) in scope_dirty_paths {
        let scope_enabled = match scope {
            WebDavChangeScope::Config => true,
            WebDavChangeScope::Music => scope_settings.music,
            WebDavChangeScope::Alarm => scope_settings.alarm,
            WebDavChangeScope::Notes => scope_settings.notes,
            WebDavChangeScope::Documents => scope_settings.documents.enabled,
        };
        if scope_enabled && !dirty_paths.is_empty() {
            return Ok(false);
        }
    }

    let client = webdav_client(user_agent)?;

    if !remote_scope_sync_index_exists(&client, base_url, username, password, remote_root).await? {
        return Ok(false);
    }

    if scope_settings.music {
        let music_root = haomd_data_root_dir(app)
            .map_err(|err| format!("获取 music 目录失败: {err}"))?
            .join("music");
        if music_root.exists() {
            let music_remote_root = build_remote_prefix(remote_root, "music");
            if !remote_scope_sync_index_exists(
                &client,
                base_url,
                username,
                password,
                &music_remote_root,
            )
            .await?
            {
                return Ok(false);
            }
        }
    }

    if scope_settings.alarm {
        let alarm_root = alarm_root_dir(app)
            .map_err(|err| format!("获取闹钟音频目录失败: {err}"))?
            .join("sounds");
        if alarm_root.exists() {
            let alarm_remote_root =
                build_remote_prefix(&build_remote_prefix(remote_root, "alarm"), "sounds");
            if !remote_scope_sync_index_exists(
                &client,
                base_url,
                username,
                password,
                &alarm_remote_root,
            )
            .await?
            {
                return Ok(false);
            }
        }
    }

    if scope_settings.notes {
        if let Some(notes_root) = read_notes_directory(app)? {
            if notes_root.exists() {
                let notes_remote_root = build_remote_prefix(remote_root, "notes");
                if !remote_scope_sync_index_exists(
                    &client,
                    base_url,
                    username,
                    password,
                    &notes_remote_root,
                )
                .await?
                {
                    return Ok(false);
                }
            }
        }
    }

    if scope_settings.documents.enabled {
        let selected_roots = selected_document_roots(scope_settings, document_roots)?;
        let current_entries = build_document_root_entries(&selected_roots);
        let current_ids = current_entries
            .iter()
            .map(|entry| entry.id.as_str())
            .collect::<HashSet<_>>();
        let remote_index =
            match load_document_root_index(base_url, username, password, remote_root, user_agent)
                .await?
            {
                Some(index) => index,
                None => return Ok(false),
            };

        let remote_ids = remote_index
            .roots
            .iter()
            .map(|entry| entry.id.as_str())
            .collect::<HashSet<_>>();
        if remote_ids != current_ids {
            return Ok(false);
        }

        let docs_remote_root = build_remote_prefix(remote_root, "documents");
        for entry in current_entries {
            let scope_remote_root = build_remote_prefix(&docs_remote_root, &entry.id);
            if !remote_scope_sync_index_exists(
                &client,
                base_url,
                username,
                password,
                &scope_remote_root,
            )
            .await?
            {
                return Ok(false);
            }
        }
    }

    Ok(true)
}

async fn build_backup_package(
    app: &AppHandle,
    scope_settings: &BackupScopeSettingsCfg,
    document_roots: &[String],
) -> Result<BackupPackage, String> {
    let config_root = backup_root_dir(app).map_err(|err| format!("获取备份根目录失败: {err}"))?;
    let temp_dir =
        backup_temp_dir("haomd-backup").map_err(|err| format!("创建备份暂存目录失败: {err}"))?;
    let package_root = temp_dir.clone();
    let result = (|| -> Result<BackupPackage, String> {
        copy_tree_contents(
            &config_root,
            &config_root,
            &package_root,
            Some(is_config_backup_artifact),
        )?;

        let mut manifest = build_backup_manifest(app, scope_settings)?;

        if scope_settings.documents.enabled {
            let selected_roots = selected_document_roots(scope_settings, document_roots)?;
            let mut document_scopes = Vec::new();
            for (index, root) in selected_roots.iter().enumerate() {
                let trimmed = root.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let source = PathBuf::from(trimmed);
                if !source.exists() {
                    continue;
                }
                let stage_path = format!("{BACKUP_EXTRA_ROOT}/documents/{index}");
                copy_tree_contents(&source, &source, &package_root.join(&stage_path), None)?;
                document_scopes.push(BackupManifestScope {
                    kind: BackupManifestScopeKind::Documents,
                    stage_path,
                    source_path: source.to_string_lossy().to_string(),
                    target_path: source.to_string_lossy().to_string(),
                });
            }
            manifest.scopes.extend(document_scopes);
        }

        if !manifest.scopes.is_empty() {
            let manifest_path = package_root.join(BACKUP_MANIFEST_FILE);
            let bytes = serde_json::to_vec_pretty(&manifest)
                .map_err(|err| format!("序列化备份清单失败: {err}"))?;
            std::fs::write(&manifest_path, bytes)
                .map_err(|err| format!("写入备份清单失败: {err}"))?;
        }

        Ok(BackupPackage {
            root: package_root,
            temp_dir: temp_dir.clone(),
        })
    })();

    if result.is_err() {
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    result
}

fn cleanup_backup_package(package: &BackupPackage) {
    let _ = std::fs::remove_dir_all(&package.temp_dir);
}

fn document_restore_target_root(
    original_target: &Path,
    document_restore_root: Option<&Path>,
) -> PathBuf {
    let Some(restore_root) = document_restore_root else {
        return original_target.to_path_buf();
    };
    match original_target.file_name() {
        Some(name) => restore_root.join(name),
        None => restore_root.to_path_buf(),
    }
}

fn restore_target_for_relative(
    relative: &Path,
    config_root: &Path,
    manifest: Option<&BackupManifest>,
    document_restore_root: Option<&Path>,
) -> PathBuf {
    if let Some(manifest) = manifest {
        let mut scopes = manifest.scopes.iter().collect::<Vec<_>>();
        scopes.sort_by(|a, b| b.stage_path.len().cmp(&a.stage_path.len()));
        for scope in scopes {
            let stage_path = Path::new(&scope.stage_path);
            if !relative.starts_with(stage_path) {
                continue;
            }
            let original_target = PathBuf::from(&scope.target_path);
            let target_root = match scope.kind {
                BackupManifestScopeKind::Documents => {
                    document_restore_target_root(&original_target, document_restore_root)
                }
                _ => original_target,
            };
            let stripped = relative.strip_prefix(stage_path).unwrap_or(Path::new(""));
            return if stripped.as_os_str().is_empty() {
                target_root
            } else {
                target_root.join(stripped)
            };
        }
    }

    config_root.join(relative)
}

fn matches_backup_scope(relative: &Path, manifest: Option<&BackupManifest>) -> bool {
    let Some(manifest) = manifest else {
        return false;
    };
    manifest.scopes.iter().any(|scope| {
        let stage_path = Path::new(&scope.stage_path);
        relative.starts_with(stage_path)
    })
}

fn read_manifest_from_zip<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
) -> Result<Option<BackupManifest>, String> {
    let Ok(mut entry) = archive.by_name(BACKUP_MANIFEST_FILE) else {
        return Ok(None);
    };

    let mut bytes = Vec::new();
    entry
        .read_to_end(&mut bytes)
        .map_err(|err| format!("读取备份清单失败: {err}"))?;
    let manifest: BackupManifest =
        serde_json::from_slice(&bytes).map_err(|err| format!("解析备份清单失败: {err}"))?;
    Ok(Some(manifest))
}

fn manifest_contains_documents(manifest: &BackupManifest) -> bool {
    manifest
        .scopes
        .iter()
        .any(|scope| matches!(scope.kind, BackupManifestScopeKind::Documents))
}

fn manifest_documents_root_count(manifest: &BackupManifest) -> usize {
    manifest
        .scopes
        .iter()
        .filter(|scope| matches!(scope.kind, BackupManifestScopeKind::Documents))
        .count()
}

fn response_bytes_look_like_json(bytes: &[u8]) -> bool {
    let Some(first_non_ws) = bytes
        .iter()
        .copied()
        .find(|byte| !byte.is_ascii_whitespace())
    else {
        return false;
    };
    first_non_ws == b'{' || first_non_ws == b'['
}

fn resolve_webdav_url(base_url: &str, remote_path: &str) -> String {
    if remote_path.starts_with("http://") || remote_path.starts_with("https://") {
        return remote_path.to_string();
    }
    format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        remote_path.trim_start_matches('/')
    )
}

fn resolve_webdav_sync_target(url: &str, remote_path: &str) -> Result<(String, String), String> {
    let parsed = Url::parse(url).map_err(|err| format!("WebDAV 服务地址无效: {err}"))?;
    let segments = parsed
        .path_segments()
        .map(|items| {
            items
                .filter(|segment| !segment.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let explicit_remote = normalize_remote_root_path(remote_path);
    let use_explicit = !explicit_remote.is_empty() && explicit_remote != "HaoMD";

    let remote_root = if use_explicit {
        explicit_remote
    } else if let Some(last) = segments.last() {
        last.clone()
    } else {
        "HaoMD".to_string()
    };

    let parent_segments = if use_explicit || segments.is_empty() {
        segments
    } else {
        segments[..segments.len() - 1].to_vec()
    };

    let mut base = parsed.clone();
    let parent_path = if parent_segments.is_empty() {
        "/".to_string()
    } else {
        format!("/{}/", parent_segments.join("/"))
    };
    base.set_path(&parent_path);

    Ok((
        base.to_string().trim_end_matches('/').to_string(),
        remote_root,
    ))
}

fn normalize_remote_root_path(remote_path: &str) -> String {
    let trimmed = remote_path.trim();
    if trimmed.is_empty() || trimmed == "/" {
        return String::new();
    }
    trimmed
        .trim_matches('/')
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("/")
}

fn should_include_backup_relative(relative: &Path) -> bool {
    if relative == Path::new("backup") || relative.starts_with(Path::new("backup")) {
        return false;
    }
    let Some(name) = relative.file_name().and_then(|name| name.to_str()) else {
        return true;
    };
    !EXCLUDED_BACKUP_FILE_NAMES.contains(&name)
        && !name.ends_with(".tmp")
        && !name.contains(".tmp-")
        && !name.ends_with(".swp")
        && !name.ends_with(".part")
}

fn should_skip_config_backup_relative(relative: &Path) -> bool {
    relative.starts_with(Path::new("music"))
        || relative.starts_with(Path::new("alarm").join("sounds"))
        || !should_include_backup_relative(relative)
        || relative == Path::new(BACKUP_MANIFEST_FILE)
        || relative.starts_with(BACKUP_EXTRA_ROOT)
}

fn should_include_backup_package_relative(relative: &Path) -> bool {
    if relative.starts_with(BACKUP_EXTRA_ROOT) || relative == Path::new(BACKUP_MANIFEST_FILE) {
        return true;
    }
    should_include_backup_relative(relative)
}

fn join_remote_relative(root: &str, relative: &str) -> String {
    let rel = relative.replace('\\', "/");
    if root.is_empty() {
        rel
    } else if rel.is_empty() {
        root.to_string()
    } else {
        format!("{root}/{rel}")
    }
}

fn webdav_request(
    client: &Client,
    method: Method,
    target: &str,
    username: &str,
    password: &str,
) -> reqwest::RequestBuilder {
    let request = client.request(method, target);
    if username.trim().is_empty() {
        request
    } else {
        request.basic_auth(username, Some(password))
    }
}

fn webdav_client(user_agent: Option<&str>) -> Result<Client, String> {
    let mut headers = HeaderMap::new();
    if let Some(user_agent) = user_agent.map(str::trim).filter(|value| !value.is_empty()) {
        let header_value = HeaderValue::from_str(user_agent)
            .map_err(|err| format!("WebDAV User-Agent 无效: {err}"))?;
        headers.insert(USER_AGENT, header_value);
        headers.insert(ACCEPT, HeaderValue::from_static("*/*"));
    }
    Client::builder()
        .default_headers(headers)
        .build()
        .map_err(|err| format!("创建 WebDAV 客户端失败: {err}"))
}

async fn ensure_remote_dir(
    client: &Client,
    base_url: &str,
    username: &str,
    password: &str,
    remote_root: &str,
    relative_dir: &str,
) -> Result<(), String> {
    let mut current = String::new();
    for segment in join_remote_relative(remote_root, relative_dir)
        .split('/')
        .filter(|segment| !segment.is_empty())
    {
        if current.is_empty() {
            current = segment.to_string();
        } else {
            current.push('/');
            current.push_str(segment);
        }

        let target = resolve_webdav_url(base_url, &current);
        let response = webdav_request(
            client,
            Method::from_bytes(b"MKCOL").unwrap(),
            &target,
            username,
            password,
        )
        .send()
        .await
        .map_err(|err| format!("创建远程目录失败 {current}: {err}"))?;

        if response.status().is_success()
            || response.status() == StatusCode::METHOD_NOT_ALLOWED
            || response.status() == StatusCode::CONFLICT
        {
            continue;
        }

        return Err(format!(
            "创建远程目录失败 {current}: HTTP {}",
            response.status()
        ));
    }

    Ok(())
}

#[derive(Debug)]
struct WebDavLocalDirectoryChildScanEntry {
    relative: String,
    path: PathBuf,
    kind: WebDavLocalDirectoryChildKind,
}

fn read_local_directory_children(
    root: &Path,
    path: &Path,
    skip_relative: Option<fn(&Path) -> bool>,
) -> Result<Vec<WebDavLocalDirectoryChildScanEntry>, String> {
    let mut children = Vec::new();
    for entry in std::fs::read_dir(path).map_err(|err| format!("读取本地配置目录失败: {err}"))?
    {
        let entry = entry.map_err(|err| format!("读取本地配置目录失败: {err}"))?;
        let entry_path = entry.path();
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();

        // Skip OS metadata files that should not participate in config sync.
        if file_name == ".DS_Store" || file_name == "Thumbs.db" || file_name.starts_with("._") {
            continue;
        }

        let relative = entry_path
            .strip_prefix(root)
            .map_err(|err| format!("解析本地相对路径失败: {err}"))?
            .to_path_buf();

        if let Some(predicate) = skip_relative {
            if predicate(&relative) {
                continue;
            }
        }

        let file_type = entry
            .file_type()
            .map_err(|err| format!("读取本地配置目录类型失败: {err}"))?;
        let kind = if file_type.is_dir() {
            Some(WebDavLocalDirectoryChildKind::Directory)
        } else if file_type.is_file() {
            Some(WebDavLocalDirectoryChildKind::File)
        } else {
            None
        };
        let Some(kind) = kind else {
            continue;
        };

        children.push(WebDavLocalDirectoryChildScanEntry {
            relative: relative.to_string_lossy().replace('\\', "/"),
            path: entry_path,
            kind,
        });
    }

    children.sort_by(|a, b| a.relative.cmp(&b.relative));
    Ok(children)
}

fn count_local_scan_directories(
    root: &Path,
    path: &Path,
    skip_relative: Option<fn(&Path) -> bool>,
) -> Result<usize, String> {
    let children = read_local_directory_children(root, path, skip_relative)?;
    let mut total = 1usize;
    for child in children {
        if matches!(child.kind, WebDavLocalDirectoryChildKind::Directory) {
            total += count_local_scan_directories(root, &child.path, skip_relative)?;
        }
    }
    Ok(total)
}

fn path_is_inside_dirty_path(path: &str, dirty_paths: &HashSet<String>) -> bool {
    dirty_paths.iter().any(|dirty| {
        path == dirty
            || path
                .strip_prefix(dirty)
                .is_some_and(|rest| rest.is_empty() || rest.starts_with('/'))
    })
}

fn dirty_path_inside_subtree(path: &str, dirty_paths: &HashSet<String>) -> bool {
    dirty_paths.iter().any(|dirty| {
        path == dirty
            || dirty
                .strip_prefix(path)
                .is_some_and(|rest| rest.is_empty() || rest.starts_with('/'))
    })
}

fn collect_local_entries(
    root: &Path,
    path: &Path,
    dirs: &mut Vec<String>,
    files: &mut Vec<WebDavSyncFileEntry>,
    skip_relative: Option<fn(&Path) -> bool>,
    cached_root: Option<&WebDavLocalIndexCacheRoot>,
    cache_root: &mut WebDavLocalIndexCacheRoot,
    cached_files: Option<&HashMap<String, WebDavSyncFileEntry>>,
    dirty_paths: Option<&HashSet<String>>,
    subtree_dirty: bool,
    scan_progress: Option<&WebDavScanProgressReporter>,
) -> Result<(), String> {
    let directory_key = webdav_local_directory_cache_key(root, path)?;
    let directory_abs_key = normalize_path_key(path);
    let current_forced_dirty = subtree_dirty
        || dirty_paths.is_some_and(|dirty| path_is_inside_dirty_path(&directory_abs_key, dirty));
    let current_has_dirty_descendant =
        dirty_paths.is_some_and(|dirty| dirty_path_inside_subtree(&directory_abs_key, dirty));
    let metadata = std::fs::metadata(path)
        .map_err(|err| format!("读取本地目录元数据失败 {directory_key}: {err}"))?;
    let modified = metadata_modified_secs(&metadata)?;
    let children = read_local_directory_children(root, path, skip_relative)?;
    let child_entries = children
        .iter()
        .map(|child| WebDavLocalDirectoryChildEntry {
            name: child.relative.clone(),
            kind: child.kind.clone(),
        })
        .collect::<Vec<_>>();
    let child_fingerprint = hash_directory_child_entries(&child_entries);
    let file_count = children
        .iter()
        .filter(|child| matches!(child.kind, WebDavLocalDirectoryChildKind::File))
        .count();
    let dir_count = children.len().saturating_sub(file_count);

    if let Some(progress) = scan_progress {
        progress.emit(path, file_count, dir_count);
    }

    if !current_forced_dirty && !current_has_dirty_descendant {
        if let Some(cached_directory) =
            cached_root.and_then(|root| root.directories.get(&directory_key))
        {
            if cached_directory.modified == modified
                && cached_directory.child_fingerprint == child_fingerprint
            {
                dirs.extend(cached_directory.dirs.clone());
                files.extend(cached_directory.files.clone());
                cache_root
                    .directories
                    .insert(directory_key, cached_directory.clone());
                return Ok(());
            }
        }
    }

    let mut local_dirs = Vec::new();
    let mut local_files = Vec::new();

    for child in children {
        match child.kind {
            WebDavLocalDirectoryChildKind::Directory => {
                local_dirs.push(child.relative.clone());
                let child_abs_key = normalize_path_key(&child.path);
                let child_forced_dirty = current_forced_dirty
                    || dirty_paths
                        .is_some_and(|dirty| path_is_inside_dirty_path(&child_abs_key, dirty));
                collect_local_entries(
                    root,
                    &child.path,
                    &mut local_dirs,
                    &mut local_files,
                    skip_relative,
                    cached_root,
                    cache_root,
                    cached_files,
                    dirty_paths,
                    child_forced_dirty,
                    scan_progress,
                )?;
            }
            WebDavLocalDirectoryChildKind::File => {
                let metadata = std::fs::metadata(&child.path)
                    .map_err(|err| format!("读取本地文件元数据失败 {}: {err}", child.relative))?;
                let size = metadata.len();
                let modified = metadata_modified_secs(&metadata)?;

                let file_dirty = current_forced_dirty
                    || dirty_paths.is_some_and(|dirty| {
                        path_is_inside_dirty_path(&normalize_path_key(&child.path), dirty)
                    });

                if !file_dirty {
                    if let Some(cached_entry) =
                        cached_files.and_then(|entries| entries.get(&child.relative))
                    {
                        if cached_entry.size == size && cached_entry.modified == modified {
                            local_files.push(cached_entry.clone());
                            continue;
                        }
                    }
                }

                let bytes = std::fs::read(&child.path)
                    .map_err(|err| format!("读取本地文件失败 {}: {err}", child.relative))?;
                local_files.push(WebDavSyncFileEntry {
                    path: child.relative,
                    size,
                    modified,
                    sha256: sha256_hex(&bytes),
                });
            }
        }
    }

    dirs.extend(local_dirs.clone());
    files.extend(local_files.clone());
    let file_count = local_files.len();
    let dir_count = local_dirs.len();
    let total_size = local_files.iter().map(|entry| entry.size).sum();
    cache_root.directories.insert(
        directory_key,
        WebDavLocalDirectoryCacheEntry {
            modified,
            file_count,
            dir_count,
            total_size,
            child_fingerprint,
            child_entries,
            dirs: local_dirs,
            files: local_files,
        },
    );

    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
struct WebDavSyncIndex {
    version: u32,
    files: Vec<WebDavSyncFileEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
struct WebDavSyncFileEntry {
    path: String,
    size: u64,
    modified: u64,
    sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum WebDavSyncIndexCompat {
    V2(WebDavSyncIndex),
    V1(WebDavSyncIndexV1),
}

#[derive(Debug, Deserialize)]
struct WebDavSyncIndexV1 {
    version: u32,
    files: Vec<String>,
}

#[derive(Debug)]
struct WebDavSyncPlan {
    upload: Vec<WebDavSyncFileEntry>,
    keep: Vec<WebDavSyncFileEntry>,
    delete: Vec<WebDavSyncFileEntry>,
}

struct WebDavScopeUploadPlan {
    cache_key: String,
    dirs: Vec<String>,
    local_index: WebDavSyncIndex,
    remote_index: Option<WebDavSyncIndex>,
    sync_plan: WebDavSyncPlan,
    cache_root: WebDavLocalIndexCacheRoot,
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn metadata_modified_secs(metadata: &std::fs::Metadata) -> Result<u64, String> {
    let modified = metadata
        .modified()
        .map_err(|err| format!("读取文件修改时间失败: {err}"))?;
    let duration = modified
        .duration_since(UNIX_EPOCH)
        .map_err(|err| format!("计算文件修改时间失败: {err}"))?;
    Ok(duration.as_secs())
}

fn hash_directory_child_entries(child_entries: &[WebDavLocalDirectoryChildEntry]) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    for entry in child_entries {
        entry.name.hash(&mut hasher);
        entry.kind.hash(&mut hasher);
    }
    hasher.finish()
}

fn build_local_sync_index(
    root: &Path,
    skip_relative: Option<fn(&Path) -> bool>,
    cached_root: Option<&WebDavLocalIndexCacheRoot>,
    dirty_paths: Option<&HashSet<String>>,
    scan_progress: Option<&WebDavScanProgressReporter>,
) -> Result<(Vec<String>, WebDavSyncIndex, WebDavLocalIndexCacheRoot), String> {
    let mut dirs = Vec::new();
    let mut files = Vec::new();
    let cached_files = cached_root.map(|root| &root.files);
    let mut cache_root = cached_root.cloned().unwrap_or_default();
    collect_local_entries(
        root,
        root,
        &mut dirs,
        &mut files,
        skip_relative,
        cached_root,
        &mut cache_root,
        cached_files,
        dirty_paths,
        false,
        scan_progress,
    )?;
    dirs.sort();
    files.sort_by(|a, b| a.path.cmp(&b.path));
    cache_root.files = files
        .iter()
        .cloned()
        .map(|entry| (entry.path.clone(), entry))
        .collect::<HashMap<_, _>>();

    Ok((dirs, WebDavSyncIndex { version: 2, files }, cache_root))
}

fn normalize_remote_sync_index(raw: WebDavSyncIndexCompat) -> WebDavSyncIndex {
    match raw {
        WebDavSyncIndexCompat::V2(index) => index,
        WebDavSyncIndexCompat::V1(index) => WebDavSyncIndex {
            version: index.version.max(1),
            files: index
                .files
                .into_iter()
                .map(|path| WebDavSyncFileEntry {
                    path,
                    size: 0,
                    modified: 0,
                    sha256: String::new(),
                })
                .collect(),
        },
    }
}

async fn fetch_remote_sync_index(
    client: &Client,
    base_url: &str,
    username: &str,
    password: &str,
    remote_root: &str,
) -> Result<Option<WebDavSyncIndex>, String> {
    let index_url = resolve_webdav_url(
        base_url,
        &join_remote_relative(remote_root, WEBDAV_SYNC_INDEX_FILE),
    );
    let response = webdav_request(client, Method::GET, &index_url, username, password)
        .send()
        .await
        .map_err(|err| format!("读取同步索引失败: {err}"))?;

    if response.status() == StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(format!("读取同步索引失败: HTTP {}", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|err| format!("读取同步索引失败: {err}"))?;
    let index: WebDavSyncIndexCompat = match serde_json::from_slice(&bytes) {
        Ok(index) => index,
        Err(err) if !response_bytes_look_like_json(&bytes) => {
            return Ok(None);
        }
        Err(err) => return Err(format!("解析同步索引失败: {err}")),
    };
    Ok(Some(normalize_remote_sync_index(index)))
}

async fn load_local_sync_index(root: &Path) -> Result<Option<WebDavSyncIndex>, String> {
    if !local_sync_index_exists(root).await? {
        return Ok(None);
    }
    let path = root.join(WEBDAV_SYNC_INDEX_FILE);
    let bytes = match tokio::fs::read(&path).await {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(format!("读取本地同步索引失败: {err}")),
    };
    let index: WebDavSyncIndexCompat = match serde_json::from_slice(&bytes) {
        Ok(index) => index,
        Err(err) => return Err(format!("解析本地同步索引失败: {err}")),
    };
    Ok(Some(normalize_remote_sync_index(index)))
}

async fn local_sync_index_exists(root: &Path) -> Result<bool, String> {
    let path = root.join(WEBDAV_SYNC_INDEX_FILE);
    match tokio::fs::metadata(&path).await {
        Ok(metadata) => Ok(metadata.is_file()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(err) => Err(format!("检查本地同步索引是否存在失败: {err}")),
    }
}

async fn remote_scope_sync_index_exists(
    client: &Client,
    base_url: &str,
    username: &str,
    password: &str,
    remote_root: &str,
) -> Result<bool, String> {
    fetch_remote_sync_index(client, base_url, username, password, remote_root)
        .await
        .map(|index| index.is_some())
}

async fn fetch_remote_manifest(
    client: &Client,
    base_url: &str,
    username: &str,
    password: &str,
    remote_root: &str,
) -> Result<Option<BackupManifest>, String> {
    let target = resolve_webdav_url(
        base_url,
        &join_remote_relative(remote_root, BACKUP_MANIFEST_FILE),
    );
    let response = webdav_request(client, Method::GET, &target, username, password)
        .send()
        .await
        .map_err(|err| format!("读取备份清单失败: {err}"))?;

    if response.status() == StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(format!("读取备份清单失败: HTTP {}", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|err| format!("读取备份清单失败: {err}"))?;
    let manifest: BackupManifest =
        serde_json::from_slice(&bytes).map_err(|err| format!("解析备份清单失败: {err}"))?;
    Ok(Some(manifest))
}

#[tauri::command]
pub async fn backup_package_contains_documents(backup_path: String) -> ResultPayload<bool> {
    let trace = new_trace_id();
    let file = match File::open(&backup_path) {
        Ok(file) => file,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("打开备份文件失败: {err}"),
                trace,
            )
        }
    };

    let mut archive = match ZipArchive::new(file) {
        Ok(archive) => archive,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("读取备份压缩包失败: {err}"),
                trace,
            )
        }
    };

    let contains_documents = match read_manifest_from_zip(&mut archive) {
        Ok(Some(manifest)) => manifest_contains_documents(&manifest),
        Ok(None) => false,
        Err(message) => return err_payload(ErrorCode::IoError, message, trace),
    };

    ok(contains_documents, trace)
}

#[tauri::command]
pub async fn backup_package_documents_root_count(backup_path: String) -> ResultPayload<usize> {
    let trace = new_trace_id();
    let file = match File::open(&backup_path) {
        Ok(file) => file,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("打开备份文件失败: {err}"),
                trace,
            )
        }
    };

    let mut archive = match ZipArchive::new(file) {
        Ok(archive) => archive,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("读取备份压缩包失败: {err}"),
                trace,
            )
        }
    };

    let count = match read_manifest_from_zip(&mut archive) {
        Ok(Some(manifest)) => manifest_documents_root_count(&manifest),
        Ok(None) => 0,
        Err(message) => return err_payload(ErrorCode::IoError, message, trace),
    };

    ok(count, trace)
}

#[tauri::command]
pub async fn webdav_backup_contains_documents(
    url: String,
    username: String,
    password: String,
    remote_path: String,
    user_agent: Option<String>,
) -> ResultPayload<bool> {
    let trace = new_trace_id();
    let (base_url, remote_root) = match resolve_webdav_sync_target(&url, &remote_path) {
        Ok(value) => value,
        Err(message) => return err_payload(ErrorCode::UNKNOWN, message, trace),
    };
    let client = match webdav_client(user_agent.as_deref()) {
        Ok(client) => client,
        Err(message) => return err_payload(ErrorCode::UNKNOWN, message, trace),
    };
    let contains_documents =
        match fetch_remote_manifest(&client, &base_url, &username, &password, &remote_root).await {
            Ok(Some(manifest)) => manifest_contains_documents(&manifest),
            Ok(None) => false,
            Err(message) => return err_payload(ErrorCode::UNKNOWN, message, trace),
        };

    ok(contains_documents, trace)
}

#[tauri::command]
pub async fn webdav_backup_documents_root_count(
    url: String,
    username: String,
    password: String,
    remote_path: String,
    user_agent: Option<String>,
) -> ResultPayload<usize> {
    let trace = new_trace_id();
    let (base_url, remote_root) = match resolve_webdav_sync_target(&url, &remote_path) {
        Ok(value) => value,
        Err(message) => return err_payload(ErrorCode::UNKNOWN, message, trace),
    };
    let client = match webdav_client(user_agent.as_deref()) {
        Ok(client) => client,
        Err(message) => return err_payload(ErrorCode::UNKNOWN, message, trace),
    };
    let count =
        match fetch_remote_manifest(&client, &base_url, &username, &password, &remote_root).await {
            Ok(Some(manifest)) => manifest_documents_root_count(&manifest),
            Ok(None) => 0,
            Err(message) => return err_payload(ErrorCode::UNKNOWN, message, trace),
        };

    ok(count, trace)
}

fn build_remote_prefix(remote_root: &str, prefix: &str) -> String {
    if prefix.is_empty() {
        remote_root.to_string()
    } else if remote_root.is_empty() {
        prefix.to_string()
    } else {
        format!("{remote_root}/{prefix}")
    }
}

async fn build_webdav_scope_upload_plan(
    root: &Path,
    base_url: &str,
    username: &str,
    password: &str,
    remote_root: &str,
    skip_relative: Option<fn(&Path) -> bool>,
    cache: Option<&WebDavLocalIndexCache>,
    dirty_paths: Option<&HashSet<String>>,
    scan_progress: Option<&WebDavScanProgressReporter>,
    user_agent: Option<&str>,
) -> Result<WebDavScopeUploadPlan, String> {
    let cache_key = webdav_local_index_cache_key(root, skip_relative);
    let cached_root = cache.and_then(|cache| cache.roots.get(&cache_key));
    let (dirs, local_index, cache_root) =
        build_local_sync_index(root, skip_relative, cached_root, dirty_paths, scan_progress)?;
    let client = webdav_client(user_agent)?;
    let remote_index =
        fetch_remote_sync_index(&client, base_url, username, password, remote_root).await?;
    let sync_plan = build_sync_plan(&local_index, remote_index.as_ref());
    Ok(WebDavScopeUploadPlan {
        cache_key,
        dirs,
        local_index,
        remote_index,
        sync_plan,
        cache_root,
    })
}

async fn delete_scope_remote_tree(
    base_url: &str,
    username: &str,
    password: &str,
    remote_root: &str,
    user_agent: Option<&str>,
) -> Result<(), String> {
    let client = webdav_client(user_agent)?;
    let Some(index) =
        fetch_remote_sync_index(&client, base_url, username, password, remote_root).await?
    else {
        return Ok(());
    };

    for entry in index.files {
        let target = resolve_webdav_url(base_url, &join_remote_relative(remote_root, &entry.path));
        let response = webdav_request(&client, Method::DELETE, &target, username, password)
            .send()
            .await
            .map_err(|err| format!("删除远端文件失败 {}: {err}", entry.path))?;

        if !(response.status().is_success() || response.status() == StatusCode::NOT_FOUND) {
            return Err(format!(
                "删除远端文件失败 {}: HTTP {}",
                entry.path,
                response.status()
            ));
        }
    }

    let index_target = resolve_webdav_url(
        base_url,
        &join_remote_relative(remote_root, WEBDAV_SYNC_INDEX_FILE),
    );
    let response = webdav_request(&client, Method::DELETE, &index_target, username, password)
        .send()
        .await
        .map_err(|err| format!("删除远端索引失败: {err}"))?;
    if !(response.status().is_success() || response.status() == StatusCode::NOT_FOUND) {
        return Err(format!("删除远端索引失败: HTTP {}", response.status()));
    }

    Ok(())
}

async fn load_document_root_index(
    base_url: &str,
    username: &str,
    password: &str,
    remote_root: &str,
    user_agent: Option<&str>,
) -> Result<Option<DocumentRootIndex>, String> {
    let client = webdav_client(user_agent)?;
    let remote_prefix = build_remote_prefix(remote_root, "documents");
    let target = resolve_webdav_url(
        base_url,
        &join_remote_relative(&remote_prefix, ".haomd-root-index.json"),
    );
    let response = webdav_request(&client, Method::GET, &target, username, password)
        .send()
        .await
        .map_err(|err| format!("读取文档根索引失败: {err}"))?;
    if response.status() == StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(format!("读取文档根索引失败: HTTP {}", response.status()));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|err| format!("读取文档根索引失败: {err}"))?;
    let index: DocumentRootIndex =
        serde_json::from_slice(&bytes).map_err(|err| format!("解析文档根索引失败: {err}"))?;
    Ok(Some(index))
}

async fn save_document_root_index(
    base_url: &str,
    username: &str,
    password: &str,
    remote_root: &str,
    index: &DocumentRootIndex,
    user_agent: Option<&str>,
) -> Result<(), String> {
    let client = webdav_client(user_agent)?;
    let remote_prefix = build_remote_prefix(remote_root, "documents");
    let target = resolve_webdav_url(
        base_url,
        &join_remote_relative(&remote_prefix, ".haomd-root-index.json"),
    );
    let bytes =
        serde_json::to_vec_pretty(index).map_err(|err| format!("序列化文档根索引失败: {err}"))?;
    let response = webdav_request(&client, Method::PUT, &target, username, password)
        .header(
            reqwest::header::CONTENT_TYPE,
            "application/json; charset=utf-8",
        )
        .body(bytes)
        .send()
        .await
        .map_err(|err| format!("写入文档根索引失败: {err}"))?;
    if !response.status().is_success() {
        return Err(format!("写入文档根索引失败: HTTP {}", response.status()));
    }
    Ok(())
}

fn build_sync_plan(local: &WebDavSyncIndex, remote: Option<&WebDavSyncIndex>) -> WebDavSyncPlan {
    let remote_files = remote
        .map(|index| {
            index
                .files
                .iter()
                .map(|entry| (entry.path.as_str(), entry))
                .collect::<std::collections::HashMap<_, _>>()
        })
        .unwrap_or_default();

    let mut upload = Vec::new();
    let mut keep = Vec::new();
    let mut delete = Vec::new();

    for entry in &local.files {
        let Some(remote_entry) = remote_files.get(entry.path.as_str()) else {
            upload.push(entry.clone());
            continue;
        };

        if remote_entry.size == entry.size
            && remote_entry.modified == entry.modified
            && remote_entry.sha256 == entry.sha256
        {
            keep.push(entry.clone());
        } else {
            upload.push(entry.clone());
        }
    }

    if let Some(remote_index) = remote {
        let local_paths = local
            .files
            .iter()
            .map(|entry| entry.path.as_str())
            .collect::<std::collections::HashSet<_>>();
        for entry in &remote_index.files {
            if !local_paths.contains(entry.path.as_str()) {
                delete.push(entry.clone());
            }
        }
    }

    WebDavSyncPlan {
        upload,
        keep,
        delete,
    }
}

async fn upload_directory_to_webdav(
    app: &AppHandle,
    root: &Path,
    base_url: &str,
    username: &str,
    password: &str,
    remote_root: &str,
    _skip_relative: Option<fn(&Path) -> bool>,
    plan: WebDavScopeUploadPlan,
    progress_start: usize,
    progress_total: usize,
    user_agent: Option<&str>,
) -> Result<WebDavBackupUploadSummary, String> {
    let client = webdav_client(user_agent)?;
    ensure_remote_dir(&client, base_url, username, password, "", remote_root).await?;

    let WebDavScopeUploadPlan {
        dirs,
        local_index,
        remote_index,
        sync_plan,
        cache_key: _,
        cache_root: _,
    } = plan;

    for dir in dirs {
        ensure_remote_dir(&client, base_url, username, password, remote_root, &dir).await?;
    }

    let skipped_file_count = sync_plan.keep.len();
    let uploaded_file_count = sync_plan.upload.len();
    let deleted_file_count = sync_plan.delete.len();

    let mut parallel_uploads = Vec::new();
    let mut sequential_uploads = Vec::new();
    for (index, entry) in sync_plan.upload.iter().cloned().enumerate() {
        if webdav_should_parallel_upload(entry.size) {
            parallel_uploads.push((index, entry));
        } else {
            sequential_uploads.push((index, entry));
        }
    }

    if !parallel_uploads.is_empty() {
        let app_for_tasks = app.clone();
        let client_for_tasks = client.clone();
        let root_for_tasks = root.to_path_buf();
        let base_url_for_tasks = base_url.to_string();
        let username_for_tasks = username.to_string();
        let password_for_tasks = password.to_string();
        let remote_root_for_tasks = remote_root.to_string();
        run_bounded_webdav_tasks(
            parallel_uploads
                .into_iter()
                .map(|(index, entry)| {
                    let app = app_for_tasks.clone();
                    let client = client_for_tasks.clone();
                    let root = root_for_tasks.clone();
                    let base_url = base_url_for_tasks.clone();
                    let username = username_for_tasks.clone();
                    let password = password_for_tasks.clone();
                    let remote_root = remote_root_for_tasks.clone();
                    move || async move {
                        upload_webdav_file(
                            app,
                            client,
                            root,
                            base_url,
                            username,
                            password,
                            remote_root,
                            entry,
                            progress_start + index + 1,
                            progress_total,
                        )
                        .await
                    }
                })
                .collect(),
            WEBDAV_PARALLEL_UPLOAD_LIMIT,
        )
        .await?;
    }

    for (index, entry) in sequential_uploads {
        upload_webdav_file(
            app.clone(),
            client.clone(),
            root.to_path_buf(),
            base_url.to_string(),
            username.to_string(),
            password.to_string(),
            remote_root.to_string(),
            entry,
            progress_start + index + 1,
            progress_total,
        )
        .await?;
    }

    let mut delete_tasks = Vec::new();
    for entry in &sync_plan.delete {
        let client = client.clone();
        let base_url = base_url.to_string();
        let username = username.to_string();
        let password = password.to_string();
        let remote_root = remote_root.to_string();
        let relative = entry.path.clone();
        delete_tasks.push(move || async move {
            upload_webdav_delete(client, base_url, username, password, remote_root, relative).await
        });
    }
    if !delete_tasks.is_empty() {
        run_bounded_webdav_tasks(delete_tasks, WEBDAV_PARALLEL_UPLOAD_LIMIT).await?;
    }

    let index_bytes = serde_json::to_vec_pretty(&local_index)
        .map_err(|err| format!("构建 WebDAV 同步索引失败: {err}"))?;
    let index_target = resolve_webdav_url(
        base_url,
        &join_remote_relative(remote_root, WEBDAV_SYNC_INDEX_FILE),
    );
    let response = webdav_request(&client, Method::PUT, &index_target, username, password)
        .header(
            reqwest::header::CONTENT_TYPE,
            "application/json; charset=utf-8",
        )
        .body(index_bytes)
        .send()
        .await
        .map_err(|err| format!("上传同步索引失败: {err}"))?;

    if !response.status().is_success() {
        return Err(format!("上传同步索引失败: HTTP {}", response.status()));
    }

    Ok(WebDavBackupUploadSummary {
        total_files: local_index.files.len(),
        uploaded_files: uploaded_file_count,
        skipped_files: skipped_file_count,
        deleted_files: deleted_file_count,
        incremental: remote_index.is_some(),
    })
}

async fn download_directory_from_webdav(
    app: &AppHandle,
    client: &Client,
    root: &Path,
    base_url: &str,
    username: &str,
    password: &str,
    remote_root: &str,
    skip_relative: Option<fn(&Path) -> bool>,
    document_restore_root: Option<&Path>,
    local_sync_index: Option<&WebDavSyncIndex>,
) -> Result<(), String> {
    let index = fetch_remote_sync_index(&client, base_url, username, password, remote_root)
        .await?
        .ok_or_else(|| "读取同步索引失败: 远端未找到索引文件".to_string())?;
    let manifest =
        fetch_remote_manifest(&client, base_url, username, password, remote_root).await?;
    let local_files = local_sync_index.map(|index| {
        index
            .files
            .iter()
            .map(|entry| (entry.path.as_str(), entry))
            .collect::<HashMap<_, _>>()
    });
    let download_entries = index
        .files
        .into_iter()
        .filter_map(|entry| {
            let relative = entry.path;
            if relative == BACKUP_MANIFEST_FILE {
                return None;
            }
            let relative_path = Path::new(&relative);
            if !matches_backup_scope(relative_path, manifest.as_ref())
                && skip_relative.is_some_and(|predicate| predicate(relative_path))
            {
                return None;
            }
            if let Some(local_files) = local_files.as_ref() {
                if let Some(local_entry) = local_files.get(relative.as_str()) {
                    if local_entry.size == entry.size
                        && local_entry.modified == entry.modified
                        && local_entry.sha256 == entry.sha256
                    {
                        return None;
                    }
                }
            }
            let local_path = restore_target_for_relative(
                relative_path,
                root,
                manifest.as_ref(),
                document_restore_root,
            );
            Some((relative, local_path, entry.size))
        })
        .collect::<Vec<_>>();

    let total = download_entries.len();
    if total == 0 {
        return Ok(());
    }

    let app = app.clone();
    let base_url = base_url.to_string();
    let username = username.to_string();
    let password = password.to_string();
    let remote_root = remote_root.to_string();
    let client = client.clone();

    run_bounded_webdav_tasks(
        download_entries
            .into_iter()
            .enumerate()
            .map(|(index, (relative, local_path, size))| {
                let app = app.clone();
                let client = client.clone();
                let base_url = base_url.clone();
                let username = username.clone();
                let password = password.clone();
                let remote_root = remote_root.clone();
                move || async move {
                    emit_webdav_import_progress(
                        &app,
                        WebDavImportProgressPhase::Downloading,
                        index + 1,
                        total,
                        relative.clone(),
                        size,
                    );

                    let local_path = if let Some(parent) = local_path.parent() {
                        tokio::fs::create_dir_all(parent)
                            .await
                            .map_err(|err| format!("创建本地恢复目录失败 {relative}: {err}"))?;
                        local_path
                    } else {
                        local_path
                    };

                    let file_url = resolve_webdav_url(
                        &base_url,
                        &join_remote_relative(&remote_root, &relative),
                    );
                    let resp =
                        webdav_request(&client, Method::GET, &file_url, &username, &password)
                            .send()
                            .await
                            .map_err(|err| format!("下载文件失败 {relative}: {err}"))?;

                    if !resp.status().is_success() {
                        return Err(format!("下载文件失败 {relative}: HTTP {}", resp.status()));
                    }

                    let temp_name = match local_path.file_name().and_then(|name| name.to_str()) {
                        Some(name) => {
                            format!("{name}.part-{}", new_trace_id().replace("trace_", ""))
                        }
                        None => format!("download.part-{}", new_trace_id().replace("trace_", "")),
                    };
                    let temp_path = local_path.with_file_name(temp_name);
                    let write_result = async {
                        if let Some(parent) = temp_path.parent() {
                            tokio::fs::create_dir_all(parent).await.map_err(|err| {
                                format!("创建本地恢复临时目录失败 {relative}: {err}")
                            })?;
                        }
                        if tokio::fs::metadata(&local_path).await.is_ok() {
                            let _ = tokio::fs::remove_file(&local_path).await;
                        }
                        let mut output = tokio::fs::File::create(&temp_path)
                            .await
                            .map_err(|err| format!("创建本地恢复文件失败 {relative}: {err}"))?;
                        let mut stream = resp.bytes_stream();
                        while let Some(chunk) = stream.next().await {
                            let chunk = chunk
                                .map_err(|err| format!("读取远端文件流失败 {relative}: {err}"))?;
                            output
                                .write_all(&chunk)
                                .await
                                .map_err(|err| format!("写入本地恢复文件失败 {relative}: {err}"))?;
                        }
                        output
                            .flush()
                            .await
                            .map_err(|err| format!("刷新本地恢复文件失败 {relative}: {err}"))?;
                        tokio::fs::rename(&temp_path, &local_path)
                            .await
                            .map_err(|err| format!("完成本地恢复文件失败 {relative}: {err}"))?;
                        Ok::<(), String>(())
                    }
                    .await;

                    if write_result.is_err() {
                        let _ = tokio::fs::remove_file(&temp_path).await;
                    }

                    write_result
                }
            })
            .collect(),
        WEBDAV_PARALLEL_DOWNLOAD_LIMIT,
    )
    .await
}

fn add_path_to_zip(
    writer: &mut ZipWriter<impl Write + Seek>,
    root: &Path,
    path: &Path,
    output_path: &Path,
    options: SimpleFileOptions,
) -> std::io::Result<()> {
    if path == output_path {
        return Ok(());
    }

    if path.is_dir() {
        for entry in std::fs::read_dir(path)? {
            let entry = entry?;
            add_path_to_zip(writer, root, &entry.path(), output_path, options)?;
        }
        return Ok(());
    }

    let relative = match path.strip_prefix(root) {
        Ok(rel) => rel,
        Err(_) => return Ok(()),
    };
    if !should_include_backup_package_relative(relative) {
        return Ok(());
    }
    let relative_name = relative.to_string_lossy().replace('\\', "/");
    writer.start_file(relative_name, options)?;

    let mut src = File::open(path)?;
    let mut buffer = Vec::new();
    src.read_to_end(&mut buffer)?;
    writer.write_all(&buffer)?;
    Ok(())
}

fn build_backup_zip_bytes(root: &Path) -> Result<Vec<u8>, String> {
    let cursor = Cursor::new(Vec::<u8>::new());
    let mut writer = ZipWriter::new(cursor);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    add_path_to_zip(&mut writer, root, root, Path::new(""), options)
        .map_err(|err| format!("创建备份压缩包失败: {err}"))?;

    writer
        .finish()
        .map(|cursor| cursor.into_inner())
        .map_err(|err| format!("完成备份压缩包失败: {err}"))
}

fn restore_backup_from_reader<R: Read + Seek>(
    reader: R,
    root: &Path,
    document_restore_root: Option<&Path>,
) -> Result<Vec<WebDavChangeScope>, String> {
    let mut archive =
        ZipArchive::new(reader).map_err(|err| format!("读取备份压缩包失败: {err}"))?;
    let manifest = read_manifest_from_zip(&mut archive)?;
    let restore_scopes = backup_manifest_restore_scopes(manifest.as_ref());

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|err| format!("读取备份条目失败: {err}"))?;

        let relative = match entry.enclosed_name() {
            Some(path) => path.to_path_buf(),
            None => continue,
        };
        if relative == Path::new(BACKUP_MANIFEST_FILE) {
            continue;
        }
        if !matches_backup_scope(&relative, manifest.as_ref())
            && !should_include_backup_relative(&relative)
        {
            continue;
        }

        let out_path =
            restore_target_for_relative(&relative, root, manifest.as_ref(), document_restore_root);
        if entry.is_dir() {
            std::fs::create_dir_all(&out_path).map_err(|err| format!("创建恢复目录失败: {err}"))?;
            continue;
        }

        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent).map_err(|err| format!("创建恢复目录失败: {err}"))?;
        }

        let mut output =
            File::create(&out_path).map_err(|err| format!("创建恢复文件失败: {err}"))?;
        std::io::copy(&mut entry, &mut output).map_err(|err| format!("写入恢复文件失败: {err}"))?;
    }

    Ok(restore_scopes)
}

#[tauri::command]
pub async fn export_settings_backup(
    app: AppHandle,
    output_path: String,
    scope_settings: BackupScopeSettingsCfg,
    document_roots: Vec<String>,
) -> ResultPayload<()> {
    let trace = new_trace_id();
    let output = PathBuf::from(output_path);
    if let Some(parent) = output.parent() {
        if let Err(err) = std::fs::create_dir_all(parent) {
            return err_payload(
                ErrorCode::IoError,
                format!("创建备份目录失败: {err}"),
                trace,
            );
        }
    }

    if let Err(err) = File::create(&output) {
        return err_payload(
            ErrorCode::IoError,
            format!("创建备份文件失败: {err}"),
            trace,
        );
    }

    match build_backup_package(&app, &scope_settings, &document_roots).await {
        Ok(package) => {
            let result = match build_backup_zip_bytes(&package.root) {
                Ok(bytes) => match std::fs::write(&output, bytes) {
                    Ok(()) => ok((), trace),
                    Err(err) => err_payload(
                        ErrorCode::IoError,
                        format!("写入备份文件失败: {err}"),
                        trace,
                    ),
                },
                Err(message) => err_payload(ErrorCode::IoError, message, trace),
            };
            cleanup_backup_package(&package);
            result
        }
        Err(message) => err_payload(ErrorCode::IoError, message, trace),
    }
}

#[tauri::command]
pub async fn export_settings_backup_to_webdav(
    app: AppHandle,
    url: String,
    username: String,
    password: String,
    remote_path: String,
    scope_settings: BackupScopeSettingsCfg,
    document_roots: Vec<String>,
    user_agent: Option<String>,
) -> ResultPayload<WebDavBackupUploadSummary> {
    let trace = new_trace_id();
    let (base_url, remote_root) = match resolve_webdav_sync_target(&url, &remote_path) {
        Ok(value) => value,
        Err(message) => return err_payload(ErrorCode::UNKNOWN, message, trace),
    };
    let webdav_user_agent = user_agent.as_deref();
    match can_short_circuit_webdav_export(
        &app,
        &base_url,
        &username,
        &password,
        &remote_root,
        &scope_settings,
        &document_roots,
        webdav_user_agent,
    )
    .await
    {
        Ok(true) => {
            return ok(
                WebDavBackupUploadSummary {
                    total_files: 0,
                    uploaded_files: 0,
                    skipped_files: 0,
                    deleted_files: 0,
                    incremental: true,
                },
                trace,
            );
        }
        Ok(false) => {}
        Err(message) => return err_payload(ErrorCode::UNKNOWN, message, trace),
    }

    let mut local_index_cache = match load_webdav_local_index_cache(&app).await {
        Ok(cache) => cache,
        Err(message) => return err_payload(ErrorCode::UNKNOWN, message, trace),
    };
    let mut total_files = 0usize;
    let mut uploaded_files = 0usize;
    let mut skipped_files = 0usize;
    let mut deleted_files = 0usize;
    let mut incremental = false;
    let mut progress_total = 0usize;
    let mut progress_start = 0usize;
    let mut upload_plans: Vec<(WebDavChangeScope, PathBuf, String, WebDavScopeUploadPlan)> =
        Vec::new();
    let mut local_index_cache_changed = false;
    let change_tracker = app.try_state::<WebDavChangeTracker>();
    if let Some(tracker) = change_tracker.as_ref() {
        if let Err(message) = tracker.flush_now(&app).await {
            eprintln!("[backup] ignore WebDAV change journal flush failure: {message}");
        }
    }
    let dirty_paths_for = |scope: WebDavChangeScope| -> HashSet<String> {
        change_tracker
            .as_ref()
            .map(|tracker| tracker.dirty_paths_snapshot(scope))
            .unwrap_or_default()
    };
    #[derive(Debug)]
    struct WebDavScanTarget {
        scope: WebDavChangeScope,
        root: PathBuf,
        remote_root: String,
        skip_relative: Option<fn(&Path) -> bool>,
        dirty_paths: HashSet<String>,
    }

    let mut scan_targets = Vec::<WebDavScanTarget>::new();

    let config_root = match backup_root_dir(&app) {
        Ok(dir) => dir,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取备份根目录失败: {err}"),
                trace,
            )
        }
    };
    scan_targets.push(WebDavScanTarget {
        scope: WebDavChangeScope::Config,
        root: config_root,
        remote_root: remote_root.clone(),
        skip_relative: Some(should_skip_config_backup_relative),
        dirty_paths: dirty_paths_for(WebDavChangeScope::Config),
    });

    if scope_settings.music {
        let music_root = match crate::music_paths::music_root_dir(&app) {
            Ok(dir) => dir,
            Err(err) => {
                return err_payload(
                    ErrorCode::IoError,
                    format!("获取 music 目录失败: {err}"),
                    trace,
                )
            }
        };
        if music_root.exists() {
            scan_targets.push(WebDavScanTarget {
                scope: WebDavChangeScope::Music,
                root: music_root,
                remote_root: build_remote_prefix(&remote_root, "music"),
                skip_relative: None,
                dirty_paths: dirty_paths_for(WebDavChangeScope::Music),
            });
        }
    }

    if scope_settings.alarm {
        let alarm_root = match alarm_root_dir(&app) {
            Ok(dir) => dir.join("sounds"),
            Err(err) => {
                return err_payload(
                    ErrorCode::IoError,
                    format!("获取闹钟音频目录失败: {err}"),
                    trace,
                )
            }
        };
        if alarm_root.exists() {
            scan_targets.push(WebDavScanTarget {
                scope: WebDavChangeScope::Alarm,
                root: alarm_root,
                remote_root: build_remote_prefix(
                    &build_remote_prefix(&remote_root, "alarm"),
                    "sounds",
                ),
                skip_relative: None,
                dirty_paths: dirty_paths_for(WebDavChangeScope::Alarm),
            });
        }
    }

    if scope_settings.notes {
        let notes_root = match read_notes_directory(&app) {
            Ok(Some(dir)) => dir,
            Ok(None) => PathBuf::new(),
            Err(message) => return err_payload(ErrorCode::UNKNOWN, message, trace),
        };
        if notes_root.exists() {
            scan_targets.push(WebDavScanTarget {
                scope: WebDavChangeScope::Notes,
                root: notes_root,
                remote_root: build_remote_prefix(&remote_root, "notes"),
                skip_relative: None,
                dirty_paths: dirty_paths_for(WebDavChangeScope::Notes),
            });
        }
    }

    if scope_settings.documents.enabled {
        let selected_roots = match selected_document_roots(&scope_settings, &document_roots) {
            Ok(roots) => roots,
            Err(message) => return err_payload(ErrorCode::UNKNOWN, message, trace),
        };
        let current_entries = build_document_root_entries(&selected_roots);
        let current_ids = current_entries
            .iter()
            .map(|entry| entry.id.clone())
            .collect::<std::collections::HashSet<_>>();
        let remote_index = match load_document_root_index(
            &base_url,
            &username,
            &password,
            &remote_root,
            webdav_user_agent,
        )
        .await
        {
            Ok(index) => index,
            Err(message) => return err_payload(ErrorCode::UNKNOWN, message, trace),
        };

        if let Some(remote_index) = remote_index.as_ref() {
            incremental = true;
            for entry in &remote_index.roots {
                if current_ids.contains(&entry.id) {
                    continue;
                }
                let stale_remote_root =
                    build_remote_prefix(&build_remote_prefix(&remote_root, "documents"), &entry.id);
                if let Err(message) = delete_scope_remote_tree(
                    &base_url,
                    &username,
                    &password,
                    &stale_remote_root,
                    webdav_user_agent,
                )
                .await
                {
                    return err_payload(ErrorCode::UNKNOWN, message, trace);
                }
            }
        }

        for entry in &current_entries {
            let local_root = match decode_path_key(&entry.id) {
                Some(path) => path,
                None => continue,
            };
            if !local_root.exists() {
                continue;
            }
            scan_targets.push(WebDavScanTarget {
                scope: WebDavChangeScope::Documents,
                root: local_root,
                remote_root: build_remote_prefix(
                    &build_remote_prefix(&remote_root, "documents"),
                    &entry.id,
                ),
                skip_relative: None,
                dirty_paths: dirty_paths_for(WebDavChangeScope::Documents),
            });
        }
    }

    let scan_total = scan_targets
        .iter()
        .map(|target| {
            count_local_scan_directories(&target.root, &target.root, target.skip_relative)
                .unwrap_or(1)
        })
        .sum::<usize>()
        .max(1);
    let scan_progress = WebDavScanProgressReporter::new(&app, scan_total);
    for target in scan_targets.into_iter() {
        let plan = match build_webdav_scope_upload_plan(
            &target.root,
            &base_url,
            &username,
            &password,
            &target.remote_root,
            target.skip_relative,
            Some(&local_index_cache),
            Some(&target.dirty_paths),
            Some(&scan_progress),
            webdav_user_agent,
        )
        .await
        {
            Ok(plan) => plan,
            Err(message) => return err_payload(ErrorCode::UNKNOWN, message, trace),
        };

        if local_index_cache
            .roots
            .get(&plan.cache_key)
            .is_none_or(|existing| existing != &plan.cache_root)
        {
            local_index_cache
                .roots
                .insert(plan.cache_key.clone(), plan.cache_root.clone());
            local_index_cache_changed = true;
        }

        progress_total += plan.sync_plan.upload.len();
        upload_plans.push((target.scope, target.root, target.remote_root, plan));
    }

    if local_index_cache_changed {
        if let Err(message) = save_webdav_local_index_cache(&app, &local_index_cache).await {
            eprintln!("[backup] ignore WebDAV local index cache save failure: {message}");
        }
    }

    let mut completed_scopes = Vec::new();
    for (scope, root, remote_root_item, plan) in upload_plans {
        match upload_directory_to_webdav(
            &app,
            &root,
            &base_url,
            &username,
            &password,
            &remote_root_item,
            None,
            plan,
            progress_start,
            progress_total,
            webdav_user_agent,
        )
        .await
        {
            Ok(summary) => {
                completed_scopes.push(scope);
                progress_start += summary.uploaded_files;
                total_files += summary.total_files;
                uploaded_files += summary.uploaded_files;
                skipped_files += summary.skipped_files;
                deleted_files += summary.deleted_files;
                incremental |= summary.incremental;
            }
            Err(message) => return err_payload(ErrorCode::UNKNOWN, message, trace),
        }
    }

    if scope_settings.documents.enabled {
        let selected_roots = match selected_document_roots(&scope_settings, &document_roots) {
            Ok(roots) => roots,
            Err(message) => return err_payload(ErrorCode::UNKNOWN, message, trace),
        };
        let current_entries = build_document_root_entries(&selected_roots);
        if let Err(message) = save_document_root_index(
            &base_url,
            &username,
            &password,
            &remote_root,
            &DocumentRootIndex {
                version: 1,
                roots: current_entries,
            },
            webdav_user_agent,
        )
        .await
        {
            return err_payload(ErrorCode::UNKNOWN, message, trace);
        }
    }

    if let Some(tracker) = app.try_state::<WebDavChangeTracker>() {
        tracker.clear_synced_paths_for_scopes(&app, &completed_scopes);
        tracker.prune_seen_paths(&app);
    }

    ok(
        WebDavBackupUploadSummary {
            total_files,
            uploaded_files,
            skipped_files,
            deleted_files,
            incremental,
        },
        trace,
    )
}

#[tauri::command]
pub async fn test_webdav_connection(
    url: String,
    username: String,
    password: String,
    user_agent: Option<String>,
) -> ResultPayload<()> {
    let trace = new_trace_id();
    let target = url.trim();
    if target.is_empty() {
        return err_payload(
            ErrorCode::UNSUPPORTED,
            "WebDAV 服务地址不能为空".to_string(),
            trace,
        );
    }

    let client = match webdav_client(user_agent.as_deref()) {
        Ok(client) => client,
        Err(message) => return err_payload(ErrorCode::UNKNOWN, message, trace),
    };
    let mut request = client.request(reqwest::Method::OPTIONS, target);
    if !username.trim().is_empty() {
        request = request.basic_auth(username, Some(password));
    }

    match request.send().await {
        Ok(resp)
            if resp.status().is_success() || resp.status() == StatusCode::METHOD_NOT_ALLOWED =>
        {
            ok((), trace)
        }
        Ok(resp) if resp.status() == StatusCode::UNAUTHORIZED => err_payload(
            ErrorCode::UNKNOWN,
            "HTTP 401 Unauthorized".to_string(),
            trace,
        ),
        Ok(resp) if resp.status() == StatusCode::FORBIDDEN => {
            err_payload(ErrorCode::UNKNOWN, "HTTP 403 Forbidden".to_string(), trace)
        }
        Ok(resp) => err_payload(ErrorCode::UNKNOWN, format!("HTTP {}", resp.status()), trace),
        Err(err) => err_payload(ErrorCode::UNKNOWN, err.to_string(), trace),
    }
}

fn optional_restore_root(value: Option<String>) -> Option<PathBuf> {
    value
        .map(|root| root.trim().to_string())
        .filter(|root| !root.is_empty())
        .map(PathBuf::from)
}

#[tauri::command]
pub async fn import_settings_backup(
    app: AppHandle,
    backup_path: String,
    document_restore_root: Option<String>,
) -> ResultPayload<()> {
    let trace = new_trace_id();
    let root = match backup_root_dir(&app) {
        Ok(dir) => dir,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取恢复根目录失败: {err}"),
                trace,
            )
        }
    };

    let file = match File::open(&backup_path) {
        Ok(file) => file,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("打开备份文件失败: {err}"),
                trace,
            )
        }
    };

    let document_restore_root = optional_restore_root(document_restore_root);
    let tracker = app
        .try_state::<WebDavChangeTracker>()
        .map(|tracker| (*tracker).clone());
    if let Some(tracker) = tracker.as_ref() {
        tracker.begin_mutation_suppression();
    }
    let result = restore_backup_from_reader(file, &root, document_restore_root.as_deref());
    if let Some(tracker) = tracker.as_ref() {
        tracker.end_mutation_suppression();
    }

    match result {
        Ok(scopes) => {
            if let Some(tracker) = tracker.as_ref() {
                tracker.clear_synced_paths_for_scopes(&app, &scopes);
                tracker.prune_seen_paths(&app);
                if let Err(err) = tracker.flush_now(&app).await {
                    eprintln!("[backup] ignore WebDAV change journal flush failure: {err}");
                }
            }
            ok((), trace)
        }
        Err(message) => err_payload(ErrorCode::IoError, message, trace),
    }
}

#[tauri::command]
pub async fn import_settings_backup_from_webdav(
    app: AppHandle,
    url: String,
    username: String,
    password: String,
    remote_path: String,
    document_restore_root: Option<String>,
    user_agent: Option<String>,
) -> ResultPayload<()> {
    let trace = new_trace_id();
    let document_restore_root = optional_restore_root(document_restore_root);
    let webdav_user_agent = user_agent.as_deref();
    let root = match backup_root_dir(&app) {
        Ok(dir) => dir,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取恢复根目录失败: {err}"),
                trace,
            )
        }
    };
    let (base_url, remote_root) = match resolve_webdav_sync_target(&url, &remote_path) {
        Ok(value) => value,
        Err(message) => return err_payload(ErrorCode::UNKNOWN, message, trace),
    };

    let client = match webdav_client(webdav_user_agent) {
        Ok(client) => client,
        Err(message) => return err_payload(ErrorCode::UNKNOWN, message, trace),
    };

    let app_for_config = app.clone();
    let app_for_music = app.clone();
    let app_for_alarm = app.clone();
    let app_for_notes = app.clone();
    let app_for_docs = app.clone();
    let client_for_config = client.clone();
    let client_for_music = client.clone();
    let client_for_alarm = client.clone();
    let client_for_notes = client.clone();
    let client_for_docs = client.clone();
    let base_url_for_music = base_url.clone();
    let base_url_for_alarm = base_url.clone();
    let base_url_for_notes = base_url.clone();
    let base_url_for_docs = base_url.clone();
    let username_for_music = username.clone();
    let username_for_alarm = username.clone();
    let username_for_notes = username.clone();
    let username_for_docs = username.clone();
    let password_for_music = password.clone();
    let password_for_alarm = password.clone();
    let password_for_notes = password.clone();
    let password_for_docs = password.clone();
    let root_for_config = root.clone();
    let base_url_for_config = base_url.clone();
    let username_for_config = username.clone();
    let password_for_config = password.clone();
    let remote_root_for_config = remote_root.clone();
    let remote_root_for_music = remote_root.clone();
    let remote_root_for_alarm = remote_root.clone();
    let remote_root_for_notes = remote_root.clone();
    let remote_root_for_docs = remote_root.clone();
    let document_restore_root_for_docs = document_restore_root.clone();
    let notes_root = match read_notes_directory(&app) {
        Ok(value) => value,
        Err(message) => return err_payload(ErrorCode::UNKNOWN, message, trace),
    };
    emit_webdav_import_progress(
        &app,
        WebDavImportProgressPhase::Scanning,
        0,
        1,
        remote_root.clone(),
        0,
    );
    let tracker = app
        .try_state::<WebDavChangeTracker>()
        .map(|tracker| (*tracker).clone());
    if let Some(tracker) = tracker.as_ref() {
        tracker.begin_mutation_suppression();
    }

    let config_task = async move {
        let local_sync_index = load_local_sync_index(&root_for_config).await?;
        download_directory_from_webdav(
            &app_for_config,
            &client_for_config,
            &root_for_config,
            &base_url_for_config,
            &username_for_config,
            &password_for_config,
            &remote_root_for_config,
            Some(should_skip_config_backup_relative),
            None,
            local_sync_index.as_ref(),
        )
        .await?;
        Ok::<Vec<WebDavChangeScope>, String>(vec![WebDavChangeScope::Config])
    };
    let music_task = async move {
        let music_remote_root = build_remote_prefix(&remote_root_for_music, "music");
        match remote_scope_sync_index_exists(
            &client_for_music,
            &base_url_for_music,
            &username_for_music,
            &password_for_music,
            &music_remote_root,
        )
        .await
        {
            Ok(true) => {
                let music_root = crate::music_paths::ensure_music_root_dir(&app_for_music)
                    .await
                    .map_err(|err| format!("获取 music 目录失败: {err}"))?;
                let local_sync_index = load_local_sync_index(&music_root).await?;
                download_directory_from_webdav(
                    &app_for_music,
                    &client_for_music,
                    &music_root,
                    &base_url_for_music,
                    &username_for_music,
                    &password_for_music,
                    &music_remote_root,
                    None,
                    None,
                    local_sync_index.as_ref(),
                )
                .await?;
                Ok(vec![WebDavChangeScope::Music])
            }
            Ok(false) => Ok(Vec::new()),
            Err(message) => Err(message),
        }
    };
    let alarm_task = async move {
        let alarm_remote_root = build_remote_prefix(
            &build_remote_prefix(&remote_root_for_alarm, "alarm"),
            "sounds",
        );
        match remote_scope_sync_index_exists(
            &client_for_alarm,
            &base_url_for_alarm,
            &username_for_alarm,
            &password_for_alarm,
            &alarm_remote_root,
        )
        .await
        {
            Ok(true) => {
                let alarm_root = crate::alarm_paths::ensure_alarm_root_dir(&app_for_alarm)
                    .await
                    .map_err(|err| format!("获取闹钟音频目录失败: {err}"))?
                    .join("sounds");
                let local_sync_index = load_local_sync_index(&alarm_root).await?;
                download_directory_from_webdav(
                    &app_for_alarm,
                    &client_for_alarm,
                    &alarm_root,
                    &base_url_for_alarm,
                    &username_for_alarm,
                    &password_for_alarm,
                    &alarm_remote_root,
                    None,
                    None,
                    local_sync_index.as_ref(),
                )
                .await?;
                Ok(vec![WebDavChangeScope::Alarm])
            }
            Ok(false) => Ok(Vec::new()),
            Err(message) => Err(message),
        }
    };
    let notes_task = async move {
        let Some(notes_root) = notes_root else {
            return Ok(Vec::new());
        };
        let notes_remote_root = build_remote_prefix(&remote_root_for_notes, "notes");
        match remote_scope_sync_index_exists(
            &client_for_notes,
            &base_url_for_notes,
            &username_for_notes,
            &password_for_notes,
            &notes_remote_root,
        )
        .await
        {
            Ok(true) => {
                let local_sync_index = load_local_sync_index(&notes_root).await?;
                download_directory_from_webdav(
                    &app_for_notes,
                    &client_for_notes,
                    &notes_root,
                    &base_url_for_notes,
                    &username_for_notes,
                    &password_for_notes,
                    &notes_remote_root,
                    None,
                    None,
                    local_sync_index.as_ref(),
                )
                .await?;
                Ok(vec![WebDavChangeScope::Notes])
            }
            Ok(false) => Ok(Vec::new()),
            Err(message) => Err(message),
        }
    };
    let docs_task = async move {
        let Some(index) = load_document_root_index(
            &base_url_for_docs,
            &username_for_docs,
            &password_for_docs,
            &remote_root_for_docs,
            webdav_user_agent,
        )
        .await?
        else {
            return Ok(Vec::new());
        };

        let docs_remote_root = build_remote_prefix(&remote_root_for_docs, "documents");
        let document_roots = index
            .roots
            .into_iter()
            .filter_map(|entry| {
                let original_target = decode_path_key(&entry.id)?;
                Some((
                    entry.id,
                    document_restore_target_root(
                        &original_target,
                        document_restore_root_for_docs.as_deref(),
                    ),
                ))
            })
            .collect::<Vec<_>>();

        run_bounded_webdav_tasks(
            document_roots
                .into_iter()
                .map(|(entry_id, target_root)| {
                    let app = app_for_docs.clone();
                    let client = client_for_docs.clone();
                    let base_url = base_url_for_docs.clone();
                    let username = username_for_docs.clone();
                    let password = password_for_docs.clone();
                    let docs_remote_root = docs_remote_root.clone();
                    move || async move {
                        let scope_remote_root = build_remote_prefix(&docs_remote_root, &entry_id);
                        let local_sync_index = load_local_sync_index(&target_root).await?;
                        download_directory_from_webdav(
                            &app,
                            &client,
                            &target_root,
                            &base_url,
                            &username,
                            &password,
                            &scope_remote_root,
                            None,
                            None,
                            local_sync_index.as_ref(),
                        )
                        .await
                    }
                })
                .collect(),
            WEBDAV_PARALLEL_DOWNLOAD_LIMIT,
        )
        .await?;
        Ok(vec![WebDavChangeScope::Documents])
    };

    let result = tokio::try_join!(config_task, music_task, alarm_task, notes_task, docs_task);

    if let Some(tracker) = tracker.as_ref() {
        tracker.end_mutation_suppression();
    }

    let (config_scopes, music_scopes, alarm_scopes, notes_scopes, docs_scopes) = match result {
        Ok(value) => value,
        Err(message) => return err_payload(ErrorCode::UNKNOWN, message, trace),
    };

    if let Some(tracker) = tracker.as_ref() {
        let mut restored_scopes = Vec::new();
        restored_scopes.extend(config_scopes);
        restored_scopes.extend(music_scopes);
        restored_scopes.extend(alarm_scopes);
        restored_scopes.extend(notes_scopes);
        restored_scopes.extend(docs_scopes);
        tracker.clear_synced_paths_for_scopes(&app, &restored_scopes);
        tracker.prune_seen_paths(&app);
        if let Err(err) = tracker.flush_now(&app).await {
            eprintln!("[backup] ignore WebDAV change journal flush failure: {err}");
        }
    }

    ok((), trace)
}

#[tauri::command]
pub async fn start_import_settings_backup_from_webdav(
    app: AppHandle,
    url: String,
    username: String,
    password: String,
    remote_path: String,
    document_restore_root: Option<String>,
    user_agent: Option<String>,
) -> ResultPayload<()> {
    let trace = new_trace_id();

    if WEBDAV_IMPORT_RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return err_payload(
            ErrorCode::CONFLICT,
            "已有 WebDAV 恢复任务正在后台运行".to_string(),
            trace,
        );
    }

    let _ = app.emit(BACKUP_WEBDAV_IMPORT_STARTED_EVENT, ());

    tauri::async_runtime::spawn(async move {
        let payload = match import_settings_backup_from_webdav(
            app.clone(),
            url,
            username,
            password,
            remote_path,
            document_restore_root,
            user_agent,
        )
        .await
        {
            ResultPayload::Ok { .. } => WebDavImportFinishedEvent {
                success: true,
                message: None,
            },
            ResultPayload::Err { error } => WebDavImportFinishedEvent {
                success: false,
                message: Some(error.message),
            },
        };

        let _ = app.emit(BACKUP_WEBDAV_IMPORT_FINISHED_EVENT, payload);
        WEBDAV_IMPORT_RUNNING.store(false, Ordering::SeqCst);
    });

    ok((), trace)
}

#[tauri::command]
pub async fn start_export_settings_backup_to_webdav(
    app: AppHandle,
    url: String,
    username: String,
    password: String,
    remote_path: String,
    scope_settings: BackupScopeSettingsCfg,
    document_roots: Vec<String>,
    user_agent: Option<String>,
) -> ResultPayload<()> {
    let trace = new_trace_id();

    if WEBDAV_EXPORT_RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return err_payload(
            ErrorCode::CONFLICT,
            "已有 WebDAV 上传任务正在后台运行".to_string(),
            trace,
        );
    }

    let _ = app.emit(BACKUP_WEBDAV_EXPORT_STARTED_EVENT, ());

    tauri::async_runtime::spawn(async move {
        let payload = match export_settings_backup_to_webdav(
            app.clone(),
            url,
            username,
            password,
            remote_path,
            scope_settings,
            document_roots,
            user_agent,
        )
        .await
        {
            ResultPayload::Ok { data, .. } => WebDavExportFinishedEvent {
                success: true,
                message: None,
                no_uploads: data.uploaded_files == 0 && data.deleted_files == 0,
                summary: Some(data),
            },
            ResultPayload::Err { error } => WebDavExportFinishedEvent {
                success: false,
                message: Some(error.message),
                summary: None,
                no_uploads: false,
            },
        };

        let _ = app.emit(BACKUP_WEBDAV_EXPORT_FINISHED_EVENT, payload);
        WEBDAV_EXPORT_RUNNING.store(false, Ordering::SeqCst);
    });

    ok((), trace)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(path: &str, size: u64, modified: u64, sha256: &str) -> WebDavSyncFileEntry {
        WebDavSyncFileEntry {
            path: path.to_string(),
            size,
            modified,
            sha256: sha256.to_string(),
        }
    }

    #[test]
    fn should_normalize_legacy_sync_index() {
        let normalized =
            normalize_remote_sync_index(WebDavSyncIndexCompat::V1(WebDavSyncIndexV1 {
                version: 1,
                files: vec![
                    "skills/hello-skill/skill.json".to_string(),
                    "notes/demo.md".to_string(),
                ],
            }));

        assert_eq!(normalized.version, 1);
        assert_eq!(normalized.files.len(), 2);
        assert_eq!(normalized.files[0].path, "skills/hello-skill/skill.json");
        assert_eq!(normalized.files[0].size, 0);
        assert_eq!(normalized.files[0].modified, 0);
        assert!(normalized.files[0].sha256.is_empty());
    }

    #[test]
    fn should_include_search_index_in_backup_scope() {
        assert!(!should_include_backup_relative(Path::new(
            "search_index.sqlite3"
        )));
        assert!(!should_include_backup_relative(Path::new(
            "nested/search_index.sqlite3"
        )));
        assert!(should_include_backup_relative(Path::new(
            "editor_settings.json"
        )));
    }

    #[test]
    fn should_skip_alarm_sounds_in_config_backup_scope() {
        assert!(should_skip_config_backup_relative(Path::new(
            "alarm/sounds/beep.mp3"
        )));
        assert!(should_skip_config_backup_relative(Path::new(
            "alarm/sounds/nested/tone.wav"
        )));
        assert!(!should_skip_config_backup_relative(Path::new(
            "alarm/alarm_rules.json"
        )));
    }

    #[test]
    fn should_reuse_local_directory_cache_for_unchanged_tree() {
        let root = backup_temp_dir("haomd-webdav-local-index-cache").unwrap();
        let nested = root.join("nested");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(root.join("a.txt"), b"hello").unwrap();
        std::fs::write(nested.join("b.txt"), b"world").unwrap();

        let (first_dirs, first_index, cache_root) =
            build_local_sync_index(&root, None, None, None).unwrap();
        let (second_dirs, second_index, second_cache_root) =
            build_local_sync_index(&root, None, Some(&cache_root), None).unwrap();

        assert_eq!(first_dirs, second_dirs);
        assert_eq!(first_index.files, second_index.files);
        assert_eq!(cache_root.files, second_cache_root.files);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn should_upload_all_files_when_remote_index_missing() {
        let local = WebDavSyncIndex {
            version: 2,
            files: vec![
                entry("skills/a.json", 10, 100, "aaa"),
                entry("skills/b.json", 20, 200, "bbb"),
            ],
        };

        let plan = build_sync_plan(&local, None);

        assert_eq!(plan.upload.len(), 2);
        assert!(plan.keep.is_empty());
    }

    #[test]
    fn should_skip_unchanged_files_and_upload_changed_files() {
        let local = WebDavSyncIndex {
            version: 2,
            files: vec![
                entry("skills/a.json", 10, 100, "aaa"),
                entry("skills/b.json", 20, 200, "bbb-new"),
                entry("skills/c.json", 30, 300, "ccc"),
            ],
        };
        let remote = WebDavSyncIndex {
            version: 2,
            files: vec![
                entry("skills/a.json", 10, 100, "aaa"),
                entry("skills/b.json", 20, 200, "bbb-old"),
            ],
        };

        let plan = build_sync_plan(&local, Some(&remote));

        assert_eq!(plan.keep, vec![entry("skills/a.json", 10, 100, "aaa")]);
        assert!(plan.delete.is_empty());
        assert_eq!(
            plan.upload,
            vec![
                entry("skills/b.json", 20, 200, "bbb-new"),
                entry("skills/c.json", 30, 300, "ccc"),
            ]
        );
    }

    #[test]
    fn should_mark_remote_orphans_for_deletion() {
        let local = WebDavSyncIndex {
            version: 2,
            files: vec![entry("skills/a.json", 10, 100, "aaa")],
        };
        let remote = WebDavSyncIndex {
            version: 2,
            files: vec![
                entry("skills/a.json", 10, 100, "aaa"),
                entry("skills/old.json", 99, 999, "old"),
            ],
        };

        let plan = build_sync_plan(&local, Some(&remote));

        assert_eq!(plan.keep, vec![entry("skills/a.json", 10, 100, "aaa")]);
        assert!(plan.upload.is_empty());
        assert_eq!(plan.delete, vec![entry("skills/old.json", 99, 999, "old")]);
    }
}
