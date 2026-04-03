use crate::{err_payload, new_trace_id, normalize_path, ok, ErrorCode, ResultPayload};
use arboard::Clipboard;
use chrono::Local;
use image::{DynamicImage, ImageBuffer, ImageFormat, Rgba};
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use std::io::Cursor;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ClipboardImageResult {
    pub file_name: String,
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

    let mut cb = match Clipboard::new() {
        Ok(c) => c,
        Err(err) => {
            return err_payload(ErrorCode::IoError, format!("访问剪贴板失败: {err}"), trace);
        }
    };

    let img = match cb.get_image() {
        Ok(img) => {
            log::info!(
                "[tauri] save_clipboard_image_to_dir: got image {}x{}",
                img.width,
                img.height
            );
            img
        }
        Err(err) => {
            log::error!(
                "[tauri] save_clipboard_image_to_dir: get_image failed: {}",
                err
            );
            return err_payload(
                ErrorCode::UNSUPPORTED,
                format!("剪贴板中没有图片或格式不支持: {err}"),
                trace,
            );
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

    let mut cb = match Clipboard::new() {
        Ok(c) => c,
        Err(err) => {
            return err_payload(ErrorCode::IoError, format!("访问剪贴板失败: {err}"), trace);
        }
    };

    let img = match cb.get_image() {
        Ok(img) => {
            log::info!(
                "[tauri] read_clipboard_image_as_base64: got image {}x{}",
                img.width,
                img.height
            );
            img
        }
        Err(err) => {
            log::error!(
                "[tauri] read_clipboard_image_as_base64: get_image failed: {}",
                err
            );
            return err_payload(
                ErrorCode::UNSUPPORTED,
                format!("剪贴板中没有图片或格式不支持: {err}"),
                trace,
            );
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
