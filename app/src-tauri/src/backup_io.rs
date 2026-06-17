use crate::backup_scope::BackupScopeSettingsCfg;
use crate::haomd_paths::{haomd_config_root_dir, haomd_data_root_dir};
use crate::notes_config::notes_config_path;
use crate::{err_payload, new_trace_id, ok, ErrorCode, ResultPayload};
use once_cell::sync::Lazy;
use reqwest::StatusCode;
use reqwest::{Client, Method};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{Cursor, Read, Seek, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Emitter};
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
];
const BACKUP_WEBDAV_IMPORT_STARTED_EVENT: &str = "backup://webdav_import_started";
const BACKUP_WEBDAV_IMPORT_FINISHED_EVENT: &str = "backup://webdav_import_finished";
const BACKUP_WEBDAV_EXPORT_STARTED_EVENT: &str = "backup://webdav_export_started";
const BACKUP_WEBDAV_EXPORT_FINISHED_EVENT: &str = "backup://webdav_export_finished";
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
pub struct WebDavExportFinishedEvent {
    pub success: bool,
    pub message: Option<String>,
    pub summary: Option<WebDavBackupUploadSummary>,
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

fn backup_root_dir(app: &AppHandle) -> std::io::Result<PathBuf> {
    haomd_config_root_dir(app)
}

fn backup_temp_dir(prefix: &str) -> std::io::Result<PathBuf> {
    let dir = std::env::temp_dir().join(format!(
        "{prefix}-{}",
        new_trace_id().replace("trace_", "")
    ));
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

    std::fs::create_dir_all(target_dir)
        .map_err(|err| format!("创建备份暂存目录失败: {err}"))?;

    for entry in std::fs::read_dir(source_dir)
        .map_err(|err| format!("读取备份来源目录失败: {err}"))?
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
    let path = notes_config_path(app).map_err(|err| format!("获取 notes_config 路径失败: {err}"))?;
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(format!("读取 notes_config 失败: {err}")),
    };

    let config: crate::notes_config::NotesConfigData = serde_json::from_slice(&bytes)
        .map_err(|err| format!("解析 notes_config 失败: {err}"))?;
    let Some(notes_directory) = config.notes_directory.as_deref() else {
        return Ok(None);
    };
    let target = expand_tilde_path(notes_directory);
    if target.as_os_str().is_empty() {
        return Ok(None);
    }
    Ok(Some(target))
}

fn build_backup_manifest(app: &AppHandle, scope_settings: &BackupScopeSettingsCfg) -> Result<BackupManifest, String> {
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

    Ok(BackupManifest {
        version: 1,
        scopes,
    })
}

fn build_document_root_entries(document_roots: &[String]) -> Vec<DocumentRootIndexEntry> {
    document_roots
        .iter()
        .filter_map(|root| {
            let path = PathBuf::from(root.trim());
            if path.as_os_str().is_empty() {
                return None;
            }
            Some(DocumentRootIndexEntry {
                id: encode_path_key(&path),
                target_path: normalize_path_key(&path),
            })
        })
        .collect()
}

