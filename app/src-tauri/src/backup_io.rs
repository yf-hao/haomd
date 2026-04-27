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
use tauri::{AppHandle, Emitter, Manager};
use url::Url;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

const WEBDAV_SYNC_INDEX_FILE: &str = ".haomd-sync-index.json";
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

fn backup_root_dir(app: &AppHandle) -> std::io::Result<PathBuf> {
    if let Ok(mut dir) = app.path().config_dir() {
        dir.push("haomd");
        std::fs::create_dir_all(&dir)?;
        Ok(dir)
    } else {
        let mut dir = std::env::current_dir()?;
        dir.push("haomd");
        std::fs::create_dir_all(&dir)?;
        Ok(dir)
    }
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

        if !should_include_backup_relative(&relative) {
            continue;
        }

        let relative = relative.to_string_lossy().replace('\\', "/");

        if entry_path.is_dir() {
            dirs.push(relative.clone());
            collect_local_entries(root, &entry_path, dirs, files)?;
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

fn build_local_sync_index(root: &Path) -> Result<(Vec<String>, WebDavSyncIndex), String> {
    let mut dirs = Vec::new();
    let mut files = Vec::new();
    collect_local_entries(root, root, &mut dirs, &mut files)?;
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
) -> Result<WebDavBackupUploadSummary, String> {
    let client = Client::new();
    ensure_remote_dir(&client, base_url, username, password, "", remote_root).await?;

    let (dirs, local_index) = build_local_sync_index(root)?;
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
) -> Result<(), String> {
    let client = Client::new();
    let index = fetch_remote_sync_index(&client, base_url, username, password, remote_root)
        .await?
        .ok_or_else(|| "读取同步索引失败: 远端未找到索引文件".to_string())?;

    for entry in index.files {
        let relative = entry.path;
        if !should_include_backup_relative(Path::new(&relative)) {
            continue;
        }
        let local_path = root.join(&relative);
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
    if !should_include_backup_relative(relative) {
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

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|err| format!("读取备份条目失败: {err}"))?;

        let relative = match entry.enclosed_name() {
            Some(path) => path.to_path_buf(),
            None => continue,
        };
        if !should_include_backup_relative(&relative) {
            continue;
        }

        let out_path = root.join(relative);
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
pub async fn export_settings_backup(app: AppHandle, output_path: String) -> ResultPayload<()> {
    let trace = new_trace_id();
    let root = match backup_root_dir(&app) {
        Ok(dir) => dir,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取备份根目录失败: {err}"),
                trace,
            )
        }
    };

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

    match build_backup_zip_bytes(&root) {
        Ok(bytes) => match std::fs::write(&output, bytes) {
            Ok(()) => ok((), trace),
            Err(err) => err_payload(
                ErrorCode::IoError,
                format!("写入备份文件失败: {err}"),
                trace,
            ),
        },
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
) -> ResultPayload<WebDavBackupUploadSummary> {
    let trace = new_trace_id();
    let root = match backup_root_dir(&app) {
        Ok(dir) => dir,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取备份根目录失败: {err}"),
                trace,
            )
        }
    };
    let (base_url, remote_root) = match resolve_webdav_sync_target(&url, &remote_path) {
        Ok(value) => value,
        Err(message) => return err_payload(ErrorCode::UNKNOWN, message, trace),
    };

    match upload_directory_to_webdav(&root, &base_url, &username, &password, &remote_root).await {
        Ok(summary) => ok(summary, trace),
        Err(message) => err_payload(ErrorCode::UNKNOWN, message, trace),
    }
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

    match download_directory_from_webdav(&root, &base_url, &username, &password, &remote_root).await
    {
        Ok(()) => ok((), trace),
        Err(message) => err_payload(ErrorCode::UNKNOWN, message, trace),
    }
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
        assert!(should_include_backup_relative(Path::new("search_index.sqlite3")));
        assert!(should_include_backup_relative(Path::new(
            "nested/search_index.sqlite3"
        )));
        assert!(should_include_backup_relative(Path::new("editor_settings.json")));
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
