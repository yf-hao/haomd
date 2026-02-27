#![allow(dead_code)]

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[allow(clippy::upper_case_acronyms)]
pub enum ErrorCode {
    OK,
    CANCELLED,
    IoError,
    NotFound,
    TooLarge,
    CONFLICT,
    InvalidPath,
    UNSUPPORTED,
    UNKNOWN,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FilePayload {
    pub path: String,
    pub content: String,
    pub encoding: String, // utf-8
    pub mtime_ms: u64,
    pub hash: String, // sha-256 hex
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WriteResult {
    pub path: String,
    pub mtime_ms: u64,
    pub hash: String,
    pub code: ErrorCode,
    pub message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RecentFile {
    pub path: String,
    pub display_name: String,
    pub last_opened_at: u64,
    pub is_folder: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServiceError {
    pub code: ErrorCode,
    pub message: String,
    pub trace_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum ResultPayload<T> {
    Ok { data: T, trace_id: Option<String> },
    Err { error: ServiceError },
}