async fn build_backup_package(
    app: &AppHandle,
    scope_settings: &BackupScopeSettingsCfg,
    document_roots: &[String],
) -> Result<BackupPackage, String> {
    let config_root = backup_root_dir(app).map_err(|err| format!("获取备份根目录失败: {err}"))?;
    let temp_dir = backup_temp_dir("haomd-backup")
        .map_err(|err| format!("创建备份暂存目录失败: {err}"))?;
    let package_root = temp_dir.clone();
    let result = (|| -> Result<BackupPackage, String> {
        copy_tree_contents(
            &config_root,
            &config_root,
            &package_root,
            Some(is_config_backup_artifact),
        )?;

        let mut manifest = build_backup_manifest(app, &scope_settings)?;

        if scope_settings.documents {
            let mut document_scopes = Vec::new();
            for (index, root) in document_roots.iter().enumerate() {
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

fn restore_target_for_relative(
    relative: &Path,
    config_root: &Path,
    manifest: Option<&BackupManifest>,
) -> PathBuf {
    if let Some(manifest) = manifest {
        let mut scopes = manifest.scopes.iter().collect::<Vec<_>>();
        scopes.sort_by(|a, b| b.stage_path.len().cmp(&a.stage_path.len()));
        for scope in scopes {
            let stage_path = Path::new(&scope.stage_path);
            if !relative.starts_with(stage_path) {
                continue;
            }
            let target_root = PathBuf::from(&scope.target_path);
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

fn read_manifest_from_zip<R: Read + Seek>(archive: &mut ZipArchive<R>) -> Result<Option<BackupManifest>, String> {
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
    match relative.file_name().and_then(|name| name.to_str()) {
        Some(name) => !EXCLUDED_BACKUP_FILE_NAMES.contains(&name),
        None => true,
    }
}

fn should_skip_config_backup_relative(relative: &Path) -> bool {
    relative.starts_with(Path::new("music"))
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

fn collect_local_entries(
    root: &Path,
    path: &Path,
    dirs: &mut Vec<String>,
    files: &mut Vec<(String, PathBuf)>,
    skip_relative: Option<fn(&Path) -> bool>,
) -> Result<(), String> {
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

        let relative = relative.to_string_lossy().replace('\\', "/");

        if entry_path.is_dir() {
            dirs.push(relative.clone());
            collect_local_entries(root, &entry_path, dirs, files, skip_relative)?;
        } else if entry_path.is_file() {
            files.push((relative, entry_path));
        }
    }

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

fn build_local_sync_index(
    root: &Path,
    skip_relative: Option<fn(&Path) -> bool>,
) -> Result<(Vec<String>, WebDavSyncIndex), String> {
    let mut dirs = Vec::new();
    let mut files = Vec::new();
    collect_local_entries(root, root, &mut dirs, &mut files, skip_relative)?;
    dirs.sort();
    files.sort_by(|a, b| a.0.cmp(&b.0));

    let file_entries = files
        .into_iter()
        .map(|(relative, path)| {
            let bytes = std::fs::read(&path)
                .map_err(|err| format!("读取本地文件失败 {relative}: {err}"))?;
            let metadata = std::fs::metadata(&path)
                .map_err(|err| format!("读取本地文件元数据失败 {relative}: {err}"))?;

            Ok(WebDavSyncFileEntry {
                path: relative,
                size: metadata.len(),
                modified: metadata_modified_secs(&metadata)?,
                sha256: sha256_hex(&bytes),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;

    Ok((
        dirs,
        WebDavSyncIndex {
            version: 2,
            files: file_entries,
        },
    ))
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
    let index: WebDavSyncIndexCompat =
        serde_json::from_slice(&bytes).map_err(|err| format!("解析同步索引失败: {err}"))?;
    Ok(Some(normalize_remote_sync_index(index)))
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

fn build_remote_prefix(remote_root: &str, prefix: &str) -> String {
    if prefix.is_empty() {
        remote_root.to_string()
    } else if remote_root.is_empty() {
        prefix.to_string()
    } else {
        format!("{remote_root}/{prefix}")
    }
}

async fn sync_directory_to_webdav(
    root: &Path,
    base_url: &str,
    username: &str,
    password: &str,
    remote_root: &str,
    skip_relative: Option<fn(&Path) -> bool>,
) -> Result<WebDavBackupUploadSummary, String> {
    upload_directory_to_webdav(root, base_url, username, password, remote_root, skip_relative).await
}

async fn delete_scope_remote_tree(
    base_url: &str,
    username: &str,
    password: &str,
    remote_root: &str,
) -> Result<(), String> {
    let client = Client::new();
    let Some(index) = fetch_remote_sync_index(&client, base_url, username, password, remote_root).await? else {
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
) -> Result<Option<DocumentRootIndex>, String> {
    let client = Client::new();
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
) -> Result<(), String> {
    let client = Client::new();
    let remote_prefix = build_remote_prefix(remote_root, "documents");
    let target = resolve_webdav_url(
        base_url,
        &join_remote_relative(&remote_prefix, ".haomd-root-index.json"),
    );
    let bytes = serde_json::to_vec_pretty(index)
        .map_err(|err| format!("序列化文档根索引失败: {err}"))?;
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

async fn sync_single_scope_to_webdav(
    local_root: &Path,
    base_url: &str,
    username: &str,
    password: &str,
    remote_root: &str,
    skip_relative: Option<fn(&Path) -> bool>,
) -> Result<WebDavBackupUploadSummary, String> {
    sync_directory_to_webdav(local_root, base_url, username, password, remote_root, skip_relative).await
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
    root: &Path,
    base_url: &str,
    username: &str,
    password: &str,
    remote_root: &str,
    skip_relative: Option<fn(&Path) -> bool>,
) -> Result<WebDavBackupUploadSummary, String> {
    let client = Client::new();
    ensure_remote_dir(&client, base_url, username, password, "", remote_root).await?;

    let (dirs, local_index) = build_local_sync_index(root, skip_relative)?;
    let remote_index =
        fetch_remote_sync_index(&client, base_url, username, password, remote_root).await?;
    let sync_plan = build_sync_plan(&local_index, remote_index.as_ref());

    for dir in dirs {
        ensure_remote_dir(&client, base_url, username, password, remote_root, &dir).await?;
    }

    let skipped_file_count = sync_plan.keep.len();
    let uploaded_file_count = sync_plan.upload.len();
    let deleted_file_count = sync_plan.delete.len();

    for entry in &sync_plan.upload {
        let relative = &entry.path;
        let path = root.join(relative);
        let target = resolve_webdav_url(base_url, &join_remote_relative(remote_root, relative));
        let bytes =
            std::fs::read(&path).map_err(|err| format!("读取本地文件失败 {relative}: {err}"))?;
        let response = webdav_request(&client, Method::PUT, &target, username, password)
            .body(bytes)
            .send()
            .await
            .map_err(|err| format!("上传文件失败 {relative}: {err}"))?;

        if !response.status().is_success() {
            return Err(format!(
                "上传文件失败 {relative}: HTTP {}",
                response.status()
            ));
        }
    }

    for entry in &sync_plan.delete {
        let relative = &entry.path;
        let target = resolve_webdav_url(base_url, &join_remote_relative(remote_root, relative));
        let response = webdav_request(&client, Method::DELETE, &target, username, password)
            .send()
            .await
            .map_err(|err| format!("删除远端文件失败 {relative}: {err}"))?;

        if !(response.status().is_success() || response.status() == StatusCode::NOT_FOUND) {
            return Err(format!(
                "删除远端文件失败 {relative}: HTTP {}",
                response.status()
            ));
        }
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
    root: &Path,
    base_url: &str,
    username: &str,
    password: &str,
    remote_root: &str,
    skip_relative: Option<fn(&Path) -> bool>,
) -> Result<(), String> {
    let client = Client::new();
    let index = fetch_remote_sync_index(&client, base_url, username, password, remote_root)
        .await?
        .ok_or_else(|| "读取同步索引失败: 远端未找到索引文件".to_string())?;
    let manifest = fetch_remote_manifest(&client, base_url, username, password, remote_root).await?;

    for entry in index.files {
        let relative = entry.path;
        if relative == BACKUP_MANIFEST_FILE {
            continue;
        }
        let relative_path = Path::new(&relative);
        if !matches_backup_scope(relative_path, manifest.as_ref())
            && skip_relative.is_some_and(|predicate| predicate(relative_path))
        {
            continue;
        }
        let local_path = restore_target_for_relative(relative_path, root, manifest.as_ref());
        if let Some(parent) = local_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|err| format!("创建本地恢复目录失败 {relative}: {err}"))?;
        }
        let file_url = resolve_webdav_url(base_url, &join_remote_relative(remote_root, &relative));
        let resp = webdav_request(&client, Method::GET, &file_url, username, password)
            .send()
            .await
            .map_err(|err| format!("下载文件失败 {relative}: {err}"))?;

        if !resp.status().is_success() {
            return Err(format!("下载文件失败 {relative}: HTTP {}", resp.status()));
        }

        let bytes = resp
            .bytes()
            .await
            .map_err(|err| format!("读取文件内容失败 {relative}: {err}"))?;
        std::fs::write(&local_path, &bytes)
            .map_err(|err| format!("写入本地恢复文件失败 {relative}: {err}"))?;
    }

    Ok(())
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

fn restore_backup_from_reader<R: Read + Seek>(reader: R, root: &Path) -> Result<(), String> {
    let mut archive =
        ZipArchive::new(reader).map_err(|err| format!("读取备份压缩包失败: {err}"))?;
    let manifest = read_manifest_from_zip(&mut archive)?;

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

        let out_path = restore_target_for_relative(&relative, root, manifest.as_ref());
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

    Ok(())
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
) -> ResultPayload<WebDavBackupUploadSummary> {
    let trace = new_trace_id();
    let (base_url, remote_root) = match resolve_webdav_sync_target(&url, &remote_path) {
        Ok(value) => value,
        Err(message) => return err_payload(ErrorCode::UNKNOWN, message, trace),
    };
    let mut total_files = 0usize;
    let mut uploaded_files = 0usize;
    let mut skipped_files = 0usize;
    let mut deleted_files = 0usize;
    let mut incremental = false;

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
    match sync_single_scope_to_webdav(
        &config_root,
        &base_url,
        &username,
        &password,
        &remote_root,
        Some(should_skip_config_backup_relative),
    )
    .await
    {
        Ok(summary) => {
            total_files += summary.total_files;
            uploaded_files += summary.uploaded_files;
            skipped_files += summary.skipped_files;
            deleted_files += summary.deleted_files;
            incremental |= summary.incremental;
        }
        Err(message) => return err_payload(ErrorCode::UNKNOWN, message, trace),
    }

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
            let music_remote_root = build_remote_prefix(&remote_root, "music");
            match sync_single_scope_to_webdav(
                &music_root,
                &base_url,
                &username,
                &password,
                &music_remote_root,
                None,
            )
            .await
            {
                Ok(summary) => {
                    total_files += summary.total_files;
                    uploaded_files += summary.uploaded_files;
                    skipped_files += summary.skipped_files;
                    deleted_files += summary.deleted_files;
                    incremental |= summary.incremental;
                }
                Err(message) => return err_payload(ErrorCode::UNKNOWN, message, trace),
            }
        }
    }

    if scope_settings.notes {
        let notes_root = match read_notes_directory(&app) {
            Ok(Some(dir)) => dir,
            Ok(None) => PathBuf::new(),
            Err(message) => return err_payload(ErrorCode::UNKNOWN, message, trace),
        };
        if notes_root.exists() {
            let notes_remote_root = build_remote_prefix(&remote_root, "notes");
            match sync_single_scope_to_webdav(
                &notes_root,
                &base_url,
                &username,
                &password,
                &notes_remote_root,
                None,
            )
            .await
            {
                Ok(summary) => {
                    total_files += summary.total_files;
                    uploaded_files += summary.uploaded_files;
                    skipped_files += summary.skipped_files;
                    deleted_files += summary.deleted_files;
                    incremental |= summary.incremental;
                }
                Err(message) => return err_payload(ErrorCode::UNKNOWN, message, trace),
            }
        }
    }

    if scope_settings.documents {
        let current_entries = build_document_root_entries(&document_roots);
        let current_ids = current_entries
            .iter()
            .map(|entry| entry.id.clone())
            .collect::<std::collections::HashSet<_>>();
        let remote_index = match load_document_root_index(&base_url, &username, &password, &remote_root).await {
            Ok(index) => index,
            Err(message) => return err_payload(ErrorCode::UNKNOWN, message, trace),
        };

        if let Some(remote_index) = remote_index.as_ref() {
            incremental = true;
            for entry in &remote_index.roots {
                if current_ids.contains(&entry.id) {
                    continue;
                }
                let stale_remote_root = build_remote_prefix(
                    &build_remote_prefix(&remote_root, "documents"),
                    &entry.id,
                );
                if let Err(message) =
                    delete_scope_remote_tree(&base_url, &username, &password, &stale_remote_root).await
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
            let docs_remote_root = build_remote_prefix(
                &build_remote_prefix(&remote_root, "documents"),
                &entry.id,
            );
            match sync_single_scope_to_webdav(
                &local_root,
                &base_url,
                &username,
                &password,
                &docs_remote_root,
                None,
            )
            .await
            {
                Ok(summary) => {
                    total_files += summary.total_files;
                    uploaded_files += summary.uploaded_files;
                    skipped_files += summary.skipped_files;
                    deleted_files += summary.deleted_files;
                    incremental |= summary.incremental;
                }
                Err(message) => return err_payload(ErrorCode::UNKNOWN, message, trace),
            }
        }

        if let Err(message) = save_document_root_index(
            &base_url,
            &username,
            &password,
            &remote_root,
            &DocumentRootIndex {
                version: 1,
                roots: current_entries,
            },
        )
        .await
        {
            return err_payload(ErrorCode::UNKNOWN, message, trace);
        }
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

    let client = Client::new();
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

#[tauri::command]
pub async fn import_settings_backup(app: AppHandle, backup_path: String) -> ResultPayload<()> {
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

    match restore_backup_from_reader(file, &root) {
        Ok(()) => ok((), trace),
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
    let (base_url, remote_root) = match resolve_webdav_sync_target(&url, &remote_path) {
        Ok(value) => value,
        Err(message) => return err_payload(ErrorCode::UNKNOWN, message, trace),
    };

    if let Err(message) = download_directory_from_webdav(
        &root,
        &base_url,
        &username,
        &password,
        &remote_root,
        Some(should_skip_config_backup_relative),
    )
    .await
    {
        return err_payload(ErrorCode::UNKNOWN, message, trace);
    }

    let music_remote_root = build_remote_prefix(&remote_root, "music");
    let music_root = match crate::music_paths::ensure_music_root_dir(&app).await {
        Ok(dir) => dir,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取 music 目录失败: {err}"),
                trace,
            )
        }
    };
        if let Err(message) =
            download_directory_from_webdav(&music_root, &base_url, &username, &password, &music_remote_root, None).await
        {
            return err_payload(ErrorCode::UNKNOWN, message, trace);
        }

    if let Ok(Some(notes_root)) = read_notes_directory(&app) {
        let notes_remote_root = build_remote_prefix(&remote_root, "notes");
        if let Err(message) =
            download_directory_from_webdav(&notes_root, &base_url, &username, &password, &notes_remote_root, None).await
        {
            return err_payload(ErrorCode::UNKNOWN, message, trace);
        }
    }

    if let Ok(Some(index)) = load_document_root_index(&base_url, &username, &password, &remote_root).await {
        let docs_remote_root = build_remote_prefix(&remote_root, "documents");
        for entry in index.roots {
            if let Some(target_root) = decode_path_key(&entry.id) {
                let scope_remote_root = build_remote_prefix(&docs_remote_root, &entry.id);
                if let Err(message) =
                    download_directory_from_webdav(&target_root, &base_url, &username, &password, &scope_remote_root, None).await
                {
                    return err_payload(ErrorCode::UNKNOWN, message, trace);
                }
            }
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
        )
        .await
        {
            ResultPayload::Ok { data, .. } => WebDavExportFinishedEvent {
                success: true,
                message: None,
                summary: Some(data),
            },
            ResultPayload::Err { error } => WebDavExportFinishedEvent {
                success: false,
                message: Some(error.message),
                summary: None,
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
        assert!(should_include_backup_relative(Path::new(
            "search_index.sqlite3"
        )));
        assert!(should_include_backup_relative(Path::new(
            "nested/search_index.sqlite3"
        )));
        assert!(should_include_backup_relative(Path::new(
            "editor_settings.json"
        )));
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
