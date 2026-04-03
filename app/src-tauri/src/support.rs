use crate::{ErrorCode, ResultPayload, ServiceError, WordParagraphStyleCfg};
use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) fn new_trace_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    format!("trace_{}", nanos)
}

pub(crate) fn left_aligned_math_paragraph_style() -> WordParagraphStyleCfg {
    WordParagraphStyleCfg {
        align: Some("left".to_string()),
        line_height: None,
        spacing_after_pt: None,
        background_color: None,
        border_color: None,
        border_top_color: None,
        border_right_color: None,
        border_bottom_color: None,
        border_left_color: None,
    }
}

pub(crate) fn service_error(
    code: ErrorCode,
    message: impl Into<String>,
    trace_id: Option<String>,
) -> ServiceError {
    ServiceError {
        code,
        message: message.into(),
        trace_id,
    }
}

pub(crate) fn ok<T>(data: T, trace_id: String) -> ResultPayload<T> {
    ResultPayload::Ok {
        data,
        trace_id: Some(trace_id),
    }
}

pub(crate) fn err_payload<T>(
    code: ErrorCode,
    message: impl Into<String>,
    trace_id: String,
) -> ResultPayload<T> {
    ResultPayload::Err {
        error: service_error(code, message, Some(trace_id)),
    }
}

pub(crate) fn escape_xml_text(input: &str) -> String {
    html_escape::encode_text(input).to_string()
}

pub(crate) fn escape_xml_attr(input: &str) -> String {
    html_escape::encode_double_quoted_attribute(input).to_string()
}
