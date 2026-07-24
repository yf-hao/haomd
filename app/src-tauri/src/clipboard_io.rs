use crate::{err_payload, new_trace_id, normalize_path, ok, ErrorCode, ResultPayload};
use arboard::Clipboard;
use chrono::Local;
use image::{DynamicImage, ImageBuffer, ImageFormat, Rgba};
use once_cell::sync::Lazy;
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use tokio::sync::Mutex;

static CLIPBOARD_IMAGE_SAVE_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

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
                    rgba[dst_idx + 3] = 255;               // A
                }
            }
        }

        GlobalUnlock(HGLOBAL(handle.0));
        CloseClipboard();

        log::info!(
            "[tauri] try_read_clipboard_dib: success {}x{}",
            abs_width, abs_height
        );

        Some(arboard::ImageData {
            width: abs_width,
            height: abs_height,
            bytes: std::borrow::Cow::Owned(rgba),
        })
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ClipboardImageResult {
    pub file_name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(tag = "kind", content = "text", rename_all = "snake_case")]
pub enum ClipboardPasteContent {
    Image,
    Text(String),
    Empty,
}

#[tauri::command]
pub async fn read_clipboard_for_paste() -> ResultPayload<ClipboardPasteContent> {
    let trace = new_trace_id();

    // Try arboard first
    let arboard_empty = {
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
        if arboard_empty {
            log::info!("[tauri] read_clipboard_for_paste: arboard empty, trying Windows DIB fallback");
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

    let base_name = suggested_name.unwrap_or_else(|| "image".to_string());
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
    use super::ClipboardPasteContent;

    #[test]
    fn clipboard_paste_content_uses_the_frontend_contract() {
        let image = serde_json::to_value(ClipboardPasteContent::Image).unwrap();
        let text = serde_json::to_value(ClipboardPasteContent::Text("hello".into())).unwrap();
        let empty = serde_json::to_value(ClipboardPasteContent::Empty).unwrap();

        assert_eq!(image, serde_json::json!({ "kind": "image" }));
        assert_eq!(text, serde_json::json!({ "kind": "text", "text": "hello" }));
        assert_eq!(empty, serde_json::json!({ "kind": "empty" }));
    }
}
