use crate::{
    notes_config::notes_config_path,
    search_commands::{gather_search_files, normalize_display_path, SearchScope},
};
use log::warn;
use once_cell::sync::OnceCell;
use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Mutex as StdMutex;
use std::time::Duration;
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Runtime};
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};

const SEARCH_DB_FILE_NAME: &str = "search_index.sqlite3";
const MAX_INDEXABLE_FILE_BYTES: u64 = 2 * 1024 * 1024;
const META_KEY_SCOPE_SIGNATURE: &str = "scope_signature";
const SEARCH_INDEX_BATCH_WINDOW_MS: u64 = 300;
const SEARCHABLE_EXTENSIONS: &[&str] = &[
    "md", "markdown", "mdx", "txt", "json", "yaml", "yml", "toml", "ini", "env", "ts", "tsx", "js",
    "jsx", "css", "html", "sql", "csv",
];
static SEARCH_DB_WRITE_LOCK: StdMutex<()> = StdMutex::new(());
static SEARCH_INDEX_UPDATE_QUEUE: OnceCell<UnboundedSender<SearchIndexOp>> = OnceCell::new();

#[derive(Debug, Clone)]
enum SearchIndexOp {
    Upsert(PathBuf),
    Delete(PathBuf),
    Rename {
        old_path: PathBuf,
        new_path: PathBuf,
    },
}

pub fn ensure_search_index_for_scope<R: Runtime>(
    app: &AppHandle<R>,
    scope: &SearchScope,
) -> Result<usize, String> {
    let conn = open_search_db(app)?;
    init_search_db(&conn)?;
    let current_signature = build_scope_signature(scope);
    let stored_signature = load_meta_value(&conn, META_KEY_SCOPE_SIGNATURE)?;
    let indexed_files = count_indexed_files(&conn)?;

    if stored_signature.as_deref() != Some(current_signature.as_str()) || indexed_files == 0 {
        return rebuild_search_index_for_scope(app, scope);
    }

    Ok(indexed_files)
}

pub fn rebuild_search_index_for_scope<R: Runtime>(
    app: &AppHandle<R>,
    scope: &SearchScope,
) -> Result<usize, String> {
    let mut conn = open_search_db(app)?;
    init_search_db(&conn)?;
    let _guard = SEARCH_DB_WRITE_LOCK
        .lock()
        .map_err(|_| "获取搜索索引写锁失败".to_string())?;

    let files = gather_search_files(scope);
    let tx = conn
        .transaction()
        .map_err(|err| format!("启动搜索索引事务失败: {err}"))?;
    tx.execute("DELETE FROM search_files", [])
        .map_err(|err| format!("清空搜索文件索引失败: {err}"))?;
    tx.execute("DELETE FROM search_fts", [])
        .map_err(|err| format!("清空 FTS5 索引失败: {err}"))?;

    let mut indexed = 0usize;
    for path in files {
        let Ok(meta) = std::fs::metadata(&path) else {
            continue;
        };
        if meta.len() > MAX_INDEXABLE_FILE_BYTES || !meta.is_file() {
            continue;
        }
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        let Ok(content) = String::from_utf8(bytes) else {
            continue;
        };

        let display_path = normalize_display_path(&path);
        let scope_root = resolve_scope_root(scope, &display_path);
        let mtime_ms = meta
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as i64)
            .unwrap_or(0);
        let size_bytes = meta.len() as i64;

        tx.execute(
            "INSERT OR REPLACE INTO search_files(path, scope_root, mtime_ms, size_bytes) VALUES (?1, ?2, ?3, ?4)",
            params![display_path, scope_root, mtime_ms, size_bytes],
        )
        .map_err(|err| format!("写入搜索文件索引失败: {err}"))?;
        tx.execute(
            "INSERT INTO search_fts(path, content) VALUES (?1, ?2)",
            params![display_path, content],
        )
        .map_err(|err| format!("写入 FTS5 内容索引失败: {err}"))?;
        indexed += 1;
    }

    let scope_signature = build_scope_signature(scope);
    tx.execute(
        "INSERT OR REPLACE INTO search_meta(key, value) VALUES (?1, ?2)",
        params![META_KEY_SCOPE_SIGNATURE, scope_signature],
    )
    .map_err(|err| format!("写入搜索索引元数据失败: {err}"))?;

    tx.commit()
        .map_err(|err| format!("提交搜索索引事务失败: {err}"))?;
    Ok(indexed)
}

