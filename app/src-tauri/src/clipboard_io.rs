use crate::{err_payload, new_trace_id, normalize_path, ok, ErrorCode, ResultPayload};
use arboard::Clipboard;
use chrono::Local;
use futures_util::{stream, StreamExt};
use image::{DynamicImage, ImageBuffer, ImageFormat, Rgba};
use once_cell::sync::Lazy;
use rand::{distributions::Alphanumeric, Rng};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::path::Path;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use url::Url;

static CLIPBOARD_IMAGE_SAVE_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));
const REMOTE_IMAGE_DOWNLOAD_CONCURRENCY: usize = 3;
const MAX_REMOTE_IMAGE_COUNT: usize = 100;
const MAX_REMOTE_IMAGE_BYTES: u64 = 25 * 1024 * 1024;

/// Windows fallback: read CF_DIBV5 or CF_DIB from clipboard directly via Win32 API.
/// Many screenshot tools (Snipaste, PixPin, QQ, etc.) write DIBV5 format which arboard may not read.
#[cfg(target_os = "windows")]
fn try_read_clipboard_dib() -> Option<arboard::ImageData<'static>> {
    use windows::Win32::Foundation::{HGLOBAL, HWND};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
    };
    use windows::Win32::System::Memory::{GlobalLock, GlobalUnlock};

    unsafe {
        let format = if IsClipboardFormatAvailable(17u32).is_ok() {
            17u32 // CF_DIBV5
        } else if IsClipboardFormatAvailable(8u32).is_ok() {
            8u32 // CF_DIB
        } else {
            log::info!("[tauri] try_read_clipboard_dib: no DIB format available");
            return None;
        };

        log::info!("[tauri] try_read_clipboard_dib: format={}", format);

        if OpenClipboard(HWND(std::ptr::null_mut())).is_err() {
            log::warn!("[tauri] try_read_clipboard_dib: OpenClipboard failed");
            return None;
        }

        let handle = match GetClipboardData(format) {
            Ok(h) => h,
            Err(e) => {
                log::warn!(
                    "[tauri] try_read_clipboard_dib: GetClipboardData failed: {:?}",
                    e
                );
                CloseClipboard();
                return None;
            }
        };

        let ptr = GlobalLock(HGLOBAL(handle.0));
        if ptr.is_null() {
            log::warn!("[tauri] try_read_clipboard_dib: GlobalLock returned null");
            CloseClipboard();
            return None;
        }

        // BITMAPINFOHEADER fields (first 40 bytes shared by all DIB headers)
        let header_size = std::ptr::read(ptr as *const u32);
        let width = std::ptr::read((ptr as *const u8).add(4) as *const i32);
        let height = std::ptr::read((ptr as *const u8).add(8) as *const i32);
        let planes = std::ptr::read((ptr as *const u8).add(12) as *const u16);
        let bit_count = std::ptr::read((ptr as *const u8).add(14) as *const u16);
        let compression = std::ptr::read((ptr as *const u8).add(16) as *const u32);

        log::info!(
            "[tauri] try_read_clipboard_dib: header_size={} width={} height={} planes={} bit_count={} compression={}",
            header_size, width, height, planes, bit_count, compression
        );

        if planes != 1 || compression != 0 || (bit_count != 24 && bit_count != 32) {
            log::warn!(
                "[tauri] try_read_clipboard_dib: unsupported format planes={} bit_count={} compression={}",
                planes, bit_count, compression
            );
            GlobalUnlock(HGLOBAL(handle.0));
            CloseClipboard();
            return None;
        }

        let abs_width = width.abs() as usize;
        let abs_height = height.abs() as usize;
        let is_top_down = height < 0;
        let bytes_per_pixel = (bit_count / 8) as usize;
        let stride = ((abs_width * bytes_per_pixel + 3) / 4) * 4;

        let pixel_data_offset = header_size as usize;
        let mut rgba = vec![0u8; abs_width * abs_height * 4];

        for row in 0..abs_height {
            let src_row = if is_top_down {
                row
            } else {
                abs_height - 1 - row
            };
            let src_ptr = (ptr as *const u8).add(pixel_data_offset + src_row * stride);

            for col in 0..abs_width {
                let src_pixel = src_ptr.add(col * bytes_per_pixel);
                let dst_idx = row * abs_width * 4 + col * 4;

                if bit_count == 32 {
                    // BGRA -> RGBA
                    rgba[dst_idx + 0] = *src_pixel.add(2); // R
                    rgba[dst_idx + 1] = *src_pixel.add(1); // G
                    rgba[dst_idx + 2] = *src_pixel.add(0); // B
                    rgba[dst_idx + 3] = *src_pixel.add(3); // A
                } else {
                    // 24-bit BGR -> RGBA
                    rgba[dst_idx + 0] = *src_pixel.add(2); // R
                    rgba[dst_idx + 1] = *src_pixel.add(1); // G
                    rgba[dst_idx + 2] = *src_pixel.add(0); // B
                    rgba[dst_idx + 3] = 255; // A
                }
            }
        }

        GlobalUnlock(HGLOBAL(handle.0));
        CloseClipboard();

        log::info!(
            "[tauri] try_read_clipboard_dib: success {}x{}",
            abs_width,
            abs_height
        );

        Some(arboard::ImageData {
            width: abs_width,
            height: abs_height,
            bytes: std::borrow::Cow::Owned(rgba),
        })
    }
}

