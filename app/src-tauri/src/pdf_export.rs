mod coords;
mod renderers;
mod service;
mod text_outlines;
mod types;

use crate::file_io::normalize_path;
use crate::support::service_error;
use crate::{err_payload, new_trace_id, ok, ErrorCode, ResultPayload};
use std::path::PathBuf;
use types::ExportPdfDocument;

fn normalize_output_path(path: &str) -> Result<PathBuf, crate::ServiceError> {
    let normalized = normalize_path(path)?;
    if normalized
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("pdf"))
        != Some(true)
    {
        return Err(service_error(
            ErrorCode::InvalidPath,
            "输出路径必须是 .pdf 文件",
            None,
        ));
    }
    Ok(normalized)
}

#[tauri::command]
pub async fn export_pdf_with_annotations(
    source_path: String,
    output_path: String,
    document: ExportPdfDocument,
    trace_id: Option<String>,
) -> ResultPayload<String> {
    let trace = trace_id.unwrap_or_else(new_trace_id);
    let normalized_source = match normalize_path(&source_path) {
        Ok(path) => path,
        Err(error) => return ResultPayload::Err { error },
    };
    let normalized_output = match normalize_output_path(&output_path) {
        Ok(path) => path,
        Err(error) => return ResultPayload::Err { error },
    };

    let source_path_string = normalized_source.to_string_lossy().into_owned();
    let output_path_string = normalized_output.to_string_lossy().into_owned();
    let output_path_for_task = output_path_string.clone();

    let export_document = ExportPdfDocument {
        source_path: source_path_string.clone(),
        ..document
    };

    let task = tauri::async_runtime::spawn_blocking(move || {
        service::export_pdf_with_annotations(
            &source_path_string,
            &output_path_for_task,
            &export_document,
        )
    });

    match task.await {
        Ok(Ok(())) => ok(output_path_string, trace),
        Ok(Err(error)) => err_payload(ErrorCode::IoError, error, trace),
        Err(error) => err_payload(
            ErrorCode::UNKNOWN,
            format!("导出任务执行失败: {error}"),
            trace,
        ),
    }
}
