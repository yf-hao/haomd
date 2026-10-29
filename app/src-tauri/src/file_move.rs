use crate::file_io::{file_lock, hash_bytes, mtime_ms, normalize_path, MAX_FILE_BYTES};
use crate::{err_payload, new_trace_id, ok, ErrorCode, ResultPayload};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
};
use tokio::{fs, io::AsyncWriteExt, sync::Mutex};

static PLANS: Lazy<Mutex<HashMap<String, MovePlan>>> = Lazy::new(|| Mutex::new(HashMap::new()));
static MOVE_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));
static MOVE_SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn move_id() -> String {
    format!(
        "{}-{}-{}",
        new_trace_id(),
        std::process::id(),
        MOVE_SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    )
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveDocument {
    pub path: String,
    pub content: String,
    pub hash: String,
    pub mtime_ms: u64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MovePlan {
    pub operation_id: String,
    pub old_path: String,
    pub new_path: String,
    pub documents: Vec<MoveDocument>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MovePatch {
    pub path: String,
    pub expected_hash: String,
    pub content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveOutcome {
    pub old_path: String,
    pub new_path: String,
    pub documents: Vec<MoveDocument>,
    pub reconciliation_required: bool,
}

#[derive(Serialize, Deserialize)]
struct JournalEntry {
    before: MoveDocument,
    target: PathBuf,
    after_hash: String,
    staged: PathBuf,
}

#[derive(Serialize, Deserialize)]
struct MoveJournal {
    old_path: PathBuf,
    new_path: PathBuf,
    entries: Vec<JournalEntry>,
    destination_created: bool,
    committed: bool,
}

fn io_error(message: impl Into<String>) -> std::io::Error {
    std::io::Error::other(message.into())
}

fn numbered_path(source: &Path, directory: &Path, index: u32) -> PathBuf {
    if index == 0 {
        return directory.join(source.file_name().unwrap());
    }
    let stem = source.file_stem().unwrap_or_default().to_string_lossy();
    let extension = source
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    directory.join(format!("{stem}{index:02}{extension}"))
}

async fn snapshot(path: &Path) -> std::io::Result<MoveDocument> {
    let meta = fs::symlink_metadata(path).await?;
    if !meta.is_file() || meta.file_type().is_symlink() {
        return Err(io_error("只能移动和更新普通文件"));
    }
    if meta.len() > MAX_FILE_BYTES {
        return Err(io_error("文件超过大小上限"));
    }
    let bytes = fs::read(path).await?;
    let hash = hash_bytes(&bytes);
    let content = String::from_utf8(bytes).map_err(|_| io_error("仅支持 UTF-8 文档"))?;
    Ok(MoveDocument {
        path: path.to_string_lossy().into(),
        content,
        hash,
        mtime_ms: mtime_ms(&meta),
    })
}

fn path_error(action: &str, path: &Path, error: std::io::Error) -> std::io::Error {
    std::io::Error::new(
        error.kind(),
        format!("{action}「{}」失败：{error}", path.display()),
    )
}

async fn prepare(source: &str, directory: &str) -> std::io::Result<MovePlan> {
    let requested = normalize_path(source).map_err(|e| io_error(e.message))?;
    if fs::symlink_metadata(&requested)
        .await
        .map_err(|e| path_error("检查源文件", &requested, e))?
        .file_type()
        .is_symlink()
    {
        return Err(io_error("暂不支持移动符号链接"));
    }
    // Keep the paths used by the UI and relative links; canonical identities are
    // used for comparison and locking, never substituted into document content.
    let source_identity = fs::canonicalize(&requested)
        .await
        .map_err(|e| path_error("解析源文件", &requested, e))?;
    let source = requested;
    let directory = normalize_path(directory).map_err(|e| io_error(e.message))?;
    let directory_identity = fs::canonicalize(&directory)
        .await
        .map_err(|e| path_error("解析目标目录", &directory, e))?;
    let directory_metadata = fs::metadata(&directory)
        .await
        .map_err(|e| path_error("读取目标目录", &directory, e))?;
    if !directory_metadata.is_dir() {
        return Err(io_error("目标不是目录"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if fs::metadata(&source)
            .await
            .map_err(|e| path_error("读取源文件", &source, e))?
            .dev()
            != directory_metadata.dev()
        {
            return Err(io_error("暂不支持跨磁盘移动"));
        }
    }
    #[cfg(windows)]
    if source_identity.components().next() != directory_identity.components().next() {
        return Err(io_error("暂不支持跨磁盘移动"));
    }
    let initial = snapshot(&source)
        .await
        .map_err(|e| path_error("读取源文件", &source, e))?;
    if source_identity.parent() == Some(directory_identity.as_path()) {
        return Ok(MovePlan {
            operation_id: move_id(),
            old_path: initial.path.clone(),
            new_path: initial.path.clone(),
            documents: vec![initial],
        });
    }
    let mut destination = None;
    for index in 0..10_000 {
        let path = numbered_path(&source, &directory, index);
        match fs::symlink_metadata(&path).await {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                destination = Some(path);
                break;
            }
            Err(error) => return Err(path_error("检查目标文件名", &path, error)),
            Ok(_) => {}
        }
    }
    let destination = destination.ok_or_else(|| io_error("可用文件名尝试次数已达上限"))?;
    Ok(MovePlan {
        operation_id: move_id(),
        old_path: initial.path.clone(),
        new_path: destination.to_string_lossy().into(),
        documents: vec![initial],
    })
}

async fn write_exclusive(path: &Path, content: &[u8]) -> std::io::Result<()> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .await?;
    file.write_all(content).await?;
    file.sync_all().await
}

async fn save_journal(path: &Path, journal: &MoveJournal) -> std::io::Result<()> {
    let bytes = serde_json::to_vec(journal)?;
    let temp = path.with_extension("pending");
    let mut file = fs::File::create(&temp).await?;
    file.write_all(&bytes).await?;
    file.sync_all().await?;
    fs::rename(temp, path).await
}

async fn cleanup(path: &Path, journal: &MoveJournal) -> std::io::Result<()> {
    for entry in &journal.entries {
        if fs::try_exists(&entry.staged).await? {
            fs::remove_file(&entry.staged).await?;
        }
    }
    fs::remove_file(path).await
}

async fn rollback(journal: &MoveJournal) -> std::io::Result<()> {
    for entry in journal.entries.iter().rev() {
        let original = Path::new(&entry.before.path);
        if original == journal.old_path {
            if !fs::try_exists(original).await? {
                write_exclusive(original, entry.before.content.as_bytes()).await?;
            }
            if hash_bytes(&fs::read(original).await?) != entry.before.hash {
                return Err(io_error("源文件已被外部修改，保留恢复记录"));
            }
            // A crash can occur between hard_link and recording its completion.
            // The surviving staged hard link proves ownership without relying on
            // matching bytes (another program could have written the same data).
            let owns_destination = journal.destination_created
                || same_file::is_same_file(&entry.staged, &journal.new_path).unwrap_or(false);
            if owns_destination && fs::try_exists(&journal.new_path).await? {
                if hash_bytes(&fs::read(&journal.new_path).await?) != entry.after_hash {
                    return Err(io_error("目标已被外部修改，保留恢复记录"));
                }
                fs::remove_file(&journal.new_path).await?;
            }
        } else {
            let current = hash_bytes(&fs::read(original).await?);
            if current == entry.before.hash {
                continue;
            }
            if current != entry.after_hash {
                return Err(io_error("引用文档已被外部修改，保留恢复记录"));
            }
            let restore = original.with_file_name(format!(".haomd-restore-{}", move_id()));
            write_exclusive(&restore, entry.before.content.as_bytes()).await?;
            fs::rename(restore, original).await?;
        }
    }
    Ok(())
}

async fn commit(
    plan: MovePlan,
    patches: Vec<MovePatch>,
    journal_dir: &Path,
) -> std::io::Result<Vec<MoveDocument>> {
    let mut paths: Vec<PathBuf> = plan
        .documents
        .iter()
        .map(|d| PathBuf::from(&d.path))
        .collect();
    paths.push(PathBuf::from(&plan.old_path));
    paths.push(PathBuf::from(&plan.new_path));
    let mut lock_paths = Vec::new();
    for path in paths {
        lock_paths.push(crate::file_io::file_identity(&path).await);
    }
    lock_paths.sort();
    lock_paths.dedup();
    let mut guards = Vec::new();
    for path in lock_paths {
        guards.push(file_lock(&path).await.lock_owned().await);
    }
    // Validate the source snapshot before changing its path or content.
    for document in &plan.documents {
        if snapshot(Path::new(&document.path)).await?.hash != document.hash {
            return Err(io_error("源文档在移动准备期间被修改，请重试"));
        }
    }
    let mut updates = Vec::new();
    let mut seen = HashSet::new();
    for patch in patches {
        if !seen.insert(patch.path.clone()) {
            return Err(io_error("重复的文档补丁"));
        }
        let original = plan
            .documents
            .iter()
            .find(|d| d.path == patch.path && d.hash == patch.expected_hash)
            .ok_or_else(|| io_error("引用计划已失效"))?;
        if snapshot(Path::new(&patch.path)).await?.hash != original.hash {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "文件已被修改，请重新移动",
            ));
        }
        if patch.content.len() > MAX_FILE_BYTES as usize {
            return Err(io_error("改写内容超过上限"));
        }
        updates.push((original.clone(), patch.content));
    }
    if !seen.contains(&plan.old_path) {
        let original = plan
            .documents
            .iter()
            .find(|d| d.path == plan.old_path)
            .ok_or_else(|| io_error("缺少源文档"))?;
        if snapshot(Path::new(&plan.old_path)).await?.hash != original.hash {
            return Err(io_error("源文件已被修改"));
        }
        updates.push((original.clone(), original.content.clone()));
    }
    if plan.old_path == plan.new_path {
        return Ok(updates.into_iter().map(|(d, _)| d).collect());
    }
    fs::create_dir_all(journal_dir).await?;
    let journal_path = journal_dir.join(format!("{}.json", plan.operation_id));
    let mut journal = MoveJournal {
        old_path: plan.old_path.clone().into(),
        new_path: plan.new_path.clone().into(),
        entries: Vec::new(),
        destination_created: false,
        committed: false,
    };
    for (index, (before, content)) in updates.iter().enumerate() {
        let target = PathBuf::from(if before.path == plan.old_path {
            &plan.new_path
        } else {
            &before.path
        });
        let staged = target.with_file_name(format!(".haomd-move-{}-{index}", plan.operation_id));
        journal.entries.push(JournalEntry {
            before: before.clone(),
            target,
            after_hash: hash_bytes(content.as_bytes()),
            staged,
        });
    }
    save_journal(&journal_path, &journal).await?;
    let outcome = async {
        for (entry, (_, content)) in journal.entries.iter().zip(&updates) {
            write_exclusive(&entry.staged, content.as_bytes()).await?;
            fs::set_permissions(
                &entry.staged,
                fs::metadata(&entry.before.path).await?.permissions(),
            )
            .await?;
        }
        let source = journal
            .entries
            .iter()
            .find(|e| e.before.path == plan.old_path)
            .unwrap();
        // A hard link publishes the staged file atomically without replacing an
        // existing destination. Both paths are on the target filesystem.
        fs::hard_link(&source.staged, &journal.new_path).await?;
        journal.destination_created = true;
        save_journal(&journal_path, &journal).await?;
        for entry in &journal.entries {
            if hash_bytes(&fs::read(&entry.before.path).await?) != entry.before.hash {
                return Err(io_error("文件在移动期间被修改"));
            }
            if entry.before.path != plan.old_path {
                fs::rename(&entry.staged, &entry.target).await?;
            }
        }
        fs::remove_file(&journal.old_path).await?;
        journal.committed = true;
        save_journal(&journal_path, &journal).await?;
        Ok::<(), std::io::Error>(())
    }
    .await;
    if let Err(error) = outcome {
        if let Err(recovery) = rollback(&journal).await {
            return Err(io_error(format!("移动中止：{error}；{recovery}")));
        }
        cleanup(&journal_path, &journal).await?;
        return Err(error);
    }
    let mut result = Vec::new();
    for (entry, (_, content)) in journal.entries.iter().zip(updates) {
        result.push(MoveDocument {
            path: entry.target.to_string_lossy().into(),
            content,
            hash: entry.after_hash.clone(),
            mtime_ms: fs::metadata(&entry.target)
                .await
                .map(|m| mtime_ms(&m))
                .unwrap_or(entry.before.mtime_ms),
        });
    }
    // The command keeps this committed record until path metadata is migrated.
    Ok(result)
}

pub(crate) async fn recover_file_moves(app: &tauri::AppHandle) -> std::io::Result<()> {
    let directory = crate::haomd_paths::haomd_config_subdir(app, "file-moves")?;
    let mut entries = fs::read_dir(directory).await?;
    while let Some(entry) = entries.next_entry().await? {
        if entry.path().extension().map_or(true, |e| e != "json") {
            continue;
        }
        let journal: MoveJournal = serde_json::from_slice(&fs::read(entry.path()).await?)?;
        if !journal.committed {
            rollback(&journal).await?;
        } else {
            crate::state_store::relocate_file_records(
                app,
                &journal.old_path.to_string_lossy(),
                &journal.new_path.to_string_lossy(),
            )
            .await?;
            crate::search_db::rename_search_index_entry(app, &journal.old_path, &journal.new_path)
                .map_err(io_error)?;
            for changed in &journal.entries {
                crate::search_db::upsert_search_index_entry(app, &changed.target)
                    .map_err(io_error)?;
            }
        }
        cleanup(&entry.path(), &journal).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn prepare_file_move(
    source_path: String,
    target_directory: String,
) -> ResultPayload<MovePlan> {
    let trace = new_trace_id();
    match prepare(&source_path, &target_directory).await {
        Ok(plan) => {
            let mut plans = PLANS.lock().await;
            if plans.len() >= 8 {
                return err_payload(ErrorCode::CONFLICT, "待处理移动过多，请稍后重试", trace);
            }
            plans.insert(plan.operation_id.clone(), plan.clone());
            ok(plan, trace)
        }
        Err(error) => err_payload(ErrorCode::IoError, format!("准备移动失败：{error}"), trace),
    }
}

#[tauri::command]
pub async fn cancel_file_move(operation_id: String) {
    PLANS.lock().await.remove(&operation_id);
}

#[tauri::command]
pub async fn commit_file_move(
    app: tauri::AppHandle,
    operation_id: String,
    patches: Vec<MovePatch>,
) -> ResultPayload<MoveOutcome> {
    let trace = new_trace_id();
    let _guard = MOVE_LOCK.lock().await;
    let Some(plan) = PLANS.lock().await.remove(&operation_id) else {
        return err_payload(ErrorCode::CONFLICT, "移动计划已失效", trace);
    };
    let directory = match crate::haomd_paths::haomd_config_subdir(&app, "file-moves") {
        Ok(path) => path,
        Err(e) => return err_payload(ErrorCode::IoError, e.to_string(), trace),
    };
    match commit(plan.clone(), patches, &directory).await {
        Ok(documents) => {
            let mut reconcile = false;
            if let Err(e) =
                crate::state_store::relocate_file_records(&app, &plan.old_path, &plan.new_path)
                    .await
            {
                log::warn!("file move metadata reconciliation: {e}");
                reconcile = true;
            }
            if crate::search_db::rename_search_index_entry(
                &app,
                Path::new(&plan.old_path),
                Path::new(&plan.new_path),
            )
            .is_err()
            {
                reconcile = true;
            }
            for document in &documents {
                let _ =
                    crate::search_db::upsert_search_index_entry(&app, Path::new(&document.path));
            }
            if !reconcile {
                let path = directory.join(format!("{}.json", plan.operation_id));
                if let Ok(bytes) = fs::read(&path).await {
                    if let Ok(journal) = serde_json::from_slice::<MoveJournal>(&bytes) {
                        let _ = cleanup(&path, &journal).await;
                    }
                }
            }
            ok(
                MoveOutcome {
                    old_path: plan.old_path,
                    new_path: plan.new_path,
                    documents,
                    reconciliation_required: reconcile,
                },
                trace,
            )
        }
        Err(error) => {
            let code = if error.kind() == std::io::ErrorKind::AlreadyExists {
                ErrorCode::CONFLICT
            } else {
                ErrorCode::IoError
            };
            err_payload(code, format!("移动失败：{error}"), trace)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        root: PathBuf,
        source: PathBuf,
        target: PathBuf,
    }
    impl Fixture {
        async fn new() -> Self {
            let root = std::env::temp_dir().join(format!("haomd-move-test-{}", move_id()));
            fs::create_dir_all(root.join("old")).await.unwrap();
            fs::create_dir_all(root.join("new")).await.unwrap();
            let root = fs::canonicalize(root).await.unwrap();
            let source = root.join("old/note.md");
            fs::write(&source, "![image](images/a.png)").await.unwrap();
            Self {
                target: root.join("new"),
                root,
                source,
            }
        }
        async fn plan(&self) -> MovePlan {
            prepare(self.source.to_str().unwrap(), self.target.to_str().unwrap())
                .await
                .unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    #[tokio::test]
    #[ignore = "Manual local performance fixture; creates only temporary files"]
    async fn benchmark_overlapping_workspace_preparation() {
        let f = Fixture::new().await;
        let folder = f.root.join("old/workspace");
        fs::create_dir_all(&folder).await.unwrap();
        let content = "正文 text without local references.\n".repeat(1000);
        for index in 0..300 {
            std::fs::write(folder.join(format!("document-{index}.md")), &content).unwrap();
        }
        for index in 0..2000 {
            std::fs::write(folder.join(format!("asset-{index}.bin")), b"fixture").unwrap();
        }
        for _ in 0..3 {
            let start = std::time::Instant::now();
            let plan = prepare(f.source.to_str().unwrap(), f.target.to_str().unwrap())
                .await
                .unwrap();
            assert_eq!(plan.documents.len(), 1);
            eprintln!("move_prepare_ms={}", start.elapsed().as_millis());
        }
    }

    #[tokio::test]
    async fn numbering_preserves_existing_files_and_extension() {
        let f = Fixture::new().await;
        fs::write(f.target.join("note.md"), "existing")
            .await
            .unwrap();
        fs::create_dir(f.target.join("note01.md")).await.unwrap();
        let plan = f.plan().await;
        assert!(plan.new_path.ends_with("note02.md"));
        let patch = MovePatch {
            path: plan.old_path.clone(),
            expected_hash: plan.documents[0].hash.clone(),
            content: "![image](../old/images/a.png)".into(),
        };
        let result = commit(plan, vec![patch], &f.root.join("journal"))
            .await
            .unwrap();
        assert!(!f.source.exists());
        assert_eq!(result[0].content, "![image](../old/images/a.png)");
        assert_eq!(
            fs::read_to_string(f.target.join("note.md")).await.unwrap(),
            "existing"
        );
        assert_eq!(
            numbered_path(Path::new("note.md"), &f.target, 100),
            f.target.join("note100.md")
        );
        assert_eq!(
            numbered_path(Path::new("README"), &f.target, 1),
            f.target.join("README01")
        );
    }

    #[tokio::test]
    async fn preparation_reads_only_the_source_and_rejects_other_file_patches() {
        let f = Fixture::new().await;
        let unrelated = f.root.join("invalid-utf8.md");
        fs::write(&unrelated, [0xff, 0xfe]).await.unwrap();
        let plan = f.plan().await;
        assert_eq!(plan.documents.len(), 1);
        assert_eq!(plan.documents[0].path, f.source.to_string_lossy());
        let patch = MovePatch {
            path: unrelated.to_string_lossy().into(),
            expected_hash: hash_bytes(&[0xff, 0xfe]),
            content: "must not write".into(),
        };
        assert!(commit(plan, vec![patch], &f.root.join("journal"))
            .await
            .is_err());
        assert!(f.source.exists());
        assert_eq!(fs::read(&unrelated).await.unwrap(), [0xff, 0xfe]);
    }

    #[tokio::test]
    async fn missing_required_paths_are_reported_with_their_role_and_path() {
        let f = Fixture::new().await;
        let missing = f.root.join("missing");
        let error = prepare(f.source.to_str().unwrap(), missing.to_str().unwrap())
            .await
            .err()
            .expect("missing target must fail");
        assert_eq!(error.kind(), std::io::ErrorKind::NotFound);
        assert!(error.to_string().contains("目标目录"));
        assert!(error.to_string().contains(missing.to_str().unwrap()));
        assert!(f.source.exists());
        let error = prepare(missing.to_str().unwrap(), f.target.to_str().unwrap())
            .await
            .err()
            .expect("missing source must fail");
        assert_eq!(error.kind(), std::io::ErrorKind::NotFound);
        assert!(error.to_string().contains("源文件"));
        assert!(error.to_string().contains(missing.to_str().unwrap()));
    }

    #[tokio::test]
    async fn concurrent_destination_creation_is_never_overwritten() {
        let f = Fixture::new().await;
        let plan = f.plan().await;
        fs::write(&plan.new_path, "other operation").await.unwrap();
        let error = commit(plan.clone(), vec![], &f.root.join("journal"))
            .await
            .unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::AlreadyExists);
        assert_eq!(
            fs::read_to_string(plan.new_path).await.unwrap(),
            "other operation"
        );
        assert!(f.source.exists());
    }

    #[tokio::test]
    async fn stale_source_or_reference_content_aborts_before_moving() {
        let f = Fixture::new().await;
        let plan = f.plan().await;
        fs::write(&f.source, "new external content").await.unwrap();
        assert!(commit(plan, vec![], &f.root.join("journal")).await.is_err());
        assert_eq!(
            fs::read_to_string(&f.source).await.unwrap(),
            "new external content"
        );
        assert!(!f.target.join("note.md").exists());
    }

    #[tokio::test]
    async fn commit_updates_only_source_with_a_recoverable_record() {
        let f = Fixture::new().await;
        let index = f.root.join("index.md");
        fs::write(&index, "[note](old/note.md#part)").await.unwrap();
        let plan = f.plan().await;
        let patches = plan
            .documents
            .iter()
            .map(|document| MovePatch {
                path: document.path.clone(),
                expected_hash: document.hash.clone(),
                content: if document.path == plan.old_path {
                    "![image](../old/images/a.png)"
                } else {
                    "[note](new/note.md#part)"
                }
                .into(),
            })
            .collect();
        let result = commit(plan.clone(), patches, &f.root.join("journal"))
            .await
            .unwrap();
        assert_eq!(result.len(), 1);
        assert!(!f.source.exists());
        assert_eq!(
            fs::read_to_string(&index).await.unwrap(),
            "[note](old/note.md#part)"
        );
        let record = f
            .root
            .join("journal")
            .join(format!("{}.json", plan.operation_id));
        let journal: MoveJournal =
            serde_json::from_slice(&fs::read(&record).await.unwrap()).unwrap();
        assert!(journal.committed);
        // Simulate recovery of all content changes from the durable journal.
        rollback(&journal).await.unwrap();
        assert_eq!(
            fs::read_to_string(&index).await.unwrap(),
            "[note](old/note.md#part)"
        );
        assert_eq!(
            fs::read_to_string(&f.source).await.unwrap(),
            "![image](images/a.png)"
        );
        cleanup(&record, &journal).await.unwrap();
        assert!(!record.exists());
    }

    #[tokio::test]
    async fn changes_in_other_documents_do_not_block_or_get_rewritten() {
        let f = Fixture::new().await;
        let index = f.root.join("index.md");
        fs::write(&index, "no links yet").await.unwrap();
        let plan = f.plan().await;
        fs::write(&index, "[added during move](old/note.md)")
            .await
            .unwrap();
        assert!(commit(plan, vec![], &f.root.join("journal")).await.is_ok());
        assert!(!f.source.exists());
        assert!(f.target.join("note.md").exists());
        assert_eq!(
            fs::read_to_string(&index).await.unwrap(),
            "[added during move](old/note.md)"
        );
    }

    #[tokio::test]
    async fn recovery_recognizes_a_published_destination_before_the_journal_flag() {
        let f = Fixture::new().await;
        let before = snapshot(&f.source).await.unwrap();
        let target = f.target.join("note.md");
        let staged = f.target.join("staged");
        fs::write(&staged, "rewritten").await.unwrap();
        fs::hard_link(&staged, &target).await.unwrap();
        let journal = MoveJournal {
            old_path: f.source.clone(),
            new_path: target.clone(),
            committed: false,
            destination_created: false,
            entries: vec![JournalEntry {
                before,
                target: target.clone(),
                after_hash: hash_bytes(b"rewritten"),
                staged,
            }],
        };
        rollback(&journal).await.unwrap();
        assert!(f.source.exists());
        assert!(!target.exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn directory_aliases_keep_display_paths_but_share_locks_and_noop_identity() {
        let f = Fixture::new().await;
        let alias = f.root.join("alias");
        std::os::unix::fs::symlink(f.root.join("old"), &alias).unwrap();
        let alias_source = alias.join("note.md");
        let plan = prepare(alias_source.to_str().unwrap(), f.target.to_str().unwrap())
            .await
            .unwrap();
        assert_eq!(plan.old_path, alias_source.to_string_lossy());
        assert!(std::sync::Arc::ptr_eq(
            &file_lock(&f.source).await,
            &file_lock(&alias_source).await
        ));
        let plan = prepare(f.source.to_str().unwrap(), alias.to_str().unwrap())
            .await
            .unwrap();
        assert_eq!(plan.old_path, plan.new_path);
    }

    #[tokio::test]
    async fn rollback_restores_source_and_reference_and_does_not_overwrite_external_edits() {
        let f = Fixture::new().await;
        let before = snapshot(&f.source).await.unwrap();
        let target = f.target.join("note.md");
        fs::write(&target, "moved").await.unwrap();
        fs::remove_file(&f.source).await.unwrap();
        let journal = MoveJournal {
            old_path: f.source.clone(),
            new_path: target.clone(),
            committed: false,
            destination_created: true,
            entries: vec![JournalEntry {
                before: before.clone(),
                target: target.clone(),
                after_hash: hash_bytes(b"moved"),
                staged: f.root.join("staged"),
            }],
        };
        rollback(&journal).await.unwrap();
        assert_eq!(snapshot(&f.source).await.unwrap().hash, before.hash);
        assert!(!target.exists());
        fs::write(&target, "external change").await.unwrap();
        assert!(rollback(&journal).await.is_err());
        assert_eq!(fs::read_to_string(target).await.unwrap(), "external change");
    }
}