/// Windows fast fallback: read CF_DIBV5 or CF_DIB without per-pixel BGR→RGBA conversion.
/// Returns a DynamicImage directly to avoid nested loop overhead.
#[cfg(target_os = "windows")]
unsafe fn try_read_clipboard_dib_fast() -> Option<DynamicImage> {
    use windows::Win32::Foundation::{HGLOBAL, HWND};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
    };
    use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};

    let format = if IsClipboardFormatAvailable(17u32).is_ok() {
        17u32 // CF_DIBV5
    } else if IsClipboardFormatAvailable(8u32).is_ok() {
        8u32 // CF_DIB
    } else {
        return None;
    };

    if OpenClipboard(HWND(std::ptr::null_mut())).is_err() {
        return None;
    }

    let handle = match GetClipboardData(format) {
        Ok(h) => h,
        Err(_) => {
            let _ = CloseClipboard();
            return None;
        }
    };

    let ptr = GlobalLock(HGLOBAL(handle.0));
    if ptr.is_null() {
        let _ = CloseClipboard();
        return None;
    }

    let header_size = std::ptr::read(ptr as *const u32);
    let width = std::ptr::read((ptr as *const u8).add(4) as *const i32);
    let height = std::ptr::read((ptr as *const u8).add(8) as *const i32);
    let planes = std::ptr::read((ptr as *const u8).add(12) as *const u16);
    let bit_count = std::ptr::read((ptr as *const u8).add(14) as *const u16);
    let compression = std::ptr::read((ptr as *const u8).add(16) as *const u32);

    if planes != 1 || compression != 0 || (bit_count != 24 && bit_count != 32) {
        GlobalUnlock(HGLOBAL(handle.0));
        let _ = CloseClipboard();
        return None;
    }

    let abs_width = width.abs() as u32;
    let abs_height = height.abs() as u32;
    let is_top_down = height < 0;
    let bytes_per_pixel = (bit_count / 8) as usize;
    let stride = ((abs_width as usize * bytes_per_pixel + 3) / 4) * 4;

    let pixel_data_offset = header_size as usize;
    let data_size = GlobalSize(HGLOBAL(handle.0));
    let pixel_data_size = data_size.saturating_sub(pixel_data_offset);

    let mut rgba = vec![0u8; abs_width as usize * abs_height as usize * 4];

    let src_slice =
        std::slice::from_raw_parts((ptr as *const u8).add(pixel_data_offset), pixel_data_size);

    for row in 0..abs_height as usize {
        let src_row = if is_top_down {
            row
        } else {
            abs_height as usize - 1 - row
        };
        let src_line =
            &src_slice[src_row * stride..src_row * stride + abs_width as usize * bytes_per_pixel];
        let dst_line = &mut rgba[row * abs_width as usize * 4..(row + 1) * abs_width as usize * 4];

        if bit_count == 32 {
            // DIB 32-bit = BGRA; ImageBuffer<Rgba8> expects RGBA
            for (src_pixel, dst_pixel) in src_line.chunks_exact(4).zip(dst_line.chunks_exact_mut(4))
            {
                dst_pixel[0] = src_pixel[2]; // R
                dst_pixel[1] = src_pixel[1]; // G
                dst_pixel[2] = src_pixel[0]; // B
                dst_pixel[3] = src_pixel[3]; // A
            }
        } else {
            // DIB 24-bit = BGR
            for (src_pixel, dst_pixel) in src_line.chunks_exact(3).zip(dst_line.chunks_exact_mut(4))
            {
                dst_pixel[0] = src_pixel[2]; // R
                dst_pixel[1] = src_pixel[1]; // G
                dst_pixel[2] = src_pixel[0]; // B
                dst_pixel[3] = 255; // A
            }
        }
    }

    GlobalUnlock(HGLOBAL(handle.0));
    let _ = CloseClipboard();

    let buffer = ImageBuffer::<Rgba<u8>, Vec<u8>>::from_raw(abs_width, abs_height, rgba)?;
    Some(DynamicImage::ImageRgba8(buffer))
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ClipboardImageResult {
    pub file_name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RemoteImageDownloadResult {
    pub source_url: String,
    pub file_name: Option<String>,
    pub error: Option<String>,
}

struct RemoteImageFetchResult {
    source_url: String,
    content_type: Option<String>,
    bytes: Result<Vec<u8>, String>,
}

fn sanitize_clipboard_image_base_name(name: &str) -> String {
    let sanitized: String = name
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_whitespace()
                || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
                || ch.is_control()
            {
                '_'
            } else {
                ch
            }
        })
        .collect();

    let trimmed = sanitized.trim_matches(|ch: char| ch == ' ' || ch == '.');
    if trimmed.is_empty() {
        "image".to_string()
    } else {
        trimmed.to_string()
    }
}