pub fn search_indexed_candidates<R: Runtime>(
    app: &AppHandle<R>,
    query: &str,
    limit: usize,
) -> Result<Vec<PathBuf>, String> {
    let conn = open_search_db(app)?;
    init_search_db(&conn)?;
    let fts_query = build_fts5_query(query);
    let mut stmt = conn
        .prepare("SELECT path FROM search_fts WHERE search_fts MATCH ?1 LIMIT ?2")
        .map_err(|err| format!("准备 FTS5 查询失败: {err}"))?;
    let rows = stmt
        .query_map(params![fts_query, limit as i64], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|err| format!("执行 FTS5 查询失败: {err}"))?;

    let mut seen = HashSet::new();
    let mut files = Vec::new();
    for row in rows {
        let path = row.map_err(|err| format!("读取 FTS5 查询结果失败: {err}"))?;
        if seen.insert(path.clone()) {
            files.push(PathBuf::from(path));
        }
    }

    Ok(files)
}

pub fn upsert_search_index_entry<R: Runtime>(
    app: &AppHandle<R>,
    path: &Path,
) -> Result<(), String> {
    enqueue_search_index_op(app, SearchIndexOp::Upsert(path.to_path_buf()))
}

pub fn delete_search_index_entry<R: Runtime>(
    app: &AppHandle<R>,
    path: &Path,
) -> Result<(), String> {
    enqueue_search_index_op(app, SearchIndexOp::Delete(path.to_path_buf()))
}

pub fn rename_search_index_entry<R: Runtime>(
    app: &AppHandle<R>,
    old_path: &Path,
    new_path: &Path,
) -> Result<(), String> {
    enqueue_search_index_op(
        app,
        SearchIndexOp::Rename {
            old_path: old_path.to_path_buf(),
            new_path: new_path.to_path_buf(),
        },
    )
}

fn enqueue_search_index_op<R: Runtime>(
    app: &AppHandle<R>,
    op: SearchIndexOp,
) -> Result<(), String> {
    let sender = search_index_update_sender(app)?;
    sender
        .send(op)
        .map_err(|err| format!("提交搜索索引更新任务失败: {err}"))
}

fn search_index_update_sender<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<&'static UnboundedSender<SearchIndexOp>, String> {
    SEARCH_INDEX_UPDATE_QUEUE.get_or_try_init(|| {
        let (tx, rx) = unbounded_channel();
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            run_search_index_update_worker(app, rx).await;
        });
        Ok::<_, String>(tx)
    })
}

async fn run_search_index_update_worker<R: Runtime>(
    app: AppHandle<R>,
    mut rx: UnboundedReceiver<SearchIndexOp>,
) {
    while let Some(first_op) = rx.recv().await {
        let mut batch = vec![first_op];
        let sleep = tokio::time::sleep(Duration::from_millis(SEARCH_INDEX_BATCH_WINDOW_MS));
        tokio::pin!(sleep);

        loop {
            tokio::select! {
                _ = &mut sleep => break,
                maybe_op = rx.recv() => {
                    match maybe_op {
                        Some(op) => batch.push(op),
                        None => break,
                    }
                }
            }
        }

        if let Err(err) = apply_search_index_batch(&app, &batch) {
            warn!("search index batch update failed: {err}");
        }
    }
}

fn apply_search_index_batch<R: Runtime>(
    app: &AppHandle<R>,
    batch: &[SearchIndexOp],
) -> Result<(), String> {
    if batch.is_empty() {
        return Ok(());
    }

    let conn = open_search_db(app)?;
    init_search_db(&conn)?;
    let _guard = SEARCH_DB_WRITE_LOCK
        .lock()
        .map_err(|_| "获取搜索索引写锁失败".to_string())?;

    for op in batch {
        match op {
            SearchIndexOp::Upsert(path) => upsert_search_index_entry_with_conn(&conn, path)?,
            SearchIndexOp::Delete(path) => delete_search_index_entry_with_conn(&conn, path)?,
            SearchIndexOp::Rename { old_path, new_path } => {
                rename_search_index_entry_with_conn(&conn, old_path, new_path)?
            }
        }
    }

    Ok(())
}

fn open_search_db<R: Runtime>(app: &AppHandle<R>) -> Result<Connection, String> {
    let notes_path =
        notes_config_path(app).map_err(|err| format!("获取 notes_config.json 路径失败: {err}"))?;
    let Some(settings_dir) = notes_path.parent() else {
        return Err("无法确定 notes_config.json 所在目录".to_string());
    };
    std::fs::create_dir_all(settings_dir).map_err(|err| format!("创建搜索索引目录失败: {err}"))?;
    let db_path = settings_dir.join(SEARCH_DB_FILE_NAME);
    Connection::open(db_path).map_err(|err| format!("打开搜索索引数据库失败: {err}"))
}

