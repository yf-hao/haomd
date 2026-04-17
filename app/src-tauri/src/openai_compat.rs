use futures_util::StreamExt;
use once_cell::sync::Lazy;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, Manager};
use tokio::fs;

const OPENAI_COMPAT_CHUNK_EVENT: &str = "openai://compat_chunk";
const OPENAI_COMPAT_DONE_EVENT: &str = "openai://compat_done";
const OPENAI_COMPAT_ERROR_EVENT: &str = "openai://compat_error";

static OPENAI_COMPAT_STREAM_CANCELS: Lazy<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static OPENAI_COMPAT_STREAM_TASKS: Lazy<Mutex<HashMap<String, JoinHandle<()>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

type OpenAICompatParamHints = HashMap<String, String>;

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpenAICompatToolFunction {
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpenAICompatToolCallRequest {
    pub id: String,
    pub function: OpenAICompatToolFunction,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpenAICompatMessageInput {
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub tool_calls: Option<Vec<OpenAICompatToolCallRequest>>,
    #[serde(default)]
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct OpenAICompatToolDefinitionFunction {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

#[derive(Debug, Deserialize, Clone)]
pub struct OpenAICompatToolDefinition {
    #[serde(rename = "type")]
    pub tool_type: String,
    pub function: OpenAICompatToolDefinitionFunction,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpenAICompatChatRequest {
    pub api_key: String,
    pub base_url: String,
    pub model_id: String,
    #[serde(default)]
    pub system_prompt: Option<String>,
    #[serde(default)]
    pub temperature: Option<f64>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    pub messages: Vec<OpenAICompatMessageInput>,
    #[serde(default)]
    pub tools: Option<Vec<OpenAICompatToolDefinition>>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpenAICompatToolCallOutput {
    pub id: String,
    pub function: OpenAICompatToolFunction,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpenAICompatChatResponse {
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<OpenAICompatToolCallOutput>>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OpenAICompatChunkEventPayload {
    request_id: String,
    content: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OpenAICompatDoneEventPayload {
    request_id: String,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_calls: Option<Vec<OpenAICompatToolCallOutput>>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OpenAICompatErrorEventPayload {
    request_id: String,
    message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CompletionTransportMode {
    Stream,
    NonStream,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MaxTokenParamMode {
    MaxTokens,
    MaxCompletionTokens,
}

#[derive(Debug)]
struct OpenAICompatRequestError {
    message: String,
    transport_mode: CompletionTransportMode,
    token_param_mode: MaxTokenParamMode,
    status: Option<u16>,
    response_text: Option<String>,
}

impl OpenAICompatRequestError {
    fn new(
        message: impl Into<String>,
        transport_mode: CompletionTransportMode,
        token_param_mode: MaxTokenParamMode,
        status: Option<u16>,
        response_text: Option<String>,
    ) -> Self {
        Self {
            message: message.into(),
            transport_mode,
            token_param_mode,
            status,
            response_text,
        }
    }
}

fn build_completions_url(base_url: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/beta")
        || trimmed
            .rsplit('/')
            .next()
            .map(|seg| seg.starts_with('v') && seg[1..].chars().all(|c| c.is_ascii_digit()))
            .unwrap_or(false)
    {
        format!("{trimmed}/chat/completions")
    } else {
        format!("{trimmed}/v1/chat/completions")
    }
}

fn openai_compat_hint_key(base_url: &str, model_id: &str) -> String {
    format!("{}::{}", base_url.trim_end_matches('/').trim(), model_id.trim())
}

fn openai_compat_state_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let mut dir = app
        .path()
        .config_dir()
        .map_err(|err| format!("读取配置目录失败: {err}"))?;
    dir.push("haomd");
    dir.push(".state");
    std::fs::create_dir_all(&dir).map_err(|err| format!("创建状态目录失败: {err}"))?;
    Ok(dir)
}

fn openai_compat_param_hints_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(openai_compat_state_dir(app)?.join("openai_compat_param_hints.json"))
}

async fn load_openai_compat_param_hints(app: &AppHandle) -> Result<OpenAICompatParamHints, String> {
    let path = openai_compat_param_hints_path(app)?;
    match fs::read(&path).await {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|err| format!("解析参数偏好缓存失败: {err}")),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
        Err(err) => Err(format!("读取参数偏好缓存失败: {err}")),
    }
}

async fn save_openai_compat_param_hints(
    app: &AppHandle,
    hints: &OpenAICompatParamHints,
) -> Result<(), String> {
    let path = openai_compat_param_hints_path(app)?;
    let bytes = serde_json::to_vec_pretty(hints)
        .map_err(|err| format!("序列化参数偏好缓存失败: {err}"))?;
    fs::write(path, bytes)
        .await
        .map_err(|err| format!("写入参数偏好缓存失败: {err}"))
}

async fn load_openai_compat_param_hint(
    app: &AppHandle,
    base_url: &str,
    model_id: &str,
) -> Result<Option<MaxTokenParamMode>, String> {
    let hints = load_openai_compat_param_hints(app).await?;
    let key = openai_compat_hint_key(base_url, model_id);
    Ok(match hints.get(&key).map(|value| value.as_str()) {
        Some("max_completion_tokens") => Some(MaxTokenParamMode::MaxCompletionTokens),
        Some("max_tokens") => Some(MaxTokenParamMode::MaxTokens),
        _ => None,
    })
}

async fn save_openai_compat_param_hint(
    app: &AppHandle,
    base_url: &str,
    model_id: &str,
    mode: MaxTokenParamMode,
) -> Result<(), String> {
    let mut hints = load_openai_compat_param_hints(app).await?;
    let key = openai_compat_hint_key(base_url, model_id);
    hints.insert(
        key,
        match mode {
            MaxTokenParamMode::MaxTokens => "max_tokens".to_string(),
            MaxTokenParamMode::MaxCompletionTokens => "max_completion_tokens".to_string(),
        },
    );
    save_openai_compat_param_hints(app, &hints).await
}

fn build_request_messages(request: &OpenAICompatChatRequest) -> Vec<Value> {
    let mut messages = Vec::new();
    if let Some(system_prompt) = request
        .system_prompt
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        messages.push(json!({ "role": "system", "content": system_prompt }));
    }

    for message in &request.messages {
        if message.role == "tool" {
            messages.push(json!({
                "role": "tool",
                "content": message.content,
                "tool_call_id": message.tool_call_id
            }));
            continue;
        }

        if message.role == "assistant" {
            if let Some(tool_calls) = &message.tool_calls {
                let mapped = tool_calls
                    .iter()
                    .map(|tool_call| {
                        json!({
                            "id": tool_call.id,
                            "type": "function",
                            "function": {
                                "name": tool_call.function.name,
                                "arguments": tool_call.function.arguments
                            }
                        })
                    })
                    .collect::<Vec<_>>();
                messages.push(json!({
                    "role": "assistant",
                    "content": if message.content.is_empty() { Value::Null } else { Value::String(message.content.clone()) },
                    "tool_calls": mapped
                }));
                continue;
            }
        }

        messages.push(json!({
            "role": message.role,
            "content": message.content
        }));
    }

    messages
}

fn build_request_body(
    request: &OpenAICompatChatRequest,
    transport_mode: CompletionTransportMode,
    token_param_mode: MaxTokenParamMode,
) -> Value {
    let mut body = json!({
        "model": request.model_id,
        "messages": build_request_messages(request),
        "temperature": request.temperature.unwrap_or(0.0),
        "stream": matches!(transport_mode, CompletionTransportMode::Stream)
    });

    if let Some(max_tokens) = request.max_tokens {
        match token_param_mode {
            MaxTokenParamMode::MaxTokens => body["max_tokens"] = json!(max_tokens),
            MaxTokenParamMode::MaxCompletionTokens => {
                body["max_completion_tokens"] = json!(max_tokens)
            }
        }
    }

    if let Some(tools) = &request.tools {
        if !tools.is_empty() {
            body["tools"] = json!(
                tools
                    .iter()
                    .map(|tool| {
                        json!({
                            "type": tool.tool_type,
                            "function": {
                                "name": tool.function.name,
                                "description": tool.function.description,
                                "parameters": tool.function.parameters
                            }
                        })
                    })
                    .collect::<Vec<_>>()
            );
            body["tool_choice"] = json!("auto");
        }
    }

    body
}

fn extract_message_content(message: &Value) -> String {
    if let Some(content) = message.get("content") {
        if let Some(text) = content.as_str() {
            return text.to_string();
        }
        if let Some(parts) = content.as_array() {
            return parts
                .iter()
                .filter_map(|part| part.get("text").and_then(|value| value.as_str()))
                .collect::<Vec<_>>()
                .join("");
        }
    }
    String::new()
}

fn extract_tool_calls(message: &Value) -> Option<Vec<OpenAICompatToolCallOutput>> {
    let raw_tool_calls = message.get("tool_calls")?.as_array()?;
    let tool_calls = raw_tool_calls
        .iter()
        .filter_map(|tool_call| {
            let name = tool_call
                .get("function")
                .and_then(|function| function.get("name"))
                .and_then(|value| value.as_str())?;
            let arguments = tool_call
                .get("function")
                .and_then(|function| function.get("arguments"))
                .and_then(|value| value.as_str())?;
            Some(OpenAICompatToolCallOutput {
                id: tool_call
                    .get("id")
                    .and_then(|value| value.as_str())
                    .unwrap_or_default()
                    .to_string(),
                function: OpenAICompatToolFunction {
                    name: name.to_string(),
                    arguments: arguments.to_string(),
                },
            })
        })
        .collect::<Vec<_>>();
    if tool_calls.is_empty() {
        None
    } else {
        Some(tool_calls)
    }
}

fn looks_like_max_tokens_issue(message: &str) -> bool {
    let lowered = message.to_lowercase();
    lowered.contains("max_tokens")
        || lowered.contains("max completion tokens")
        || lowered.contains("max_completion_tokens")
}

fn build_retry_plan(
    error: &OpenAICompatRequestError,
) -> Vec<(CompletionTransportMode, MaxTokenParamMode)> {
    if matches!(error.status, Some(401 | 403 | 404)) {
        return vec![];
    }

    let response_text = format!(
        "{} {}",
        error.response_text.as_deref().unwrap_or_default(),
        error.message
    )
    .to_lowercase();
    let looks_like_max_token_issue = looks_like_max_tokens_issue(&response_text);

    if looks_like_max_token_issue {
        return match error.token_param_mode {
            MaxTokenParamMode::MaxTokens => vec![
                (error.transport_mode, MaxTokenParamMode::MaxCompletionTokens),
                (
                    CompletionTransportMode::NonStream,
                    MaxTokenParamMode::MaxCompletionTokens,
                ),
            ],
            MaxTokenParamMode::MaxCompletionTokens => {
                if matches!(error.transport_mode, CompletionTransportMode::Stream) {
                    vec![(CompletionTransportMode::NonStream, error.token_param_mode)]
                } else {
                    vec![]
                }
            }
        };
    }

    match error.transport_mode {
        CompletionTransportMode::Stream => vec![(CompletionTransportMode::NonStream, error.token_param_mode)],
        CompletionTransportMode::NonStream => vec![],
    }
}

fn emit_chunk(app: &AppHandle, request_id: &str, content: String) {
    let _ = app.emit(
        OPENAI_COMPAT_CHUNK_EVENT,
        OpenAICompatChunkEventPayload {
            request_id: request_id.to_string(),
            content,
        },
    );
}

fn emit_done(
    app: &AppHandle,
    request_id: &str,
    response: OpenAICompatChatResponse,
) {
    let _ = app.emit(
        OPENAI_COMPAT_DONE_EVENT,
        OpenAICompatDoneEventPayload {
            request_id: request_id.to_string(),
            content: response.content,
            tool_calls: response.tool_calls,
        },
    );
}

fn emit_error(app: &AppHandle, request_id: &str, message: impl Into<String>) {
    let _ = app.emit(
        OPENAI_COMPAT_ERROR_EVENT,
        OpenAICompatErrorEventPayload {
            request_id: request_id.to_string(),
            message: message.into(),
        },
    );
}

fn take_cancel_flag(request_id: &str) -> Option<Arc<AtomicBool>> {
    OPENAI_COMPAT_STREAM_CANCELS
        .lock()
        .ok()
        .and_then(|mut map| map.remove(request_id))
}

fn take_stream_task(request_id: &str) -> Option<JoinHandle<()>> {
    OPENAI_COMPAT_STREAM_TASKS
        .lock()
        .ok()
        .and_then(|mut map| map.remove(request_id))
}

fn get_cancel_flag(request_id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    if let Ok(mut map) = OPENAI_COMPAT_STREAM_CANCELS.lock() {
        map.insert(request_id.to_string(), flag.clone());
    }
    flag
}

fn insert_stream_task(request_id: String, handle: JoinHandle<()>) {
    if let Ok(mut map) = OPENAI_COMPAT_STREAM_TASKS.lock() {
        map.insert(request_id, handle);
    }
}

fn is_cancelled(flag: &Arc<AtomicBool>) -> bool {
    flag.load(Ordering::Relaxed)
}

async fn send_non_stream_request(
    client: &Client,
    request: &OpenAICompatChatRequest,
    token_param_mode: MaxTokenParamMode,
) -> Result<OpenAICompatChatResponse, OpenAICompatRequestError> {
    let url = build_completions_url(&request.base_url);
    let response = client
        .post(url)
        .bearer_auth(request.api_key.trim())
        .json(&build_request_body(
            request,
            CompletionTransportMode::NonStream,
            token_param_mode,
        ))
        .send()
        .await
        .map_err(|err| {
            OpenAICompatRequestError::new(
                format!("请求失败: {err}"),
                CompletionTransportMode::NonStream,
                token_param_mode,
                None,
                None,
            )
        })?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let text = response.text().await.unwrap_or_default();
        return Err(OpenAICompatRequestError::new(
            format!("OpenAI API error ({status}): {text}"),
            CompletionTransportMode::NonStream,
            token_param_mode,
            Some(status),
            Some(text),
        ));
    }

    let json: Value = response.json().await.map_err(|err| {
        OpenAICompatRequestError::new(
            format!("解析响应失败: {err}"),
            CompletionTransportMode::NonStream,
            token_param_mode,
            None,
            None,
        )
    })?;
    let message = json
        .get("choices")
        .and_then(|choices| choices.as_array())
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .ok_or_else(|| {
            OpenAICompatRequestError::new(
                "响应中缺少 message",
                CompletionTransportMode::NonStream,
                token_param_mode,
                None,
                None,
            )
        })?;

    Ok(OpenAICompatChatResponse {
        content: extract_message_content(message),
        tool_calls: extract_tool_calls(message),
    })
}

async fn send_stream_request(
    app: &AppHandle,
    request_id: &str,
    client: &Client,
    request: &OpenAICompatChatRequest,
    token_param_mode: MaxTokenParamMode,
    cancel_flag: Arc<AtomicBool>,
) -> Result<OpenAICompatChatResponse, OpenAICompatRequestError> {
    let url = build_completions_url(&request.base_url);
    let response = client
        .post(url)
        .bearer_auth(request.api_key.trim())
        .json(&build_request_body(
            request,
            CompletionTransportMode::Stream,
            token_param_mode,
        ))
        .send()
        .await
        .map_err(|err| {
            OpenAICompatRequestError::new(
                format!("请求失败: {err}"),
                CompletionTransportMode::Stream,
                token_param_mode,
                None,
                None,
            )
        })?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let text = response.text().await.unwrap_or_default();
        return Err(OpenAICompatRequestError::new(
            format!("OpenAI API error ({status}): {text}"),
            CompletionTransportMode::Stream,
            token_param_mode,
            Some(status),
            Some(text),
        ));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut full_content = String::new();
    let mut tool_calls_map = HashMap::<usize, OpenAICompatToolCallOutput>::new();

    while let Some(next_chunk) = stream.next().await {
        if is_cancelled(&cancel_flag) {
            return Err(OpenAICompatRequestError::new(
                "请求已取消",
                CompletionTransportMode::Stream,
                token_param_mode,
                None,
                None,
            ));
        }

        let bytes = next_chunk.map_err(|err| {
            OpenAICompatRequestError::new(
                format!("读取流响应失败: {err}"),
                CompletionTransportMode::Stream,
                token_param_mode,
                None,
                None,
            )
        })?;

        buffer.push_str(&String::from_utf8_lossy(&bytes));
        let mut lines = buffer
            .split('\n')
            .map(|line| line.trim_end_matches('\r').to_string())
            .collect::<Vec<_>>();
        buffer = if buffer.ends_with('\n') {
            String::new()
        } else {
            lines.pop().unwrap_or_default()
        };

        for line in lines {
            let trimmed = line.trim();
            if trimmed.is_empty() || !trimmed.starts_with("data:") {
                continue;
            }
            let payload = trimmed.trim_start_matches("data:").trim();
            if payload == "[DONE]" {
                continue;
            }

            let json: Value = match serde_json::from_str(payload) {
                Ok(value) => value,
                Err(_) => continue,
            };
            let choice = match json
                .get("choices")
                .and_then(|choices| choices.as_array())
                .and_then(|choices| choices.first())
            {
                Some(choice) => choice,
                None => continue,
            };

            if let Some(content) = choice
                .get("delta")
                .and_then(|delta| delta.get("content"))
                .and_then(|value| value.as_str())
            {
                full_content.push_str(content);
                emit_chunk(app, request_id, content.to_string());
            }

            if let Some(tool_calls) = choice
                .get("delta")
                .and_then(|delta| delta.get("tool_calls"))
                .and_then(|value| value.as_array())
            {
                for tool_call in tool_calls {
                    let index = tool_call
                        .get("index")
                        .and_then(|value| value.as_u64())
                        .unwrap_or(0) as usize;
                    let entry = tool_calls_map.entry(index).or_insert_with(|| {
                        OpenAICompatToolCallOutput {
                            id: String::new(),
                            function: OpenAICompatToolFunction {
                                name: String::new(),
                                arguments: String::new(),
                            },
                        }
                    });
                    if let Some(id) = tool_call.get("id").and_then(|value| value.as_str()) {
                        entry.id = id.to_string();
                    }
                    if let Some(name) = tool_call
                        .get("function")
                        .and_then(|function| function.get("name"))
                        .and_then(|value| value.as_str())
                    {
                        entry.function.name = name.to_string();
                    }
                    if let Some(arguments) = tool_call
                        .get("function")
                        .and_then(|function| function.get("arguments"))
                        .and_then(|value| value.as_str())
                    {
                        entry.function.arguments.push_str(arguments);
                    }
                }
            }
        }
    }

    let mut tool_calls = tool_calls_map.into_iter().collect::<Vec<_>>();
    tool_calls.sort_by_key(|(index, _)| *index);

    Ok(OpenAICompatChatResponse {
        content: full_content,
        tool_calls: {
            let mapped = tool_calls
                .into_iter()
                .map(|(_, tool_call)| tool_call)
                .filter(|tool_call| !tool_call.function.name.is_empty())
                .collect::<Vec<_>>();
            if mapped.is_empty() {
                None
            } else {
                Some(mapped)
            }
        },
    })
}

async fn run_openai_compat_stream(
    app: AppHandle,
    request_id: String,
    request: OpenAICompatChatRequest,
) {
    let cancel_flag = get_cancel_flag(&request_id);
    let client = match Client::builder().use_rustls_tls().build() {
        Ok(client) => client,
        Err(err) => {
            emit_error(&app, &request_id, format!("创建 HTTP 客户端失败: {err}"));
            take_cancel_flag(&request_id);
            return;
        }
    };

    let preferred_token_mode = load_openai_compat_param_hint(&app, &request.base_url, &request.model_id)
        .await
        .unwrap_or(None);
    let initial_token_mode = preferred_token_mode.unwrap_or(MaxTokenParamMode::MaxTokens);
    let mut attempts = vec![(CompletionTransportMode::Stream, initial_token_mode)];
    if initial_token_mode != MaxTokenParamMode::MaxTokens {
        attempts.push((CompletionTransportMode::Stream, MaxTokenParamMode::MaxTokens));
    }
    let mut tried = Vec::<(CompletionTransportMode, MaxTokenParamMode)>::new();
    let mut last_error_message = String::from("未知错误");

    while let Some((transport_mode, token_param_mode)) = attempts.pop() {
        if tried.contains(&(transport_mode, token_param_mode)) {
            continue;
        }
        tried.push((transport_mode, token_param_mode));

        let result = match transport_mode {
            CompletionTransportMode::Stream => {
                send_stream_request(
                    &app,
                    &request_id,
                    &client,
                    &request,
                    token_param_mode,
                    cancel_flag.clone(),
                )
                .await
            }
            CompletionTransportMode::NonStream => {
                send_non_stream_request(&client, &request, token_param_mode).await.map(|response| {
                    if !response.content.is_empty() {
                        emit_chunk(&app, &request_id, response.content.clone());
                    }
                    response
                })
            }
        };

        match result {
            Ok(response) => {
                let _ = save_openai_compat_param_hint(
                    &app,
                    &request.base_url,
                    &request.model_id,
                    token_param_mode,
                )
                .await;
                emit_done(&app, &request_id, response);
                take_cancel_flag(&request_id);
                take_stream_task(&request_id);
                return;
            }
            Err(error) => {
                if is_cancelled(&cancel_flag) {
                    take_cancel_flag(&request_id);
                    take_stream_task(&request_id);
                    return;
                }
                last_error_message = error.message.clone();
                for retry in build_retry_plan(&error).into_iter().rev() {
                    if !tried.contains(&retry) {
                        attempts.push(retry);
                    }
                }
            }
        }
    }

    emit_error(&app, &request_id, last_error_message);
    take_cancel_flag(&request_id);
    take_stream_task(&request_id);
}

#[tauri::command]
pub async fn start_openai_compat_chat_stream(
    app: AppHandle,
    request_id: String,
    request: OpenAICompatChatRequest,
) -> Result<(), String> {
    let app_handle = app.clone();
    let tracked_request_id = request_id.clone();
    let handle = tauri::async_runtime::spawn(async move {
        run_openai_compat_stream(app_handle, request_id, request).await;
    });
    insert_stream_task(tracked_request_id, handle);
    Ok(())
}

#[tauri::command]
pub async fn cancel_openai_compat_chat_stream(
    app: AppHandle,
    request_id: String,
) -> Result<(), String> {
    if let Ok(map) = OPENAI_COMPAT_STREAM_CANCELS.lock() {
        if let Some(flag) = map.get(&request_id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
    if let Some(handle) = take_stream_task(&request_id) {
        handle.abort();
    }
    take_cancel_flag(&request_id);
    emit_error(&app, &request_id, "请求已取消");
    Ok(())
}