fn remote_image_extension(source_url: &str, content_type: Option<&str>) -> Option<String> {
    if let Some(content_type) = content_type {
        let mime = content_type
            .split(';')
            .next()
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase();
        let extension = match mime.as_str() {
            "image/jpeg" => Some("jpg"),
            "image/png" => Some("png"),
            "image/gif" => Some("gif"),
            "image/webp" => Some("webp"),
            "image/svg+xml" => Some("svg"),
            "image/avif" => Some("avif"),
            "image/bmp" => Some("bmp"),
            "image/x-icon" | "image/vnd.microsoft.icon" => Some("ico"),
            _ => None,
        };
        if let Some(extension) = extension {
            return Some(extension.to_string());
        }
        return None;
    }

    let parsed = Url::parse(source_url).ok()?;
    let extension = Path::new(parsed.path())
        .extension()?
        .to_str()?
        .to_ascii_lowercase();
    match extension.as_str() {
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "svg" | "avif" | "bmp" | "ico" => {
            Some(if extension == "jpeg" {
                "jpg".to_string()
            } else {
                extension
            })
        }
        _ => None,
    }
}

async fn fetch_remote_image(client: Client, source_url: String) -> RemoteImageFetchResult {
    let parsed_url = match Url::parse(&source_url) {
        Ok(url) if matches!(url.scheme(), "http" | "https") && url.host_str().is_some() => url,
        _ => {
            return RemoteImageFetchResult {
                source_url,
                content_type: None,
                bytes: Err("仅支持 HTTP/HTTPS 图片地址".to_string()),
            };
        }
    };

    let response = match client.get(parsed_url).send().await {
        Ok(response) => response,
        Err(error) => {
            return RemoteImageFetchResult {
                source_url,
                content_type: None,
                bytes: Err(format!("请求图片失败: {error}")),
            };
        }
    };

    if !response.status().is_success() {
        return RemoteImageFetchResult {
            source_url,
            content_type: None,
            bytes: Err(format!(
                "图片服务器返回 HTTP {}",
                response.status().as_u16()
            )),
        };
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);

    if let Some(length) = response.content_length() {
        if length > MAX_REMOTE_IMAGE_BYTES {
            return RemoteImageFetchResult {
                source_url,
                content_type,
                bytes: Err(format!(
                    "图片过大，不能超过 {} MB",
                    MAX_REMOTE_IMAGE_BYTES / 1024 / 1024
                )),
            };
        }
    }

    let bytes = match response.bytes().await {
        Ok(bytes) if bytes.len() as u64 <= MAX_REMOTE_IMAGE_BYTES => bytes.to_vec(),
        Ok(_) => {
            return RemoteImageFetchResult {
                source_url,
                content_type,
                bytes: Err(format!(
                    "图片过大，不能超过 {} MB",
                    MAX_REMOTE_IMAGE_BYTES / 1024 / 1024
                )),
            };
        }
        Err(error) => {
            return RemoteImageFetchResult {
                source_url,
                content_type,
                bytes: Err(format!("读取图片失败: {error}")),
            };
        }
    };

    if remote_image_extension(&source_url, content_type.as_deref()).is_none() {
        return RemoteImageFetchResult {
            source_url,
            content_type,
            bytes: Err("响应内容不是受支持的图片格式".to_string()),
        };
    }

    RemoteImageFetchResult {
        source_url,
        content_type,
        bytes: Ok(bytes),
    }
}

