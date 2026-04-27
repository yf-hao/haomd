use crate::{
    editor_settings::load_search_settings_cfg, err_payload, new_trace_id, normalize_path, ok,
    search_db, ErrorCode, ResultPayload,
};
use regex::RegexBuilder;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

const SEARCHABLE_EXTENSIONS: &[&str] = &[
    "md", "markdown", "mdx", "txt", "json", "yaml", "yml", "toml", "ini", "env", "ts", "tsx",
    "js", "jsx", "css", "html", "sql", "csv",
];
const MAX_SEARCHABLE_FILE_BYTES: u64 = 2 * 1024 * 1024;
const IGNORED_DIRECTORY_NAMES: &[&str] = &[".haomd"];
const PARALLEL_SCAN_MIN_FILES: usize = 64;
const PARALLEL_SCAN_MIN_TOTAL_BYTES: u64 = 8 * 1024 * 1024;
const PARALLEL_SCAN_AUTO_MAX_WORKERS: usize = 4;
const PARALLEL_SCAN_MANUAL_MAX_WORKERS: usize = 8;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchScope {
    pub folder_roots: Vec<String>,
    pub standalone_files: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    pub request_id: String,
    pub mode: String,
    pub query: String,
    pub scope: SearchScope,
    pub case_sensitive: Option<bool>,
    pub whole_word: Option<bool>,
    pub regex: Option<bool>,
    pub max_results: Option<usize>,
    pub max_hits_per_file: Option<usize>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub line: usize,
    pub column_start: usize,
    pub column_end: usize,
    pub preview: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchFileResult {
    pub path: String,
    pub match_count: usize,
    pub hits: Vec<SearchHit>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub files: Vec<SearchFileResult>,
    pub total_matches: usize,
    pub total_files_scanned: usize,
    pub truncated: bool,
    pub execution: Option<SearchExecutionInfo>,
    pub request_id: Option<String>,
}

#[derive(Debug)]
struct SearchScanOutcome {
    file_result: Option<SearchFileResult>,
    file_truncated: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchExecutionInfo {
    pub strategy: String,
    pub workers: usize,
    pub engine: Option<String>,
    pub indexed_files: Option<usize>,
    pub candidate_files: Option<usize>,
}

pub(crate) fn normalize_display_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn is_searchable_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| SEARCHABLE_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn push_file_candidate(path: PathBuf, seen: &mut HashSet<String>, files: &mut Vec<PathBuf>) {
    let display = normalize_display_path(&path);
    if seen.insert(display) {
        files.push(path);
    }
}

fn should_skip_directory(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| IGNORED_DIRECTORY_NAMES.contains(&name))
        .unwrap_or(false)
}

fn collect_root_files(dir: &Path, seen: &mut HashSet<String>, files: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if meta.is_dir() {
            if should_skip_directory(&path) {
                continue;
            }
            collect_root_files(&path, seen, files);
            continue;
        }
        if meta.is_file() && is_searchable_file(&path) {
            push_file_candidate(path, seen, files);
        }
    }
}

pub(crate) fn gather_search_files(scope: &SearchScope) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut files = Vec::new();

    for root in &scope.folder_roots {
        let Ok(normalized_root) = normalize_path(root) else {
            continue;
        };
        let Ok(meta) = std::fs::metadata(&normalized_root) else {
            continue;
        };
        if meta.is_dir() {
            collect_root_files(&normalized_root, &mut seen, &mut files);
        }
    }

    for file in &scope.standalone_files {
        let Ok(normalized_file) = normalize_path(file) else {
            continue;
        };
        let Ok(meta) = std::fs::metadata(&normalized_file) else {
            continue;
        };
        if meta.is_file() && is_searchable_file(&normalized_file) {
            push_file_candidate(normalized_file, &mut seen, &mut files);
        }
    }

    files
}

fn is_word_char(ch: char) -> bool {
    ch.is_alphanumeric() || ch == '_'
}

fn satisfies_whole_word(line: &str, start: usize, end: usize) -> bool {
    let left_ok = line[..start]
        .chars()
        .next_back()
        .map(|ch| !is_word_char(ch))
        .unwrap_or(true);
    let right_ok = line[end..]
        .chars()
        .next()
        .map(|ch| !is_word_char(ch))
        .unwrap_or(true);
    left_ok && right_ok
}

fn build_regex_pattern(request: &SearchRequest) -> Result<Option<regex::Regex>, regex::Error> {
    if !request.regex.unwrap_or(false) {
        return Ok(None);
    }

    let source = if request.whole_word.unwrap_or(false) {
        format!(r"\b(?:{})\b", request.query)
    } else {
        request.query.clone()
    };

    let mut builder = RegexBuilder::new(&source);
    builder.case_insensitive(!request.case_sensitive.unwrap_or(false));
    builder.multi_line(false);
    builder.dot_matches_new_line(false);
    builder.build().map(Some)
}

