use percent_encoding::percent_decode_str;
use std::path::PathBuf;
use tauri::http::{Request, Response};
use tauri::UriSchemeContext;

pub fn handle_haomd_protocol(
    _context: UriSchemeContext<tauri::Wry>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let uri = request.uri();
    let raw_path = uri.path();
    log::info!(
        "[tauri] haomd protocol: raw uri={}, raw_path={}",
        uri,
        raw_path
    );

    let mut decoded = raw_path.to_string();
    loop {
        let new_decoded = percent_decode_str(&decoded).decode_utf8_lossy().to_string();
        if new_decoded == decoded {
            break;
        }
        decoded = new_decoded;
    }
    log::info!("[tauri] haomd protocol: fully decoded path={}", decoded);

    let path = PathBuf::from(&decoded);
    log::info!(
        "[tauri] haomd protocol: final path={:?}, exists={}",
        path,
        path.exists()
    );

    if !path.exists() {
        if let Some(parent) = path.parent() {
            log::info!("[tauri] haomd protocol: listing parent dir {:?}", parent);
            if let Ok(entries) = std::fs::read_dir(parent) {
                for entry in entries.flatten() {
                    log::info!("[tauri] haomd protocol: dir entry {:?}", entry.file_name());
                }
            }
        }
    }

    match std::fs::metadata(&path) {
        Ok(meta) => {
            let file_size = meta.len();

            let range_header = request.headers().get("range");
            let (status, body_bytes, content_range) = if let Some(range) = range_header {
                let range_str = range.to_str().unwrap_or("");
                log::info!("[tauri] haomd protocol: Range header={}", range_str);

                let (start, end) = if let Some(range_spec) = range_str.strip_prefix("bytes=") {
                    let parts: Vec<&str> = range_spec.split('-').collect();
                    let start_opt = parts.first().and_then(|s| s.parse::<u64>().ok());
                    let end_opt = parts.get(1).and_then(|s| s.parse::<u64>().ok());

                    let start = start_opt.unwrap_or(0);
                    let end = end_opt.unwrap_or(file_size.saturating_sub(1));

                    (start, end.min(file_size.saturating_sub(1)))
                } else {
                    (0, file_size.saturating_sub(1))
                };

                let data = match std::fs::read(&path) {
                    Ok(d) => d,
                    Err(e) => {
                        log::error!(
                            "[tauri] haomd protocol: failed to read file {:?}: {}",
                            path,
                            e
                        );
                        return Response::builder().status(404).body(Vec::new()).unwrap();
                    }
                };

                let start_idx = start as usize;
                let end_idx = (end + 1) as usize;
                if start_idx >= data.len() {
                    log::error!(
                        "[tauri] haomd protocol: invalid range start={} file_size={}",
                        start,
                        file_size
                    );
                    return Response::builder()
                        .status(416)
                        .header("Content-Range", format!("bytes */{}", file_size))
                        .body(Vec::new())
                        .unwrap();
                }

                let range_bytes = data[start_idx..end_idx.min(data.len())].to_vec();
                let content_range_header = format!("bytes {}-{}/{}", start, end, file_size);

                (206, range_bytes, Some(content_range_header))
            } else {
                match std::fs::read(&path) {
                    Ok(data) => (200, data, None),
                    Err(e) => {
                        log::error!(
                            "[tauri] haomd protocol: failed to read file {:?}: {}",
                            path,
                            e
                        );
                        return Response::builder().status(404).body(Vec::new()).unwrap();
                    }
                }
            };

            log::info!(
                "[tauri] haomd protocol: status={}, size={} bytes",
                status,
                body_bytes.len()
            );

            let mime = mime_guess::from_path(&path)
                .first_or_octet_stream()
                .to_string();

            let mut builder = Response::builder()
                .status(status)
                .header("Content-Type", mime.as_str())
                .header("Cache-Control", "public, max-age=3600")
                .header("Accept-Ranges", "bytes");

            if let Some(cr) = content_range {
                builder = builder.header("Content-Range", cr);
            }

            match builder.body(body_bytes) {
                Ok(response) => response,
                Err(e) => {
                    log::error!("[tauri] haomd protocol: failed to build response: {}", e);
                    Response::builder().status(500).body(Vec::new()).unwrap()
                }
            }
        }
        Err(e) => {
            log::error!(
                "[tauri] haomd protocol: failed to get metadata for {:?}: {}",
                path,
                e
            );
            Response::builder().status(404).body(Vec::new()).unwrap()
        }
    }
}