/// 下载实时编辑粘贴 HTML 中的远程图片，最多同时执行 3 个下载任务。
#[tauri::command]
pub async fn download_remote_images(
    target_dir: String,
    suggested_name: Option<String>,
    urls: Vec<String>,
) -> ResultPayload<Vec<RemoteImageDownloadResult>> {
    let trace = new_trace_id();
    if urls.len() > MAX_REMOTE_IMAGE_COUNT {
        return err_payload(
            ErrorCode::TooLarge,
            format!("一次最多下载 {} 张图片", MAX_REMOTE_IMAGE_COUNT),
            trace,
        );
    }

    let normalized_dir = match normalize_path(&target_dir) {
        Ok(path) => path,
        Err(error) => return ResultPayload::Err { error },
    };

    if let Err(error) = std::fs::create_dir_all(&normalized_dir) {
        return err_payload(
            ErrorCode::IoError,
            format!("创建图片目录失败: {error}"),
            trace,
        );
    }

    let mut unique_urls = Vec::new();
    for url in urls {
        let trimmed = url.trim();
        if !trimmed.is_empty() && !unique_urls.iter().any(|item| item == trimmed) {
            unique_urls.push(trimmed.to_string());
        }
    }

    let client = match Client::builder()
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(Duration::from_secs(20))
        .user_agent("HaoMD/0.12")
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            return err_payload(
                ErrorCode::UNKNOWN,
                format!("创建图片下载客户端失败: {error}"),
                trace,
            );
        }
    };

    let mut fetched = stream::iter(unique_urls.into_iter().enumerate().map(
        |(index, source_url)| {
            let client = client.clone();
            async move { (index, fetch_remote_image(client, source_url).await) }
        },
    ))
    .buffer_unordered(REMOTE_IMAGE_DOWNLOAD_CONCURRENCY)
    .collect::<Vec<_>>()
    .await;
    fetched.sort_by_key(|(index, _)| *index);

    let _guard = CLIPBOARD_IMAGE_SAVE_LOCK.lock().await;
    let base_name =
        sanitize_clipboard_image_base_name(suggested_name.as_deref().unwrap_or("image"));
    let mut next_index: u32 = 1;
    let mut results = Vec::with_capacity(fetched.len());

    for (_, item) in fetched {
        let bytes = match item.bytes {
            Ok(bytes) => bytes,
            Err(error) => {
                results.push(RemoteImageDownloadResult {
                    source_url: item.source_url,
                    file_name: None,
                    error: Some(error),
                });
                continue;
            }
        };

        let extension = match remote_image_extension(&item.source_url, item.content_type.as_deref())
        {
            Some(extension) => extension,
            None => {
                results.push(RemoteImageDownloadResult {
                    source_url: item.source_url,
                    file_name: None,
                    error: Some("响应内容不是受支持的图片格式".to_string()),
                });
                continue;
            }
        };

        let (file_name, full_path) = loop {
            let candidate = format!("{}_{}.{}", base_name, next_index, extension);
            next_index += 1;
            let path = normalized_dir.join(&candidate);
            if !path.exists() {
                break (candidate, path);
            }
        };

        if let Err(error) = tokio::fs::write(&full_path, bytes).await {
            results.push(RemoteImageDownloadResult {
                source_url: item.source_url,
                file_name: None,
                error: Some(format!("保存图片失败: {error}")),
            });
            continue;
        }

        results.push(RemoteImageDownloadResult {
            source_url: item.source_url,
            file_name: Some(file_name),
            error: None,
        });
    }

    ok(results, trace)
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(tag = "kind", content = "text", rename_all = "snake_case")]
pub enum ClipboardPasteContent {
    Image,
    Text(String),
    Empty,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct ClipboardMatchStyleContent {
    pub html: String,
    pub text: String,
}

#[tauri::command]
pub async fn read_clipboard_for_paste() -> ResultPayload<ClipboardPasteContent> {
    let trace = new_trace_id();

    // Try arboard first
    let _arboard_empty = {
        let mut clipboard = match Clipboard::new() {
            Ok(clipboard) => clipboard,
            Err(err) => {
                return err_payload(ErrorCode::IoError, format!("访问剪贴板失败: {err}"), trace);
            }
        };

        // Some clipboard producers expose both an image and fallback text/URL.
        // Prefer the image so screenshot and browser-image paste keep working.
        if let Ok(image) = clipboard.get_image() {
            log::info!(
                "[tauri] read_clipboard_for_paste: image {}x{}",
                image.width,
                image.height
            );
            return ok(ClipboardPasteContent::Image, trace);
        }

        match clipboard.get_text() {
            Ok(text) if !text.is_empty() => {
                log::info!("[tauri] read_clipboard_for_paste: text len={}", text.len());
                return ok(ClipboardPasteContent::Text(text), trace);
            }
            _ => {}
        }

        true // arboard found nothing
    }; // clipboard dropped here, releasing any lock

    // Fallback: Windows DIB/DIBV5 (Snipaste, PixPin, QQ screenshot, etc.)
    #[cfg(target_os = "windows")]
    {
        if _arboard_empty {
            log::info!(
                "[tauri] read_clipboard_for_paste: arboard empty, trying Windows DIB fallback"
            );
            if let Some(image) = try_read_clipboard_dib() {
                log::info!(
                    "[tauri] read_clipboard_for_paste: DIB fallback image {}x{}",
                    image.width,
                    image.height
                );
                return ok(ClipboardPasteContent::Image, trace);
            }
        }
    }

    log::info!("[tauri] read_clipboard_for_paste: empty");
    ok(ClipboardPasteContent::Empty, trace)
}

#[tauri::command]
pub async fn read_clipboard_for_match_style() -> ResultPayload<ClipboardMatchStyleContent> {
    let trace = new_trace_id();
    let mut clipboard = match Clipboard::new() {
        Ok(clipboard) => clipboard,
        Err(err) => {
            return err_payload(ErrorCode::IoError, format!("访问剪贴板失败: {err}"), trace);
        }
    };

    let html = clipboard.get().html().unwrap_or_default();
    let text = clipboard.get_text().unwrap_or_default();

    log::info!(
        "[tauri] read_clipboard_for_match_style: html_len={} text_len={}",
        html.len(),
        text.len()
    );
    ok(ClipboardMatchStyleContent { html, text }, trace)
}

#[tauri::command]
pub async fn save_clipboard_image_to_dir(
    target_dir: String,
    suggested_name: Option<String>,
) -> ResultPayload<ClipboardImageResult> {
    let trace = new_trace_id();
    log::info!(
        "[tauri] save_clipboard_image_to_dir: target_dir={}, suggested_name={:?}",
        target_dir,
        suggested_name
    );

    let normalized_dir = match normalize_path(&target_dir) {
        Ok(p) => p,
        Err(e) => return ResultPayload::Err { error: e },
    };

    if let Err(err) = std::fs::create_dir_all(&normalized_dir) {
        return err_payload(
            ErrorCode::IoError,
            format!("创建图片目录失败: {err}"),
            trace,
        );
    }

    let img = {
        let mut cb = match Clipboard::new() {
            Ok(c) => c,
            Err(err) => {
                return err_payload(ErrorCode::IoError, format!("访问剪贴板失败: {err}"), trace);
            }
        };

        match cb.get_image() {
            Ok(img) => {
                log::info!(
                    "[tauri] save_clipboard_image_to_dir: got image {}x{}",
                    img.width,
                    img.height
                );
                img
            }
            Err(arboard_err) => {
                log::warn!(
                    "[tauri] save_clipboard_image_to_dir: arboard failed: {}, trying fallback",
                    arboard_err
                );
                #[cfg(target_os = "windows")]
                {
                    drop(cb);
                    match try_read_clipboard_dib() {
                        Some(img) => {
                            log::info!(
                                "[tauri] save_clipboard_image_to_dir: DIB fallback {}x{}",
                                img.width,
                                img.height
                            );
                            img
                        }
                        None => {
                            return err_payload(
                                ErrorCode::UNSUPPORTED,
                                format!("剪贴板中没有图片或格式不支持: {arboard_err}"),
                                trace,
                            );
                        }
                    }
                }
                #[cfg(not(target_os = "windows"))]
                {
                    return err_payload(
                        ErrorCode::UNSUPPORTED,
                        format!("剪贴板中没有图片或格式不支持: {arboard_err}"),
                        trace,
                    );
                }
            }
        }
    };

    let width = img.width as u32;
    let height = img.height as u32;

    let buffer: ImageBuffer<Rgba<u8>, _> =
        match ImageBuffer::from_raw(width, height, img.bytes.into_owned()) {
            Some(buf) => buf,
            None => {
                return err_payload(ErrorCode::UNSUPPORTED, "图片数据无效", trace);
            }
        };

    let base_name =
        sanitize_clipboard_image_base_name(&suggested_name.unwrap_or_else(|| "image".to_string()));
    let _guard = CLIPBOARD_IMAGE_SAVE_LOCK.lock().await;

    let mut index: u32 = 1;
    let file_name = loop {
        let candidate = format!("{}_{}.png", base_name, index);
        let candidate_path = normalized_dir.join(&candidate);
        if !candidate_path.exists() {
            break candidate;
        }
        index += 1;
        if index > 9999 {
            let rand_suffix: String = rand::thread_rng()
                .sample_iter(&Alphanumeric)
                .take(6)
                .map(char::from)
                .collect();
            let timestamp = Local::now().format("%Y%m%d-%H%M%S-%3f");
            break format!("{}_{}_{}.png", base_name, timestamp, rand_suffix);
        }
    };

    let full_path = normalized_dir.join(&file_name);
    log::info!(
        "[tauri] save_clipboard_image_to_dir: saving to {:?}",
        full_path
    );
    if let Err(err) = buffer.save(&full_path) {
        log::error!("[tauri] save_clipboard_image_to_dir: save failed: {}", err);
        return err_payload(ErrorCode::IoError, format!("写入图片失败: {err}"), trace);
    }

    log::info!(
        "[tauri] save_clipboard_image_to_dir: ok, file_name={}",
        file_name
    );
    ok(ClipboardImageResult { file_name }, trace)
}

/// 合并剪贴板图片读取与保存：只打开一次剪贴板，直接保存为 WebP。
/// Windows 下使用 DIB fast 路径避免逐像素 BGR→RGBA 转换。
///
/// 本命令采用即发即返策略：
/// 1. 同步阶段：读取剪贴板、分配唯一文件名、创建空文件、立即返回文件名
/// 2. 异步阶段：在 spawn_blocking 中完成 WebP 编码与磁盘写入
/// 3. 编码完成后通过 `clipboard://image_ready` / `clipboard://image_save_error` 事件通知前端
#[tauri::command]
pub async fn paste_clipboard_image(
    app: AppHandle,
    target_dir: String,
    suggested_name: Option<String>,
) -> ResultPayload<ClipboardImageResult> {
    let trace = new_trace_id();
    log::info!(
        "[tauri] paste_clipboard_image: target_dir={}, suggested_name={:?}",
        target_dir,
        suggested_name
    );

    let normalized_dir = match normalize_path(&target_dir) {
        Ok(p) => p,
        Err(e) => return ResultPayload::Err { error: e },
    };

    if let Err(err) = std::fs::create_dir_all(&normalized_dir) {
        return err_payload(
            ErrorCode::IoError,
            format!("创建图片目录失败: {err}"),
            trace,
        );
    }

    let img = {
        let mut cb = match Clipboard::new() {
            Ok(c) => c,
            Err(err) => {
                return err_payload(ErrorCode::IoError, format!("访问剪贴板失败: {err}"), trace);
            }
        };

        match cb.get_image() {
            Ok(img) => {
                log::info!(
                    "[tauri] paste_clipboard_image: got image {}x{}",
                    img.width,
                    img.height
                );
                let width = img.width as u32;
                let height = img.height as u32;
                match ImageBuffer::<Rgba<u8>, Vec<u8>>::from_raw(
                    width,
                    height,
                    img.bytes.into_owned(),
                ) {
                    Some(buf) => DynamicImage::ImageRgba8(buf),
                    None => {
                        return err_payload(ErrorCode::UNSUPPORTED, "图片数据无效", trace);
                    }
                }
            }
            Err(arboard_err) => {
                log::warn!(
                    "[tauri] paste_clipboard_image: arboard failed: {}, trying fallback",
                    arboard_err
                );
                #[cfg(target_os = "windows")]
                {
                    drop(cb);
                    unsafe {
                        match try_read_clipboard_dib_fast() {
                            Some(img) => {
                                log::info!(
                                    "[tauri] paste_clipboard_image: DIB fast fallback {}x{}",
                                    img.width(),
                                    img.height()
                                );
                                img
                            }
                            None => {
                                return err_payload(
                                    ErrorCode::UNSUPPORTED,
                                    format!("剪贴板中没有图片或格式不支持: {arboard_err}"),
                                    trace,
                                );
                            }
                        }
                    }
                }
                #[cfg(not(target_os = "windows"))]
                {
                    return err_payload(
                        ErrorCode::UNSUPPORTED,
                        format!("剪贴板中没有图片或格式不支持: {arboard_err}"),
                        trace,
                    );
                }
            }
        }
    };

    let base_name = suggested_name.unwrap_or_else(|| "image".to_string());
    let _guard = CLIPBOARD_IMAGE_SAVE_LOCK.lock().await;

    let mut index: u32 = 1;
    let file_name = loop {
        let candidate = format!("{}_{}.webp", base_name, index);
        let candidate_path = normalized_dir.join(&candidate);
        if !candidate_path.exists() {
            break candidate;
        }
        index += 1;
        if index > 9999 {
            let rand_suffix: String = rand::thread_rng()
                .sample_iter(&Alphanumeric)
                .take(6)
                .map(char::from)
                .collect();
            let timestamp = Local::now().format("%Y%m%d-%H%M%S-%3f");
            break format!("{}_{}_{}.webp", base_name, timestamp, rand_suffix);
        }
    };

    let full_path = normalized_dir.join(&file_name);
    log::info!(
        "[tauri] paste_clipboard_image: will save to {:?}, returning immediately",
        full_path
    );

    let mut file = match std::fs::File::create(&full_path) {
        Ok(f) => f,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("创建图片文件失败: {err}"),
                trace,
            );
        }
    };

    // 释放锁：文件名已唯一确定，后续写入无需互斥
    drop(_guard);

    // 在后台线程完成 WebP 编码与写入，不阻塞异步事件循环
    let file_name_for_event = file_name.clone();
    tokio::spawn(async move {
        let result =
            tokio::task::spawn_blocking(move || img.write_to(&mut file, ImageFormat::WebP)).await;

        match result {
            Ok(Ok(())) => {
                log::info!(
                    "[tauri] paste_clipboard_image: background encode ok, file_name={}",
                    file_name_for_event
                );
                let payload = serde_json::json!({"fileName": file_name_for_event});
                if let Err(err) = app.emit("clipboard://image_ready", payload) {
                    log::warn!("[tauri] emit clipboard://image_ready failed: {}", err);
                }
            }
            Ok(Err(write_err)) => {
                log::error!(
                    "[tauri] paste_clipboard_image: background encode failed: {}",
                    write_err
                );
                let payload = serde_json::json!({"fileName": file_name_for_event, "error": format!("{}", write_err)});
                if let Err(err) = app.emit("clipboard://image_save_error", payload) {
                    log::warn!("[tauri] emit clipboard://image_save_error failed: {}", err);
                }
            }
            Err(join_err) => {
                log::error!(
                    "[tauri] paste_clipboard_image: background task panicked: {}",
                    join_err
                );
                let payload = serde_json::json!({"fileName": file_name_for_event, "error": format!("{}", join_err)});
                if let Err(err) = app.emit("clipboard://image_save_error", payload) {
                    log::warn!("[tauri] emit clipboard://image_save_error failed: {}", err);
                }
            }
        }
    });

    log::info!(
        "[tauri] paste_clipboard_image: returned immediately, file_name={}",
        file_name
    );
    ok(ClipboardImageResult { file_name }, trace)
}

