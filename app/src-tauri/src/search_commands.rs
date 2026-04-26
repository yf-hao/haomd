use crate::{err_payload, new_trace_id, normalize_path, ok, ErrorCode, ResultPayload};
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
    pub request_id: Option<String>,
}

fn normalize_display_path(path: &Path) -> String {
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

fn gather_search_files(scope: &SearchScope) -> Vec<PathBuf> {
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

#[tauri::command]
pub async fn search_workspace_contents(
    _app: AppHandle,
    request: SearchRequest,
) -> ResultPayload<SearchResponse> {
    let trace = new_trace_id();

    if request.mode != "scan" {
        return err_payload(
            ErrorCode::UNSUPPORTED,
            format!("暂不支持搜索模式：{}", request.mode),
            trace,
        );
    }

    let query = request.query.trim();
    if query.is_empty() {
        return ok(
            SearchResponse {
                files: Vec::new(),
                total_matches: 0,
                total_files_scanned: 0,
                truncated: false,
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

    let files = gather_search_files(&request.scope);
    let case_sensitive = request.case_sensitive.unwrap_or(false);
    let whole_word = request.whole_word.unwrap_or(false);
    let max_results = request.max_results.unwrap_or(200).max(1);
    let max_hits_per_file = request.max_hits_per_file.unwrap_or(20).max(1);

    let mut file_results = Vec::new();
    let mut total_matches = 0usize;
    let mut total_files_scanned = 0usize;
    let mut truncated = false;

    'file_loop: for path in files {
        total_files_scanned += 1;

        let Ok(meta) = std::fs::metadata(&path) else {
            continue;
        };
        if meta.len() > MAX_SEARCHABLE_FILE_BYTES {
            continue;
        }

        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        let Ok(content) = String::from_utf8(bytes) else {
            continue;
        };

        let mut hits = Vec::new();

        for (line_index, line) in content.lines().enumerate() {
            let remaining_for_file = max_hits_per_file.saturating_sub(hits.len());
            let remaining_global = max_results.saturating_sub(total_matches);
            let remaining = remaining_for_file.min(remaining_global);
            if remaining == 0 {
                truncated = true;
                break;
            }

            let line_matches: Vec<(usize, usize)> = if let Some(regex) = &regex {
                regex
                    .find_iter(line)
                    .take(remaining)
                    .map(|m| (m.start(), m.end()))
                    .collect()
            } else {
                plain_matches_for_line(line, query, case_sensitive, whole_word, remaining)
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
                total_matches += 1;

                if hits.len() >= max_hits_per_file || total_matches >= max_results {
                    truncated = true;
                    break;
                }
            }

            if hits.len() >= max_hits_per_file || total_matches >= max_results {
                break;
            }
        }

        if !hits.is_empty() {
            file_results.push(SearchFileResult {
                path: normalize_display_path(&path),
                match_count: hits.len(),
                hits,
            });
        }

        if total_matches >= max_results {
            break 'file_loop;
        }
    }

    ok(
        SearchResponse {
            files: file_results,
            total_matches,
            total_files_scanned,
            truncated,
            request_id: Some(request.request_id),
        },
        trace,
    )
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
}
