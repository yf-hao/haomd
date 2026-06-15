use crate::haomd_paths::haomd_config_file;
use crate::{err_payload, new_trace_id, ok, ErrorCode, ResultPayload};
use base64::{decode as base64_decode, encode as base64_encode};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tauri::AppHandle;
use tokio::fs;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupSettingsCfg {
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredBackupSettingsCfg {
    #[serde(default)]
    enabled: Option<bool>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    password_encrypted: Option<String>,
    #[serde(default)]
    password: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyWebDavBackupSettingsCfg {
    #[serde(default)]
    enabled: Option<bool>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    password: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyBackupSettingsCfg {
    #[serde(default)]
    webdav: Option<LegacyWebDavBackupSettingsCfg>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyEditorSettingsCfg {
    #[serde(default)]
    backup: Option<LegacyBackupSettingsCfg>,
}

pub fn default_backup_settings() -> BackupSettingsCfg {
    BackupSettingsCfg {
        enabled: Some(false),
        url: Some(String::new()),
        username: Some(String::new()),
        password: Some(String::new()),
    }
}

fn backup_settings_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    haomd_config_file(app, ".backup_settings.json")
}

fn backup_key_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    haomd_config_file(app, ".backup_key")
}

fn legacy_editor_settings_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    haomd_config_file(app, "editor_settings.json")
}

async fn load_legacy_backup_settings(app: &AppHandle) -> Option<BackupSettingsCfg> {
    let path = legacy_editor_settings_path(app).ok()?;
    let bytes = fs::read(path).await.ok()?;
    let legacy: LegacyEditorSettingsCfg = serde_json::from_slice(&bytes).ok()?;
    let webdav = legacy.backup?.webdav?;
    Some(BackupSettingsCfg {
        enabled: webdav.enabled,
        url: webdav.url,
        username: webdav.username,
        password: webdav.password,
    })
}

async fn load_or_create_backup_key(app: &AppHandle) -> std::io::Result<Vec<u8>> {
    let path = backup_key_path(app)?;
    match fs::read(&path).await {
        Ok(bytes) if bytes.len() == 32 => Ok(bytes),
        Ok(_) => {
            let mut key = vec![0_u8; 32];
            rand::thread_rng().fill_bytes(&mut key);
            fs::write(&path, &key).await?;
            Ok(key)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            let mut key = vec![0_u8; 32];
            rand::thread_rng().fill_bytes(&mut key);
            fs::write(&path, &key).await?;
            Ok(key)
        }
        Err(err) => Err(err),
    }
}

fn derive_keystream_block(key: &[u8], nonce: &[u8], counter: u32) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(key);
    hasher.update(nonce);
    hasher.update(counter.to_le_bytes());
    let digest = hasher.finalize();
    let mut block = [0_u8; 32];
    block.copy_from_slice(&digest);
    block
}

fn encrypt_password(key: &[u8], password: &str) -> String {
    if password.is_empty() {
        return String::new();
    }
    let mut nonce = [0_u8; 16];
    rand::thread_rng().fill_bytes(&mut nonce);
    let mut ciphertext = password.as_bytes().to_vec();
    let mut offset = 0usize;
    let mut counter = 0u32;
    while offset < ciphertext.len() {
        let block = derive_keystream_block(key, &nonce, counter);
        for (idx, byte) in ciphertext[offset..].iter_mut().take(32).enumerate() {
            *byte ^= block[idx];
        }
        offset += 32;
        counter = counter.saturating_add(1);
    }
    let mut payload = nonce.to_vec();
    payload.extend_from_slice(&ciphertext);
    base64_encode(payload)
}

fn decrypt_password(key: &[u8], encoded: &str) -> Option<String> {
    if encoded.is_empty() {
        return Some(String::new());
    }
    let payload = base64_decode(encoded).ok()?;
    if payload.len() < 16 {
        return None;
    }
    let (nonce, ciphertext) = payload.split_at(16);
    let mut plain = ciphertext.to_vec();
    let mut offset = 0usize;
    let mut counter = 0u32;
    while offset < plain.len() {
        let block = derive_keystream_block(key, nonce, counter);
        for (idx, byte) in plain[offset..].iter_mut().take(32).enumerate() {
            *byte ^= block[idx];
        }
        offset += 32;
        counter = counter.saturating_add(1);
    }
    String::from_utf8(plain).ok()
}

#[tauri::command]
pub async fn load_backup_settings(app: AppHandle) -> ResultPayload<BackupSettingsCfg> {
    let trace = new_trace_id();
    let path = match backup_settings_path(&app) {
        Ok(p) => p,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取 backup_settings 路径失败: {err}"),
                trace,
            );
        }
    };

    match fs::read(&path).await {
        Ok(bytes) => {
            let stored: StoredBackupSettingsCfg =
                serde_json::from_slice(&bytes).unwrap_or(StoredBackupSettingsCfg {
                    enabled: Some(false),
                    url: Some(String::new()),
                    username: Some(String::new()),
                    password_encrypted: None,
                    password: Some(String::new()),
                });
            let password = if let Some(encrypted) = stored.password_encrypted.as_deref() {
                match load_or_create_backup_key(&app).await {
                    Ok(key) => decrypt_password(&key, encrypted).unwrap_or_default(),
                    Err(_) => String::new(),
                }
            } else {
                stored.password.unwrap_or_default()
            };
            let cfg = BackupSettingsCfg {
                enabled: stored.enabled,
                url: stored.url,
                username: stored.username,
                password: Some(password),
            };
            ok(cfg, trace)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            if let Some(cfg) = load_legacy_backup_settings(&app).await {
                ok(cfg, trace)
            } else {
                ok(default_backup_settings(), trace)
            }
        }
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("读取 backup_settings 失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
pub async fn save_backup_settings(app: AppHandle, cfg: BackupSettingsCfg) -> ResultPayload<()> {
    let trace = new_trace_id();
    let path = match backup_settings_path(&app) {
        Ok(p) => p,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取 backup_settings 路径失败: {err}"),
                trace,
            );
        }
    };

    let key = match load_or_create_backup_key(&app).await {
        Ok(key) => key,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("读取 backup_settings 密钥失败: {err}"),
                trace,
            );
        }
    };

    let stored = StoredBackupSettingsCfg {
        enabled: cfg.enabled,
        url: cfg.url,
        username: cfg.username,
        password_encrypted: Some(encrypt_password(
            &key,
            cfg.password.as_deref().unwrap_or_default(),
        )),
        password: None,
    };

    let bytes = match serde_json::to_vec_pretty(&stored) {
        Ok(b) => b,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("序列化 backup_settings 失败: {err}"),
                trace,
            );
        }
    };

    match fs::write(&path, bytes).await {
        Ok(()) => ok((), trace),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("写入 backup_settings 失败: {err}"),
            trace,
        ),
    }
}
