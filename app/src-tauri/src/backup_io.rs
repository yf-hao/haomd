use crate::{err_payload, new_trace_id, ok, ErrorCode, ResultPayload};
use reqwest::StatusCode;
use reqwest::{Client, Method};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{Cursor, Read, Seek, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use url::Url;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

const WEBDAV_SYNC_INDEX_FILE: &str = ".haomd-sync-index.json";

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

    Ok((base.to_string().trim_end_matches('/').to_string(), remote_root))
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

fn webdav_request(client: &Client, method: Method, target: &str, username: &str, password: &str) -> reqwest::RequestBuilder {
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
        let response = webdav_request(client, Method::from_bytes(b"MKCOL").unwrap(), &target, username, password)
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
    for entry in std::fs::read_dir(path).map_err(|err| format!("读取本地配置目录失败: {err}"))? {
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
            .to_string_lossy()
            .replace('\\', "/");

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
    files: Vec<String>,
}

async fn upload_directory_to_webdav(
    root: &Path,
    base_url: &str,
    username: &str,
    password: &str,
    remote_root: &str,
) -> Result<(), String> {
    let client = Client::new();
    ensure_remote_dir(&client, base_url, username, password, "", remote_root).await?;

    let mut dirs = Vec::new();
    let mut files = Vec::new();
    collect_local_entries(root, root, &mut dirs, &mut files)?;
    dirs.sort();
    files.sort_by(|a, b| a.0.cmp(&b.0));

    for dir in dirs {
        ensure_remote_dir(&client, base_url, username, password, remote_root, &dir).await?;
    }

    let file_paths = files.iter().map(|(relative, _)| relative.clone()).collect::<Vec<_>>();

    for (relative, path) in &files {
        let target = resolve_webdav_url(base_url, &join_remote_relative(remote_root, &relative));
        let bytes = std::fs::read(path).map_err(|err| format!("读取本地文件失败 {relative}: {err}"))?;
        let response = webdav_request(&client, Method::PUT, &target, username, password)
            .body(bytes)
            .send()
            .await
            .map_err(|err| format!("上传文件失败 {relative}: {err}"))?;

        if !response.status().is_success() {
            return Err(format!("上传文件失败 {relative}: HTTP {}", response.status()));
        }
    }

    let index = WebDavSyncIndex {
        version: 1,
        files: file_paths,
    };
    let index_bytes = serde_json::to_vec_pretty(&index)
        .map_err(|err| format!("构建 WebDAV 同步索引失败: {err}"))?;
    let index_target = resolve_webdav_url(
        base_url,
        &join_remote_relative(remote_root, WEBDAV_SYNC_INDEX_FILE),
    );
    let response = webdav_request(&client, Method::PUT, &index_target, username, password)
        .header(reqwest::header::CONTENT_TYPE, "application/json; charset=utf-8")
        .body(index_bytes)
        .send()
        .await
        .map_err(|err| format!("上传同步索引失败: {err}"))?;

    if !response.status().is_success() {
        return Err(format!("上传同步索引失败: HTTP {}", response.status()));
    }

    Ok(())
}

async fn download_directory_from_webdav(
    root: &Path,
    base_url: &str,
    username: &str,
    password: &str,
    remote_root: &str,
) -> Result<(), String> {
    let client = Client::new();
    let index_url = resolve_webdav_url(
        base_url,
        &join_remote_relative(remote_root, WEBDAV_SYNC_INDEX_FILE),
    );
    let response = webdav_request(&client, Method::GET, &index_url, username, password)
        .send()
        .await
        .map_err(|err| format!("读取同步索引失败: {err}"))?;

    if !response.status().is_success() {
        return Err(format!("读取同步索引失败: HTTP {}", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|err| format!("读取同步索引失败: {err}"))?;
    let index: WebDavSyncIndex =
        serde_json::from_slice(&bytes).map_err(|err| format!("解析同步索引失败: {err}"))?;

    for relative in index.files {
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

        let out_path = root.join(relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&out_path)
                .map_err(|err| format!("创建恢复目录失败: {err}"))?;
            continue;
        }

        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|err| format!("创建恢复目录失败: {err}"))?;
        }

        let mut output =
            File::create(&out_path).map_err(|err| format!("创建恢复文件失败: {err}"))?;
        std::io::copy(&mut entry, &mut output)
            .map_err(|err| format!("写入恢复文件失败: {err}"))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn export_settings_backup(
    app: AppHandle,
    output_path: String,
) -> ResultPayload<()> {
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
) -> ResultPayload<()> {
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
        Ok(()) => ok((), trace),
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
        Ok(resp) if resp.status().is_success() || resp.status() == StatusCode::METHOD_NOT_ALLOWED => {
            ok((), trace)
        }
        Ok(resp) if resp.status() == StatusCode::UNAUTHORIZED => err_payload(
            ErrorCode::UNKNOWN,
            "HTTP 401 Unauthorized".to_string(),
            trace,
        ),
        Ok(resp) if resp.status() == StatusCode::FORBIDDEN => err_payload(
            ErrorCode::UNKNOWN,
            "HTTP 403 Forbidden".to_string(),
            trace,
        ),
        Ok(resp) => err_payload(
            ErrorCode::UNKNOWN,
            format!("HTTP {}", resp.status()),
            trace,
        ),
        Err(err) => err_payload(
            ErrorCode::UNKNOWN,
            err.to_string(),
            trace,
        ),
    }
}

#[tauri::command]
pub async fn import_settings_backup(
    app: AppHandle,
    backup_path: String,
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

    match download_directory_from_webdav(&root, &base_url, &username, &password, &remote_root).await {
        Ok(()) => ok((), trace),
        Err(message) => err_payload(ErrorCode::UNKNOWN, message, trace),
    }
}
