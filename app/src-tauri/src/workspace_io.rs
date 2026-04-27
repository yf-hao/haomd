use crate::{err_payload, new_trace_id, ok, search_db, ErrorCode, ResultPayload};
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Runtime};
use tokio::fs;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WriteWorkspaceFileResult {
    pub ok: bool,
    #[serde(default)]
    pub resolved_directory: Option<String>,
    #[serde(default)]
    pub saved_file_path: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub candidates: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ResolveWorkspaceDirectoryResult {
    pub ok: bool,
    #[serde(default)]
    pub resolved_directory: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub candidates: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorkspaceDirectoryResult {
    pub ok: bool,
    #[serde(default)]
    pub resolved_parent_directory: Option<String>,
    #[serde(default)]
    pub created_directory_path: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub candidates: Option<Vec<String>>,
}

fn normalize_display_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn sanitize_file_name(input: &str) -> String {
    let mut value = input
        .trim()
        .replace(['\\', '/', ':', '*', '?', '"', '<', '>', '|'], "-");
    value = value.trim_matches('.').trim_matches('-').trim().to_string();
    if value.is_empty() {
        return "untitled.md".to_string();
    }
    if !value.contains('.') {
        value.push_str(".md");
    }
    value
}

fn sanitize_directory_name(input: &str) -> Option<String> {
    let value = input
        .trim()
        .replace(['\\', '/', ':', '*', '?', '"', '<', '>', '|'], "-")
        .trim_matches('.')
        .trim_matches('-')
        .trim()
        .to_string();

    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn normalize_target_directory(input: &str) -> String {
    input
        .replace('\\', "/")
        .trim_matches('/')
        .trim()
        .to_string()
}

fn normalize_target_input(input: &str) -> String {
    input.replace('\\', "/").trim().to_string()
}

fn has_path_traversal(path: &str) -> bool {
    Path::new(path)
        .components()
        .any(|component| matches!(component, Component::ParentDir))
}

fn canonicalize_existing_dir(path: &Path) -> Option<PathBuf> {
    let canonical = std::fs::canonicalize(path).ok()?;
    let meta = std::fs::metadata(&canonical).ok()?;
    if meta.is_dir() {
        Some(canonical)
    } else {
        None
    }
}

fn is_within_root(root: &Path, candidate: &Path) -> bool {
    candidate == root || candidate.starts_with(root)
}

fn collect_matching_dirs_by_name(
    dir: &Path,
    target_name: &str,
    matches: &mut Vec<PathBuf>,
) -> std::io::Result<()> {
    let entries = std::fs::read_dir(dir)?;
    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        let meta = entry.metadata()?;
        if !meta.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name == target_name {
            matches.push(path.clone());
        }
        collect_matching_dirs_by_name(&path, target_name, matches)?;
    }
    Ok(())
}

fn relative_target_variants(root: &Path, normalized_target: &str) -> Vec<PathBuf> {
    let mut variants = vec![PathBuf::from(normalized_target)];
    let root_name = root
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();

    if let Some(stripped) = normalized_target.strip_prefix(&(root_name.to_string() + "/")) {
        if !stripped.is_empty() {
            variants.push(PathBuf::from(stripped));
        }
    }

    variants.sort();
    variants.dedup();
    variants
}

fn resolve_absolute_target_directory(
    canonical_roots: &[PathBuf],
    raw_target: &str,
) -> Result<PathBuf, WriteWorkspaceFileResult> {
    let target_path = Path::new(raw_target);
    let canonical_target = match canonicalize_existing_dir(target_path) {
        Some(path) => path,
        None => {
            return Err(WriteWorkspaceFileResult {
                ok: false,
                resolved_directory: None,
                saved_file_path: None,
                reason: Some("not_found".to_string()),
                candidates: None,
            });
        }
    };

    if canonical_roots
        .iter()
        .any(|root| is_within_root(root, &canonical_target))
    {
        Ok(canonical_target)
    } else {
        Err(WriteWorkspaceFileResult {
            ok: false,
            resolved_directory: None,
            saved_file_path: None,
            reason: Some("forbidden".to_string()),
            candidates: None,
        })
    }
}

fn resolve_target_directory(
    mounted_roots: &[String],
    target_directory: &str,
) -> Result<PathBuf, WriteWorkspaceFileResult> {
    let raw_target = normalize_target_input(target_directory);
    if raw_target.is_empty() || has_path_traversal(&raw_target) {
        return Err(WriteWorkspaceFileResult {
            ok: false,
            resolved_directory: None,
            saved_file_path: None,
            reason: Some("invalid_path".to_string()),
            candidates: None,
        });
    }

    let mut canonical_roots: Vec<PathBuf> = mounted_roots
        .iter()
        .filter_map(|root| canonicalize_existing_dir(Path::new(root)))
        .collect();
    canonical_roots.sort();
    canonical_roots.dedup();

    if canonical_roots.is_empty() {
        return Err(WriteWorkspaceFileResult {
            ok: false,
            resolved_directory: None,
            saved_file_path: None,
            reason: Some("forbidden".to_string()),
            candidates: None,
        });
    }

    if Path::new(&raw_target).is_absolute() {
        return resolve_absolute_target_directory(&canonical_roots, &raw_target);
    }

    let normalized_target = normalize_target_directory(&raw_target);
    if normalized_target.is_empty() {
        return Err(WriteWorkspaceFileResult {
            ok: false,
            resolved_directory: None,
            saved_file_path: None,
            reason: Some("invalid_path".to_string()),
            candidates: None,
        });
    }

    if normalized_target.contains('/') {
        let mut matches = Vec::new();
        for root in &canonical_roots {
            for relative in relative_target_variants(root, &normalized_target) {
                let candidate = root.join(relative);
                if let Some(canonical) = canonicalize_existing_dir(&candidate) {
                    if is_within_root(root, &canonical) {
                        matches.push(canonical);
                    }
                }
            }
        }
        matches.sort();
        matches.dedup();
        return match matches.len() {
            1 => Ok(matches.remove(0)),
            0 => Err(WriteWorkspaceFileResult {
                ok: false,
                resolved_directory: None,
                saved_file_path: None,
                reason: Some("not_found".to_string()),
                candidates: None,
            }),
            _ => Err(WriteWorkspaceFileResult {
                ok: false,
                resolved_directory: None,
                saved_file_path: None,
                reason: Some("ambiguous".to_string()),
                candidates: Some(
                    matches
                        .iter()
                        .map(|path| normalize_display_path(path))
                        .collect(),
                ),
            }),
        };
    }

    let mut matches = Vec::new();
    for root in &canonical_roots {
        let root_name = root
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        if root_name == normalized_target {
            matches.push(root.clone());
        }
        let _ = collect_matching_dirs_by_name(root, &normalized_target, &mut matches);
    }
    matches.sort();
    matches.dedup();

    match matches.len() {
        1 => Ok(matches.remove(0)),
        0 => Err(WriteWorkspaceFileResult {
            ok: false,
            resolved_directory: None,
            saved_file_path: None,
            reason: Some("not_found".to_string()),
            candidates: None,
        }),
        _ => Err(WriteWorkspaceFileResult {
            ok: false,
            resolved_directory: None,
            saved_file_path: None,
            reason: Some("ambiguous".to_string()),
            candidates: Some(
                matches
                    .iter()
                    .map(|path| normalize_display_path(path))
                    .collect(),
            ),
        }),
    }
}

fn resolve_target_directory_result(
    mounted_roots: &[String],
    target_directory: &str,
) -> Result<PathBuf, ResolveWorkspaceDirectoryResult> {
    resolve_target_directory(mounted_roots, target_directory).map_err(|result| {
        ResolveWorkspaceDirectoryResult {
            ok: result.ok,
            resolved_directory: result.resolved_directory,
            reason: result.reason,
            candidates: result.candidates,
        }
    })
}

#[tauri::command]
pub async fn resolve_workspace_directory(
    _app: AppHandle<impl Runtime>,
    mounted_roots: Vec<String>,
    target_directory: String,
) -> ResultPayload<ResolveWorkspaceDirectoryResult> {
    let trace = new_trace_id();
    match resolve_target_directory_result(&mounted_roots, &target_directory) {
        Ok(path) => ok(
            ResolveWorkspaceDirectoryResult {
                ok: true,
                resolved_directory: Some(normalize_display_path(&path)),
                reason: None,
                candidates: None,
            },
            trace,
        ),
        Err(result) => ok(result, trace),
    }
}

#[tauri::command]
pub async fn write_workspace_file(
    app: AppHandle<impl Runtime>,
    mounted_roots: Vec<String>,
    target_directory: String,
    file_name: String,
    content: String,
) -> ResultPayload<WriteWorkspaceFileResult> {
    let trace = new_trace_id();

    let resolved_dir = match resolve_target_directory(&mounted_roots, &target_directory) {
        Ok(path) => path,
        Err(result) => return ok(result, trace),
    };

    let safe_file_name = sanitize_file_name(&file_name);
    let target_path = resolved_dir.join(&safe_file_name);
    let normalized_target = normalize_display_path(&target_path);

    match fs::write(&target_path, content).await {
        Ok(()) => {
            let _ = search_db::upsert_search_index_entry(&app, &target_path);
            ok(
                WriteWorkspaceFileResult {
                    ok: true,
                    resolved_directory: Some(normalize_display_path(&resolved_dir)),
                    saved_file_path: Some(normalized_target),
                    reason: None,
                    candidates: None,
                },
                trace,
            )
        }
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("写入工作区文件失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
pub async fn create_workspace_directory(
    _app: AppHandle<impl Runtime>,
    mounted_roots: Vec<String>,
    parent_directory: String,
    directory_name: String,
) -> ResultPayload<CreateWorkspaceDirectoryResult> {
    let trace = new_trace_id();

    let resolved_parent = match resolve_target_directory(&mounted_roots, &parent_directory) {
        Ok(path) => path,
        Err(result) => {
            return ok(
                CreateWorkspaceDirectoryResult {
                    ok: false,
                    resolved_parent_directory: None,
                    created_directory_path: None,
                    reason: result.reason,
                    candidates: result.candidates,
                },
                trace,
            );
        }
    };

    let safe_directory_name = match sanitize_directory_name(&directory_name) {
        Some(name) => name,
        None => {
            return ok(
                CreateWorkspaceDirectoryResult {
                    ok: false,
                    resolved_parent_directory: None,
                    created_directory_path: None,
                    reason: Some("invalid_path".to_string()),
                    candidates: None,
                },
                trace,
            );
        }
    };

    let target_path = resolved_parent.join(&safe_directory_name);

    if target_path.exists() {
        if target_path.is_dir() {
            return ok(
                CreateWorkspaceDirectoryResult {
                    ok: false,
                    resolved_parent_directory: Some(normalize_display_path(&resolved_parent)),
                    created_directory_path: Some(normalize_display_path(&target_path)),
                    reason: Some("already_exists".to_string()),
                    candidates: None,
                },
                trace,
            );
        }

        return err_payload(
            ErrorCode::IoError,
            "目标路径已存在同名文件，无法创建目录".to_string(),
            trace,
        );
    }

    match fs::create_dir(&target_path).await {
        Ok(()) => ok(
            CreateWorkspaceDirectoryResult {
                ok: true,
                resolved_parent_directory: Some(normalize_display_path(&resolved_parent)),
                created_directory_path: Some(normalize_display_path(&target_path)),
                reason: None,
                candidates: None,
            },
            trace,
        ),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("创建工作区目录失败: {err}"),
            trace,
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::Manager;

    fn unique_test_dir(prefix: &str) -> PathBuf {
        std::env::temp_dir().join(format!("{prefix}-{}", new_trace_id().replace("trace_", "")))
    }

    #[test]
    fn should_resolve_relative_path_when_first_segment_matches_root_name() {
        let base = unique_test_dir("workspace-io-root-name");
        let root_a = base.join("离散数学");
        let root_b = base.join("另一个离散数学");
        let target = root_a.join("教案");

        std::fs::create_dir_all(&target).expect("target dir should exist");
        std::fs::create_dir_all(&root_b).expect("other root should exist");

        let result = resolve_target_directory(
            &[
                normalize_display_path(&root_a),
                normalize_display_path(&root_b),
            ],
            "离散数学/教案",
        )
        .expect("directory should resolve");

        assert_eq!(
            result,
            std::fs::canonicalize(&target).expect("canonical target")
        );

        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn should_resolve_unique_leaf_directory_name() {
        let base = unique_test_dir("workspace-io-leaf");
        let root_a = base.join("离散数学");
        let root_b = base.join("高等数学");
        let target = root_a.join("教案");

        std::fs::create_dir_all(&target).expect("target dir should exist");
        std::fs::create_dir_all(&root_b).expect("other root should exist");

        let result = resolve_target_directory(
            &[
                normalize_display_path(&root_a),
                normalize_display_path(&root_b),
            ],
            "教案",
        )
        .expect("directory should resolve");

        assert_eq!(
            result,
            std::fs::canonicalize(&target).expect("canonical target")
        );

        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn should_resolve_absolute_path_within_mounted_root() {
        let base = unique_test_dir("workspace-io-absolute-inside");
        let root = base.join("离散数学");
        let target = root.join("教案");

        std::fs::create_dir_all(&target).expect("target dir should exist");

        let result = resolve_target_directory(
            &[normalize_display_path(&root)],
            &normalize_display_path(&target),
        )
        .expect("absolute path within root should resolve");

        assert_eq!(
            result,
            std::fs::canonicalize(&target).expect("canonical target")
        );

        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn should_reject_absolute_path_outside_mounted_root() {
        let base = unique_test_dir("workspace-io-absolute-outside");
        let root = base.join("离散数学");
        let outside = base.join("别的目录").join("教案");

        std::fs::create_dir_all(&root).expect("root dir should exist");
        std::fs::create_dir_all(&outside).expect("outside dir should exist");

        let err = resolve_target_directory(
            &[normalize_display_path(&root)],
            &normalize_display_path(&outside),
        )
        .expect_err("absolute path outside root should be rejected");

        assert_eq!(err.reason.as_deref(), Some("forbidden"));

        let _ = std::fs::remove_dir_all(base);
    }

    #[tokio::test]
    async fn should_create_subdirectory_within_resolved_parent() {
        let base = unique_test_dir("workspace-io-create-dir");
        let root = base.join("离散数学");
        let parent = root.join("教案");
        let target = parent.join("第四章");

        std::fs::create_dir_all(&parent).expect("parent dir should exist");

        let result = create_workspace_directory(
            tauri::test::mock_app().app_handle().clone(),
            vec![normalize_display_path(&root)],
            "离散数学/教案".to_string(),
            "第四章".to_string(),
        )
        .await;

        let payload = match result {
            ResultPayload::Ok { data, .. } => data,
            ResultPayload::Err { error } => panic!("unexpected error: {:?}", error),
        };

        assert!(payload.ok);
        let created = payload
            .created_directory_path
            .as_deref()
            .expect("created directory path should exist");
        assert_eq!(
            std::fs::canonicalize(created).expect("canonical created path"),
            std::fs::canonicalize(&target).expect("canonical target")
        );
        assert!(target.is_dir());

        let _ = std::fs::remove_dir_all(base);
    }
}