#[tauri::command]
pub async fn read_clipboard_image_as_base64() -> ResultPayload<String> {
    let trace = new_trace_id();
    log::info!("[tauri] read_clipboard_image_as_base64: start");

    let img = {
        let mut cb = match Clipboard::new() {
            Ok(c) => c,
            Err(err) => {
                return err_payload(ErrorCode::IoError, format!("访问剪贴板失败: {err}"), trace);
            }
        };

        match cb.get_image() {
            Ok(img) => {
                log::info!(
                    "[tauri] read_clipboard_image_as_base64: got image {}x{}",
                    img.width,
                    img.height
                );
                img
            }
            Err(arboard_err) => {
                log::warn!(
                    "[tauri] read_clipboard_image_as_base64: arboard failed: {}, trying fallback",
                    arboard_err
                );
                #[cfg(target_os = "windows")]
                {
                    drop(cb);
                    match try_read_clipboard_dib() {
                        Some(img) => {
                            log::info!(
                                "[tauri] read_clipboard_image_as_base64: DIB fallback {}x{}",
                                img.width,
                                img.height
                            );
                            img
                        }
                        None => {
                            return err_payload(
                                ErrorCode::UNSUPPORTED,
                                format!("剪贴板中没有图片或格式不支持: {arboard_err}"),
                                trace,
                            );
                        }
                    }
                }
                #[cfg(not(target_os = "windows"))]
                {
                    return err_payload(
                        ErrorCode::UNSUPPORTED,
                        format!("剪贴板中没有图片或格式不支持: {arboard_err}"),
                        trace,
                    );
                }
            }
        }
    };

    let width = img.width as u32;
    let height = img.height as u32;

    let buffer: ImageBuffer<Rgba<u8>, _> =
        match ImageBuffer::from_raw(width, height, img.bytes.into_owned()) {
            Some(buf) => buf,
            None => {
                return err_payload(ErrorCode::UNSUPPORTED, "图片数据无效", trace);
            }
        };

    let dyn_img = DynamicImage::ImageRgba8(buffer);
    let mut png_bytes: Vec<u8> = Vec::new();
    {
        let mut cursor = Cursor::new(&mut png_bytes);
        if let Err(err) = dyn_img.write_to(&mut cursor, ImageFormat::Png) {
            log::error!(
                "[tauri] read_clipboard_image_as_base64: encode png failed: {}",
                err
            );
            return err_payload(ErrorCode::IoError, format!("编码 PNG 失败: {err}"), trace);
        }
    }

    let encoded = base64::encode(&png_bytes);
    log::info!(
        "[tauri] read_clipboard_image_as_base64: ok, bytes={} encoded_len={}",
        png_bytes.len(),
        encoded.len()
    );

    ok(encoded, trace)
}

