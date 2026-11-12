use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use mdictlib::{MddFile, MdxFile};
use serde::Serialize;
use tauri::State;

#[derive(Clone, Default)]
pub(crate) struct DictionaryService {
    opened: Arc<Mutex<Option<OpenedDictionary>>>,
}

struct OpenedDictionary {
    mdx_path: PathBuf,
    mdx: MdxFile,
    mdd: MddFile,
}

#[derive(Serialize)]
pub(crate) struct DictionaryInfo {
    path: String,
    title: String,
    entries: u64,
}

#[derive(Serialize)]
pub(crate) struct DictionaryRecord {
    key: String,
    html: String,
}

fn resolve_mdd_path(mdx_path: &Path) -> Result<PathBuf, String> {
    if mdx_path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_none_or(|ext| !ext.eq_ignore_ascii_case("mdx"))
    {
        return Err("请选择 .mdx 词典文件".to_string());
    }
    let mut mdd_path = mdx_path.to_path_buf();
    mdd_path.set_extension("mdd");
    if !mdd_path.is_file() {
        return Err(format!("未找到配套资源文件：{}", mdd_path.display()));
    }
    Ok(mdd_path)
}

fn lock_error() -> String {
    "本地词典正在被其他操作使用，请稍后重试".to_string()
}

#[tauri::command]
pub(crate) async fn open_dictionary(
    state: State<'_, DictionaryService>,
    mdx_path: String,
) -> Result<DictionaryInfo, String> {
    let service = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        let path = PathBuf::from(mdx_path);
        if let Some(opened) = service.opened.lock().map_err(|_| lock_error())?.as_ref() {
            if opened.mdx_path == path {
                return Ok(DictionaryInfo {
                    path: path.to_string_lossy().into_owned(),
                    title: opened
                        .mdx
                        .header()
                        .title()
                        .unwrap_or("本地词典")
                        .to_string(),
                    entries: opened.mdx.len(),
                });
            }
        }
        let mdd_path = resolve_mdd_path(&path)?;
        let mdx = MdxFile::open(&path).map_err(|error| format!("无法读取词典索引：{error}"))?;
        let mdd = MddFile::open(&mdd_path).map_err(|error| format!("无法读取词典资源：{error}"))?;
        let info = DictionaryInfo {
            path: path.to_string_lossy().into_owned(),
            title: mdx.header().title().unwrap_or("本地词典").to_string(),
            entries: mdx.len(),
        };
        *service.opened.lock().map_err(|_| lock_error())? = Some(OpenedDictionary {
            mdx_path: path,
            mdx,
            mdd,
        });
        Ok(info)
    })
    .await
    .map_err(|error| format!("加载本地词典失败：{error}"))?
}

#[tauri::command]
pub(crate) async fn lookup_dictionary(
    state: State<'_, DictionaryService>,
    mdx_path: String,
    word: String,
) -> Result<Option<DictionaryRecord>, String> {
    let service = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        let opened = service.opened.lock().map_err(|_| lock_error())?;
        let dictionary = opened
            .as_ref()
            .filter(|dictionary| dictionary.mdx_path == PathBuf::from(&mdx_path))
            .ok_or_else(|| "本地词典尚未加载，请重新选择词典文件".to_string())?;
        let entry = dictionary
            .mdx
            .lookup(word.trim())
            .map_err(|error| format!("查询词典失败：{error}"))?;
        Ok(entry.map(|entry| DictionaryRecord {
            key: entry.key().to_string(),
            html: entry.text().to_string(),
        }))
    })
    .await
    .map_err(|error| format!("查询本地词典失败：{error}"))?
}

#[tauri::command]
pub(crate) async fn read_dictionary_audio(
    state: State<'_, DictionaryService>,
    mdx_path: String,
    resource_key: String,
) -> Result<Option<String>, String> {
    let service = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        let opened = service.opened.lock().map_err(|_| lock_error())?;
        let dictionary = opened
            .as_ref()
            .filter(|dictionary| dictionary.mdx_path == PathBuf::from(&mdx_path))
            .ok_or_else(|| "本地词典尚未加载，请重新选择词典文件".to_string())?;
        let resource_key = resource_key
            .strip_prefix("sound://")
            .unwrap_or(&resource_key)
            .trim_start_matches('/')
            .replace('/', "\\");
        let mdd_key = format!("\\{resource_key}");
        let Some(resource) = dictionary
            .mdd
            .lookup(&mdd_key)
            .map_err(|error| format!("读取词典发音失败：{error}"))?
        else {
            return Ok(None);
        };
        let extension = Path::new(&resource_key)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("mp3");
        let mime = mime_guess::from_ext(extension)
            .first_or_octet_stream()
            .to_string();
        let encoded = base64::encode(resource.bytes());
        Ok(Some(format!("data:{mime};base64,{encoded}")))
    })
    .await
    .map_err(|error| format!("读取词典发音失败：{error}"))?
}