fn init_search_db(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS search_files (
            path TEXT PRIMARY KEY,
            scope_root TEXT NOT NULL,
            mtime_ms INTEGER NOT NULL,
            size_bytes INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS search_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS search_fts
        USING fts5(
            path UNINDEXED,
            content,
            tokenize = 'unicode61'
        );
        ",
    )
    .map_err(|err| format!("初始化搜索索引数据库失败: {err}"))
}

fn is_searchable_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| SEARCHABLE_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn upsert_search_index_entry_with_conn(conn: &Connection, path: &Path) -> Result<(), String> {
    if !is_searchable_file(path) {
        return Ok(());
    }

    let meta = std::fs::metadata(path).map_err(|err| format!("读取索引文件元数据失败: {err}"))?;
    if !meta.is_file() {
        return Ok(());
    }
    if meta.len() > MAX_INDEXABLE_FILE_BYTES {
        return Ok(());
    }

    let bytes = std::fs::read(path).map_err(|err| format!("读取索引文件失败: {err}"))?;
    let content = match String::from_utf8(bytes) {
        Ok(value) => value,
        Err(_) => return Ok(()),
    };

    let display_path = normalize_display_path(path);
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0);
    let size_bytes = meta.len() as i64;

    conn.execute(
        "DELETE FROM search_fts WHERE path = ?1",
        params![display_path.clone()],
    )
    .map_err(|err| format!("清理旧 FTS5 索引失败: {err}"))?;
    conn.execute(
        "INSERT OR REPLACE INTO search_files(path, scope_root, mtime_ms, size_bytes) VALUES (?1, ?2, ?3, ?4)",
        params![display_path.clone(), display_path.clone(), mtime_ms, size_bytes],
    )
    .map_err(|err| format!("写入搜索文件索引失败: {err}"))?;
    conn.execute(
        "INSERT INTO search_fts(path, content) VALUES (?1, ?2)",
        params![display_path, content],
    )
    .map_err(|err| format!("写入 FTS5 内容索引失败: {err}"))?;
    Ok(())
}

fn delete_search_index_entry_with_conn(conn: &Connection, path: &Path) -> Result<(), String> {
    let normalized_path = normalize_display_path(path);
    let like_prefix = format!("{normalized_path}/%");
    conn.execute(
        "DELETE FROM search_files WHERE path = ?1 OR path LIKE ?2",
        params![normalized_path, like_prefix],
    )
    .map_err(|err| format!("删除搜索文件索引失败: {err}"))?;
    conn.execute(
        "DELETE FROM search_fts WHERE path = ?1 OR path LIKE ?2",
        params![normalized_path, like_prefix],
    )
    .map_err(|err| format!("删除 FTS5 索引失败: {err}"))?;
    Ok(())
}

fn rename_search_index_entry_with_conn(
    conn: &Connection,
    old_path: &Path,
    new_path: &Path,
) -> Result<(), String> {
    let old_display = normalize_display_path(old_path);
    let new_display = normalize_display_path(new_path);
    let old_like_prefix = format!("{old_display}/%");
    let old_prefix_len_plus_one = old_display.len() as i64 + 1;

    conn.execute(
        "UPDATE search_files
         SET path = CASE
           WHEN path = ?1 THEN ?2
           ELSE ?2 || substr(path, ?5)
         END
         WHERE path = ?1 OR path LIKE ?3",
        params![
            old_display,
            new_display,
            old_like_prefix,
            new_display,
            old_prefix_len_plus_one
        ],
    )
    .map_err(|err| format!("更新搜索文件索引路径失败: {err}"))?;
    conn.execute(
        "UPDATE search_fts
         SET path = CASE
           WHEN path = ?1 THEN ?2
           ELSE ?2 || substr(path, ?5)
         END
         WHERE path = ?1 OR path LIKE ?3",
        params![
            old_display,
            new_display,
            old_like_prefix,
            new_display,
            old_prefix_len_plus_one
        ],
    )
    .map_err(|err| format!("更新 FTS5 索引路径失败: {err}"))?;

    upsert_search_index_entry_with_conn(conn, new_path)?;

    Ok(())
}

fn build_fts5_query(query: &str) -> String {
    format!("\"{}\"", query.trim().replace('"', "\"\""))
}