#[cfg(test)]
mod tests {
    use super::{
        remote_image_extension, sanitize_clipboard_image_base_name, ClipboardPasteContent,
    };

    #[test]
    fn clipboard_image_base_name_is_safe_across_platforms() {
        assert_eq!(
            sanitize_clipboard_image_base_name("image_M01 AI开发基础"),
            "image_M01_AI开发基础"
        );
        assert_eq!(
            sanitize_clipboard_image_base_name(r#"image:bad/name?"#),
            "image_bad_name_"
        );
    }

    #[test]
    fn empty_clipboard_image_base_name_uses_default() {
        assert_eq!(sanitize_clipboard_image_base_name(" . "), "image");
    }

    #[test]
    fn clipboard_paste_content_uses_the_frontend_contract() {
        let image = serde_json::to_value(ClipboardPasteContent::Image).unwrap();
        let text = serde_json::to_value(ClipboardPasteContent::Text("hello".into())).unwrap();
        let empty = serde_json::to_value(ClipboardPasteContent::Empty).unwrap();

        assert_eq!(image, serde_json::json!({ "kind": "image" }));
        assert_eq!(text, serde_json::json!({ "kind": "text", "text": "hello" }));
        assert_eq!(empty, serde_json::json!({ "kind": "empty" }));
    }

    #[test]
    fn remote_image_extension_prefers_image_content_type() {
        assert_eq!(
            remote_image_extension("https://example.com/download?id=1", Some("image/png")),
            Some("png".to_string())
        );
        assert_eq!(
            remote_image_extension("https://example.com/image.jpeg", None),
            Some("jpg".to_string())
        );
        assert_eq!(
            remote_image_extension("https://example.com/image.png", Some("text/html")),
            None
        );
    }
}