fn plain_matches_for_line(
    line: &str,
    query: &str,
    case_sensitive: bool,
    whole_word: bool,
    remaining: usize,
) -> Vec<(usize, usize)> {
    if query.is_empty() || remaining == 0 {
        return Vec::new();
    }

    let haystack_owned;
    let needle_owned;
    let haystack = if case_sensitive {
        line
    } else {
        haystack_owned = line.to_lowercase();
        &haystack_owned
    };
    let needle = if case_sensitive {
        query
    } else {
        needle_owned = query.to_lowercase();
        &needle_owned
    };

    let mut matches = Vec::new();
    let mut offset = 0usize;

    while offset <= haystack.len() {
        let Some(relative) = haystack[offset..].find(needle) else {
            break;
        };
        let start = offset + relative;
        let end = start + needle.len();
        offset = end.max(start + 1);

        if whole_word && !satisfies_whole_word(line, start, end) {
            continue;
        }

        matches.push((start, end));
        if matches.len() >= remaining {
            break;
        }
    }

    matches
}

fn trim_preview(line: &str) -> String {
    let preview = line.trim();
    if preview.is_empty() {
        line.to_string()
    } else {
        preview.to_string()
    }
}

fn default_parallel_scan_workers() -> usize {
    match std::thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(1)
    {
        0..=2 => 1,
        3..=4 => 2,
        _ => PARALLEL_SCAN_AUTO_MAX_WORKERS,
    }
}

fn should_use_parallel_scan(files: &[PathBuf], parallel_scan_enabled: bool) -> bool {
    if !parallel_scan_enabled {
        return false;
    }
    if files.len() >= PARALLEL_SCAN_MIN_FILES {
        return true;
    }

    let mut total_bytes = 0u64;
    for path in files {
        let Ok(meta) = std::fs::metadata(path) else {
            continue;
        };
        total_bytes = total_bytes.saturating_add(meta.len());
        if total_bytes >= PARALLEL_SCAN_MIN_TOTAL_BYTES {
            return true;
        }
    }

    false
}

fn scan_single_file(
    path: &Path,
    query: &str,
    case_sensitive: bool,
    whole_word: bool,
    regex: Option<&regex::Regex>,
    max_hits_per_file: usize,
) -> SearchScanOutcome {
    let Ok(meta) = std::fs::metadata(path) else {
        return SearchScanOutcome {
            file_result: None,
            file_truncated: false,
        };
    };
    if meta.len() > MAX_SEARCHABLE_FILE_BYTES {
        return SearchScanOutcome {
            file_result: None,
            file_truncated: false,
        };
    }

    let Ok(bytes) = std::fs::read(path) else {
        return SearchScanOutcome {
            file_result: None,
            file_truncated: false,
        };
    };
    let Ok(content) = String::from_utf8(bytes) else {
        return SearchScanOutcome {
            file_result: None,
            file_truncated: false,
        };
    };

    let mut hits = Vec::new();
    let mut file_truncated = false;

    for (line_index, line) in content.lines().enumerate() {
        let remaining_for_file = max_hits_per_file.saturating_sub(hits.len());
        if remaining_for_file == 0 {
            file_truncated = true;
            break;
        }

        let line_matches: Vec<(usize, usize)> = if let Some(regex) = regex {
            regex
                .find_iter(line)
                .take(remaining_for_file)
                .map(|m| (m.start(), m.end()))
                .collect()
        } else {
            plain_matches_for_line(line, query, case_sensitive, whole_word, remaining_for_file)
        };

        if line_matches.is_empty() {
            continue;
        }

        for (start, end) in line_matches {
            hits.push(SearchHit {
                line: line_index + 1,
                column_start: start + 1,
                column_end: end + 1,
                preview: trim_preview(line),
            });

            if hits.len() >= max_hits_per_file {
                file_truncated = true;
                break;
            }
        }

        if hits.len() >= max_hits_per_file {
            break;
        }
    }

    SearchScanOutcome {
        file_result: (!hits.is_empty()).then(|| SearchFileResult {
            path: normalize_display_path(path),
            match_count: hits.len(),
            hits,
        }),
        file_truncated,
    }
}

