use crate::{err_payload, new_trace_id, ok, ErrorCode, ResultPayload};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tokio::fs;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AiProviderModelCfg {
    pub id: String,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    #[serde(default)]
    pub vision_mode: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AiProviderCfg {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    pub models: Vec<AiProviderModelCfg>,
    #[serde(default)]
    pub default_model_id: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub provider_type: Option<String>,
    #[serde(default)]
    pub vision_mode: Option<String>,
    #[serde(default)]
    pub gemini_thinking_level: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AiSettingsCfg {
    pub providers: Vec<AiProviderCfg>,
    #[serde(default)]
    pub default_provider_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PromptRoleCfg {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub prompt: String,
    #[serde(default)]
    pub enable_mcp_tools: Option<bool>,
    #[serde(default)]
    pub is_default: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PromptSettingsCfg {
    pub roles: Vec<PromptRoleCfg>,
    #[serde(default)]
    pub default_role_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentProviderCfg {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub platform: Option<String>,
    #[serde(default)]
    pub model_id: Option<String>,
    #[serde(default)]
    pub default_aspect_ratio: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentSettingsCfg {
    pub providers: Vec<AgentProviderCfg>,
    #[serde(default)]
    pub default_provider_id: Option<String>,
}

static DEFAULT_AI_SETTINGS_JSON: &str = include_str!("../ai_settings.default.json");

fn ai_settings_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    if let Ok(mut dir) = app.path().config_dir() {
        dir.push("haomd");
        std::fs::create_dir_all(&dir)?;
        return Ok(dir.join("ai_settings.json"));
    }

    let dir = std::env::current_dir()?;
    Ok(dir.join("ai_settings.json"))
}

fn prompt_settings_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    if let Ok(mut dir) = app.path().config_dir() {
        dir.push("haomd");
        std::fs::create_dir_all(&dir)?;
        return Ok(dir.join("prompt_settings.json"));
    }

    let dir = std::env::current_dir()?;
    Ok(dir.join("prompt_settings.json"))
}

fn agent_settings_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    if let Ok(mut dir) = app.path().config_dir() {
        dir.push("haomd");
        std::fs::create_dir_all(&dir)?;
        return Ok(dir.join("agent_providers.json"));
    }

    let dir = std::env::current_dir()?;
    Ok(dir.join("agent_providers.json"))
}

#[tauri::command]
pub async fn load_ai_settings(app: AppHandle) -> ResultPayload<AiSettingsCfg> {
    let trace = new_trace_id();
    let path = match ai_settings_path(&app) {
        Ok(p) => p,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取 ai_settings 路径失败: {err}"),
                trace,
            );
        }
    };

    match fs::read(&path).await {
        Ok(bytes) => {
            let cfg: AiSettingsCfg = serde_json::from_slice(&bytes).unwrap_or(AiSettingsCfg {
                providers: Vec::new(),
                default_provider_id: None,
            });
            ok(cfg, trace)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            let cfg: AiSettingsCfg =
                serde_json::from_str(DEFAULT_AI_SETTINGS_JSON).unwrap_or(AiSettingsCfg {
                    providers: Vec::new(),
                    default_provider_id: None,
                });
            ok(cfg, trace)
        }
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("读取 ai_settings 失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
pub async fn save_ai_settings(app: AppHandle, cfg: AiSettingsCfg) -> ResultPayload<()> {
    let trace = new_trace_id();
    let path = match ai_settings_path(&app) {
        Ok(p) => p,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取 ai_settings 路径失败: {err}"),
                trace,
            );
        }
    };

    let bytes = match serde_json::to_vec_pretty(&cfg) {
        Ok(b) => b,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("序列化 ai_settings 失败: {err}"),
                trace,
            );
        }
    };

    match fs::write(&path, bytes).await {
        Ok(()) => ok((), trace),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("写入 ai_settings 失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
pub async fn load_prompt_settings(app: AppHandle) -> ResultPayload<PromptSettingsCfg> {
    let trace = new_trace_id();
    let path = match prompt_settings_path(&app) {
        Ok(p) => p,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取 prompt_settings 路径失败: {err}"),
                trace,
            );
        }
    };

    match fs::read(&path).await {
        Ok(bytes) => {
            let cfg: PromptSettingsCfg =
                serde_json::from_slice(&bytes).unwrap_or(PromptSettingsCfg {
                    roles: Vec::new(),
                    default_role_id: None,
                });
            ok(cfg, trace)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => ok(
            PromptSettingsCfg {
                roles: Vec::new(),
                default_role_id: None,
            },
            trace,
        ),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("读取 prompt_settings 失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
pub async fn save_prompt_settings(app: AppHandle, cfg: PromptSettingsCfg) -> ResultPayload<()> {
    let trace = new_trace_id();
    let path = match prompt_settings_path(&app) {
        Ok(p) => p,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取 prompt_settings 路径失败: {err}"),
                trace,
            );
        }
    };

    let bytes = match serde_json::to_vec_pretty(&cfg) {
        Ok(b) => b,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("序列化 prompt_settings 失败: {err}"),
                trace,
            );
        }
    };

    match fs::write(&path, bytes).await {
        Ok(()) => ok((), trace),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("写入 prompt_settings 失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
pub async fn load_agent_settings(app: AppHandle) -> ResultPayload<AgentSettingsCfg> {
    let trace = new_trace_id();
    let path = match agent_settings_path(&app) {
        Ok(p) => p,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取 agent_settings 路径失败: {err}"),
                trace,
            );
        }
    };

    match fs::read(&path).await {
        Ok(bytes) => {
            let cfg: AgentSettingsCfg =
                serde_json::from_slice(&bytes).unwrap_or(AgentSettingsCfg {
                    providers: Vec::new(),
                    default_provider_id: None,
                });
            ok(cfg, trace)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => ok(
            AgentSettingsCfg {
                providers: Vec::new(),
                default_provider_id: None,
            },
            trace,
        ),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("读取 agent_settings 失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
pub async fn save_agent_settings(app: AppHandle, cfg: AgentSettingsCfg) -> ResultPayload<()> {
    let trace = new_trace_id();
    let path = match agent_settings_path(&app) {
        Ok(p) => p,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取 agent_settings 路径失败: {err}"),
                trace,
            );
        }
    };

    let bytes = match serde_json::to_vec_pretty(&cfg) {
        Ok(b) => b,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("序列化 agent_settings 失败: {err}"),
                trace,
            );
        }
    };

    match fs::write(&path, bytes).await {
        Ok(()) => ok((), trace),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("写入 agent_settings 失败: {err}"),
            trace,
        ),
    }
}