fn build_scope_signature(scope: &SearchScope) -> String {
    let mut folder_roots = scope.folder_roots.clone();
    folder_roots.sort();
    let mut standalone_files = scope.standalone_files.clone();
    standalone_files.sort();

    let mut hasher = Sha256::new();
    hasher.update(folder_roots.join("\n"));
    hasher.update(b"\n--\n");
    hasher.update(standalone_files.join("\n"));
    format!("{:x}", hasher.finalize())
}

fn load_meta_value(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    let mut stmt = conn
        .prepare("SELECT value FROM search_meta WHERE key = ?1 LIMIT 1")
        .map_err(|err| format!("准备搜索索引元数据查询失败: {err}"))?;
    let mut rows = stmt
        .query(params![key])
        .map_err(|err| format!("执行搜索索引元数据查询失败: {err}"))?;
    if let Some(row) = rows
        .next()
        .map_err(|err| format!("读取搜索索引元数据失败: {err}"))?
    {
        let value = row
            .get::<_, String>(0)
            .map_err(|err| format!("读取搜索索引元数据值失败: {err}"))?;
        Ok(Some(value))
    } else {
        Ok(None)
    }
}

fn count_indexed_files(conn: &Connection) -> Result<usize, String> {
    conn.query_row("SELECT COUNT(*) FROM search_files", [], |row| {
        row.get::<_, i64>(0)
    })
    .map(|count| count.max(0) as usize)
    .map_err(|err| format!("统计搜索索引文件数失败: {err}"))
}

fn resolve_scope_root(scope: &SearchScope, display_path: &str) -> String {
    for root in &scope.folder_roots {
        if display_path == root || display_path.starts_with(&format!("{root}/")) {
            return root.clone();
        }
    }
    display_path.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn should_build_phrase_fts_query() {
        assert_eq!(build_fts5_query("demo"), "\"demo\"");
        assert_eq!(build_fts5_query("a\"b"), "\"a\"\"b\"");
    }

    #[test]
    fn should_build_stable_scope_signature() {
        let a = build_scope_signature(&SearchScope {
            folder_roots: vec!["/b".into(), "/a".into()],
            standalone_files: vec!["/d".into(), "/c".into()],
        });
        let b = build_scope_signature(&SearchScope {
            folder_roots: vec!["/a".into(), "/b".into()],
            standalone_files: vec!["/c".into(), "/d".into()],
        });
        assert_eq!(a, b);
    }

    fn unique_dir(prefix: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "{prefix}-{}",
            crate::new_trace_id().replace("trace_", "")
        ))
    }

    #[test]
    fn should_upsert_and_delete_index_entry() {
        let root = unique_dir("search-db-upsert-delete");
        fs::create_dir_all(&root).expect("create root");
        let file = root.join("demo.md");
        fs::write(&file, "hello world").expect("write file");

        let conn = Connection::open_in_memory().expect("open memory db");
        init_search_db(&conn).expect("init db");
        upsert_search_index_entry_with_conn(&conn, &file).expect("upsert");

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM search_files", [], |row| row.get(0))
            .expect("count search_files");
        assert_eq!(count, 1);

        delete_search_index_entry_with_conn(&conn, &file).expect("delete");

        let count_after: i64 = conn
            .query_row("SELECT COUNT(*) FROM search_files", [], |row| row.get(0))
            .expect("count search_files after delete");
        assert_eq!(count_after, 0);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn should_rename_indexed_directory_prefixes() {
        let root = unique_dir("search-db-rename-prefix");
        let old_dir = root.join("old");
        let old_nested = old_dir.join("nested");
        fs::create_dir_all(&old_nested).expect("create old nested");
        let old_file = old_nested.join("demo.md");
        fs::write(&old_file, "hello world").expect("write file");

        let conn = Connection::open_in_memory().expect("open memory db");
        init_search_db(&conn).expect("init db");
        upsert_search_index_entry_with_conn(&conn, &old_file).expect("upsert");

        let new_dir = root.join("new");
        fs::rename(&old_dir, &new_dir).expect("rename dir");
        let new_file = new_dir.join("nested").join("demo.md");

        rename_search_index_entry_with_conn(&conn, &old_dir, &new_dir).expect("rename index");

        let indexed_path: String = conn
            .query_row("SELECT path FROM search_files LIMIT 1", [], |row| {
                row.get(0)
            })
            .expect("load indexed path");
        assert_eq!(indexed_path, normalize_display_path(&new_file));

        let _ = fs::remove_dir_all(root);
    }
}