fn scan_files_in_parallel(
    files: &[PathBuf],
    query: &str,
    case_sensitive: bool,
    whole_word: bool,
    regex: Option<&regex::Regex>,
    max_hits_per_file: usize,
    workers: usize,
) -> Vec<SearchScanOutcome> {
    if workers <= 1 || files.is_empty() {
        return files
            .iter()
            .map(|path| {
                scan_single_file(
                    path,
                    query,
                    case_sensitive,
                    whole_word,
                    regex,
                    max_hits_per_file,
                )
            })
            .collect();
    }

    let chunk_size = files.len().div_ceil(workers).max(1);

    std::thread::scope(|scope| {
        let mut handles = Vec::new();
        for chunk in files.chunks(chunk_size) {
            let regex = regex.cloned();
            handles.push(scope.spawn(move || {
                chunk.iter()
                    .map(|path| {
                        scan_single_file(
                            path,
                            query,
                            case_sensitive,
                            whole_word,
                            regex.as_ref(),
                            max_hits_per_file,
                        )
                    })
                    .collect::<Vec<_>>()
            }));
        }

        let mut outcomes = Vec::with_capacity(files.len());
        for handle in handles {
            if let Ok(chunk_outcomes) = handle.join() {
                outcomes.extend(chunk_outcomes);
            }
        }
        outcomes
    })
}

fn execute_scan_search(
    request: &SearchRequest,
    query: &str,
    files: Vec<PathBuf>,
    regex: Option<&regex::Regex>,
    engine: &str,
    indexed_files: Option<usize>,
    candidate_files: Option<usize>,
    parallel_scan_enabled: bool,
    configured_workers: Option<usize>,
) -> SearchResponse {
    let case_sensitive = request.case_sensitive.unwrap_or(false);
    let whole_word = request.whole_word.unwrap_or(false);
    let max_results = request.max_results.unwrap_or(200).max(1);
    let max_hits_per_file = request.max_hits_per_file.unwrap_or(20).max(1);
    let auto_workers = default_parallel_scan_workers();
    let workers = configured_workers
        .unwrap_or(auto_workers)
        .clamp(1, PARALLEL_SCAN_MANUAL_MAX_WORKERS);
    let use_parallel = should_use_parallel_scan(&files, parallel_scan_enabled) && workers > 1;
    let execution = SearchExecutionInfo {
        strategy: if use_parallel {
            "parallel".to_string()
        } else {
            "single-thread".to_string()
        },
        workers: if use_parallel { workers } else { 1 },
        engine: Some(engine.to_string()),
        indexed_files,
        candidate_files,
    };
    let outcomes = scan_files_in_parallel(
        &files,
        query,
        case_sensitive,
        whole_word,
        regex,
        max_hits_per_file,
        if use_parallel { workers } else { 1 },
    );

    let mut file_results = outcomes
        .iter()
        .filter_map(|outcome| outcome.file_result.clone())
        .collect::<Vec<_>>();
    file_results.sort_by(|left, right| left.path.cmp(&right.path));

    let mut total_matches = 0usize;
    let total_files_scanned = files.len();
    let mut truncated = outcomes.iter().any(|outcome| outcome.file_truncated);
    let mut limited_results = Vec::new();

    for mut file in file_results {
        if total_matches >= max_results {
            truncated = true;
            break;
        }

        let remaining_global = max_results.saturating_sub(total_matches);
        if file.hits.len() > remaining_global {
            file.hits.truncate(remaining_global);
            file.match_count = file.hits.len();
            truncated = true;
        }

        total_matches += file.hits.len();
        limited_results.push(file);
    }

    SearchResponse {
        files: limited_results,
        total_matches,
        total_files_scanned,
        truncated,
        execution: Some(execution),
        request_id: Some(request.request_id.clone()),
    }
}

#[tauri::command]
pub async fn search_workspace_contents(
    app: AppHandle,
    request: SearchRequest,
) -> ResultPayload<SearchResponse> {
    let trace = new_trace_id();

    let query = request.query.trim();
    if query.is_empty() {
        return ok(
            SearchResponse {
                files: Vec::new(),
                total_matches: 0,
                total_files_scanned: 0,
                truncated: false,
                execution: None,
                request_id: Some(request.request_id.clone()),
            },
            trace,
        );
    }

    let regex = match build_regex_pattern(&request) {
        Ok(value) => value,
        Err(err) => {
            return err_payload(
                ErrorCode::UNKNOWN,
                format!("正则表达式无效: {err}"),
                trace,
            );
        }
    };

    let search_settings = load_search_settings_cfg(&app).await;
    let parallel_scan_enabled = search_settings.parallel_scan_enabled.unwrap_or(true);
    let configured_workers = search_settings
        .parallel_scan_workers
        .map(|value| value.max(1) as usize);

    let response = match request.mode.as_str() {
        "scan" => execute_scan_search(
            &request,
            query,
            gather_search_files(&request.scope),
            regex.as_ref(),
            "scan",
            None,
            None,
            parallel_scan_enabled,
            configured_workers,
        ),
        "fts5" => {
            if request.regex.unwrap_or(false) {
                execute_scan_search(
                    &request,
                    query,
                    gather_search_files(&request.scope),
                    regex.as_ref(),
                    "scan",
                    None,
                    None,
                    parallel_scan_enabled,
                    configured_workers,
                )
            } else {
                if !search_settings.fts5_enabled.unwrap_or(false) {
                    return err_payload(
                        ErrorCode::UNSUPPORTED,
                        "FTS5 未启用，请先在设置中开启。".to_string(),
                        trace,
                    );
                }

                let indexed_files = match search_db::ensure_search_index_for_scope(&app, &request.scope) {
                    Ok(value) => value,
                    Err(message) => {
                        return err_payload(ErrorCode::UNKNOWN, message, trace);
                    }
                };
                let candidate_limit = request
                    .max_results
                    .unwrap_or(200)
                    .max(1)
                    .saturating_mul(8)
                    .clamp(64, 2000);
                let candidate_files =
                    match search_db::search_indexed_candidates(&app, query, candidate_limit) {
                        Ok(value) => value,
                        Err(message) => {
                            return err_payload(ErrorCode::UNKNOWN, message, trace);
                        }
                    };

                execute_scan_search(
                    &request,
                    query,
                    candidate_files.clone(),
                    regex.as_ref(),
                    "fts5",
                    Some(indexed_files),
                    Some(candidate_files.len()),
                    parallel_scan_enabled,
                    configured_workers,
                )
            }
        }
        _ => {
            return err_payload(
                ErrorCode::UNSUPPORTED,
                format!("暂不支持搜索模式：{}", request.mode),
                trace,
            );
        }
    };

    ok(response, trace)
}

#[tauri::command]
pub async fn rebuild_search_index(
    app: AppHandle,
    scope: SearchScope,
) -> ResultPayload<usize> {
    let trace = new_trace_id();
    match search_db::rebuild_search_index_for_scope(&app, &scope) {
        Ok(indexed) => ok(indexed, trace),
        Err(message) => err_payload(ErrorCode::UNKNOWN, message, trace),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_dir(prefix: &str) -> PathBuf {
        std::env::temp_dir().join(format!("{prefix}-{}", new_trace_id().replace("trace_", "")))
    }

    #[test]
    fn should_skip_haomd_directory_when_gathering_files() {
        let root = unique_dir("haomd-search-root");
        std::fs::create_dir_all(root.join(".haomd")).expect("should create .haomd");
        std::fs::create_dir_all(root.join("notes")).expect("should create notes");
        std::fs::write(root.join(".haomd/secret.md"), "hidden").expect("should write secret");
        std::fs::write(root.join("notes/visible.md"), "visible").expect("should write visible");

        let files = gather_search_files(&SearchScope {
            folder_roots: vec![normalize_display_path(&root)],
            standalone_files: Vec::new(),
        });

        let normalized_files: Vec<String> = files
            .iter()
            .map(|path| normalize_display_path(path))
            .collect();

        assert!(normalized_files.iter().any(|path| path.ends_with("/notes/visible.md")));
        assert!(!normalized_files.iter().any(|path| path.contains("/.haomd/")));

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn should_apply_whole_word_for_plain_matches() {
        let matches = plain_matches_for_line("demo demobox demo", "demo", true, true, 10);
        assert_eq!(matches, vec![(0, 4), (13, 17)]);
    }

    #[test]
    fn should_build_case_insensitive_whole_word_regex() {
        let regex = build_regex_pattern(&SearchRequest {
            request_id: "1".to_string(),
            mode: "scan".to_string(),
            query: "demo".to_string(),
            scope: SearchScope {
                folder_roots: Vec::new(),
                standalone_files: Vec::new(),
            },
            case_sensitive: Some(false),
            whole_word: Some(true),
            regex: Some(true),
            max_results: None,
            max_hits_per_file: None,
        })
        .expect("regex should compile")
        .expect("regex should exist");

        assert!(regex.is_match("Demo value"));
        assert!(!regex.is_match("demobox"));
    }

    #[test]
    fn should_choose_conservative_default_parallel_workers() {
        let decide = |available: usize| match available {
            0..=2 => 1,
            3..=4 => 2,
            _ => PARALLEL_SCAN_AUTO_MAX_WORKERS,
        };

        assert_eq!(decide(1), 1);
        assert_eq!(decide(2), 1);
        assert_eq!(decide(3), 2);
        assert_eq!(decide(4), 2);
        assert_eq!(decide(8), 4);
    }
}
