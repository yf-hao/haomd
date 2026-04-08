use crate::mcp_config::{McpServerCfg, McpSettingsCfg};
use crate::{err_payload, new_trace_id, ok, ErrorCode, ResultPayload};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::Mutex;

// ─── MCP Tool definition (returned from tools/list) ─────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct McpToolDef {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default, rename = "inputSchema")]
    pub input_schema: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct McpRunningServerInfo {
    pub id: String,
    pub name: String,
    pub tool_count: usize,
}

// ─── JSON-RPC 2.0 ──────────────────────────────────────────────────

#[derive(Serialize)]
struct JsonRpcRequest {
    jsonrpc: &'static str,
    id: u64,
    method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<serde_json::Value>,
}

#[derive(Serialize)]
struct JsonRpcNotification {
    jsonrpc: &'static str,
    method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct JsonRpcResponse {
    #[allow(dead_code)]
    jsonrpc: Option<String>,
    id: Option<u64>,
    result: Option<serde_json::Value>,
    error: Option<JsonRpcError>,
}

#[derive(Deserialize)]
struct JsonRpcError {
    code: i64,
    message: String,
    #[allow(dead_code)]
    data: Option<serde_json::Value>,
}

// ─── Transport: Stdio ───────────────────────────────────────────────

struct StdioTransport {
    #[allow(dead_code)]
    child: Child,
    stdin: ChildStdin,
    stdout_reader: BufReader<ChildStdout>,
    next_id: u64,
}

// ─── Transport: Streamable HTTP ─────────────────────────────────────

struct HttpTransport {
    url: String,
    custom_headers: HashMap<String, String>,
    session_id: Option<String>,
    client: reqwest::Client,
    next_id: u64,
}

// ─── Transport enum ─────────────────────────────────────────────────

enum McpTransport {
    Stdio(StdioTransport),
    Http(HttpTransport),
}

// ─── Server instance ────────────────────────────────────────────────

pub(crate) struct McpServerInstance {
    #[allow(dead_code)]
    server_id: String,
    server_name: String,
    transport: McpTransport,
    tools: Vec<McpToolDef>,
}

// ─── Process manager (Tauri State) ──────────────────────────────────

pub struct McpProcessManager {
    pub(crate) instances: Arc<Mutex<HashMap<String, McpServerInstance>>>,
}

impl McpProcessManager {
    pub fn new() -> Self {
        Self {
            instances: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

// ─── Stdio helpers ──────────────────────────────────────────────────

async fn stdio_send_request(
    t: &mut StdioTransport,
    method: &str,
    params: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    t.next_id += 1;
    let req = JsonRpcRequest {
        jsonrpc: "2.0",
        id: t.next_id,
        method: method.to_string(),
        params,
    };
    let mut payload = serde_json::to_string(&req).map_err(|e| e.to_string())?;
    payload.push('\n');

    t.stdin
        .write_all(payload.as_bytes())
        .await
        .map_err(|e| format!("写入 stdin 失败: {e}"))?;
    t.stdin
        .flush()
        .await
        .map_err(|e| format!("flush stdin 失败: {e}"))?;

    let expected_id = t.next_id;
    let mut line = String::new();
    loop {
        line.clear();
        let n = t
            .stdout_reader
            .read_line(&mut line)
            .await
            .map_err(|e| format!("读取 stdout 失败: {e}"))?;
        if n == 0 {
            return Err("MCP Server stdout EOF".to_string());
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Ok(resp) = serde_json::from_str::<JsonRpcResponse>(trimmed) {
            if resp.id == Some(expected_id) {
                if let Some(err) = resp.error {
                    return Err(format!("JSON-RPC error {}: {}", err.code, err.message));
                }
                return resp.result.ok_or_else(|| "empty result".to_string());
            }
        }
    }
}

async fn stdio_send_notification(
    t: &mut StdioTransport,
    method: &str,
    params: Option<serde_json::Value>,
) -> Result<(), String> {
    let notif = JsonRpcNotification {
        jsonrpc: "2.0",
        method: method.to_string(),
        params,
    };
    let mut payload = serde_json::to_string(&notif).map_err(|e| e.to_string())?;
    payload.push('\n');

    t.stdin
        .write_all(payload.as_bytes())
        .await
        .map_err(|e| format!("写入 stdin 失败: {e}"))?;
    t.stdin
        .flush()
        .await
        .map_err(|e| format!("flush stdin 失败: {e}"))?;
    Ok(())
}

fn build_stdio_variable_map(
    app: Option<&AppHandle>,
    env: Option<&HashMap<String, String>>,
) -> HashMap<String, String> {
    let mut vars = HashMap::new();

    if let Ok(home) = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) {
        vars.insert("HOME".to_string(), home);
    }
    if let Ok(current_dir) = std::env::current_dir() {
        vars.insert(
            "CURRENT_DIR".to_string(),
            current_dir.to_string_lossy().into_owned(),
        );
    }
    if let Some(app) = app {
        if let Ok(config_dir) = app.path().config_dir() {
            vars.insert(
                "APP_CONFIG_DIR".to_string(),
                config_dir.to_string_lossy().into_owned(),
            );
        }
        if let Ok(app_data_dir) = app.path().app_data_dir() {
            vars.insert(
                "APP_DATA_DIR".to_string(),
                app_data_dir.to_string_lossy().into_owned(),
            );
        }
    }
    if let Some(env) = env {
        for (key, value) in env {
            vars.insert(key.clone(), value.clone());
        }
    }

    vars
}

fn expand_stdio_value(value: &str, vars: &HashMap<String, String>) -> String {
    let mut expanded = String::with_capacity(value.len());
    let mut rest = value;

    while let Some(start) = rest.find("${") {
        expanded.push_str(&rest[..start]);
        let after_start = &rest[start + 2..];
        if let Some(end) = after_start.find('}') {
            let key = &after_start[..end];
            let replacement = vars
                .get(key)
                .cloned()
                .or_else(|| std::env::var(key).ok())
                .unwrap_or_else(|| format!("${{{key}}}"));
            expanded.push_str(&replacement);
            rest = &after_start[end + 1..];
        } else {
            expanded.push_str(&rest[start..]);
            return expanded;
        }
    }

    expanded.push_str(rest);
    expanded
}

fn is_path_like_command(command: &str) -> bool {
    let path = Path::new(command);
    path.is_absolute() || path.components().count() > 1
}

#[cfg(windows)]
fn command_candidates(path: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let has_ext = path.extension().is_some();
    if has_ext {
        candidates.push(path.to_path_buf());
        return candidates;
    }

    let pathext = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
    for ext in pathext.split(';').filter(|s| !s.is_empty()) {
        let trimmed = ext.trim_start_matches('.');
        candidates.push(path.with_extension(trimmed));
    }
    candidates.push(path.to_path_buf());
    candidates
}

#[cfg(not(windows))]
fn command_candidates(path: &Path) -> Vec<PathBuf> {
    vec![path.to_path_buf()]
}

fn resolve_stdio_executable(command: &str) -> Option<PathBuf> {
    if is_path_like_command(command) {
        let path = Path::new(command);
        return command_candidates(path)
            .into_iter()
            .find(|candidate| candidate.is_file());
    }

    let path_env = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_env) {
        let joined = dir.join(command);
        if let Some(path) = command_candidates(&joined)
            .into_iter()
            .find(|candidate| candidate.is_file())
        {
            return Some(path);
        }
    }
    None
}

fn spawn_stdio_process(
    app: Option<&AppHandle>,
    cfg: &McpServerCfg,
) -> Result<StdioTransport, String> {
    let command = cfg
        .command
        .as_deref()
        .ok_or("stdio server 未配置 command")?;
    let vars = build_stdio_variable_map(app, cfg.env.as_ref());
    let command = expand_stdio_value(command, &vars);
    let args = cfg
        .args
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .map(|arg| expand_stdio_value(arg, &vars))
        .collect::<Vec<_>>();
    let env = cfg.env.as_ref().map(|env| {
        env.iter()
            .map(|(k, v)| (k.clone(), expand_stdio_value(v, &vars)))
            .collect::<HashMap<_, _>>()
    });

    let executable = resolve_stdio_executable(&command).ok_or_else(|| {
        format!(
            "无法启动 stdio MCP Server：找不到命令 '{command}'。请确认目标机器已安装对应运行时/可执行程序，或检查 PATH、command、args 中的变量展开结果。支持变量：${{HOME}}、${{CURRENT_DIR}}、${{APP_CONFIG_DIR}}、${{APP_DATA_DIR}} 以及环境变量。"
        )
    })?;

    let mut cmd = tokio::process::Command::new(&executable);
    cmd.args(&args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    if let Some(env) = &env {
        for (k, v) in env {
            cmd.env(k, v);
        }
    }

    let mut child = cmd.spawn().map_err(|e| {
        format!(
            "启动 MCP Server 失败: {e}（command='{}' resolved='{}' args={:?}）",
            command,
            executable.display(),
            args
        )
    })?;
    let stdin = child.stdin.take().ok_or("无法获取 stdin")?;
    let stdout = child.stdout.take().ok_or("无法获取 stdout")?;
    let reader = BufReader::new(stdout);

    Ok(StdioTransport {
        child,
        stdin,
        stdout_reader: reader,
        next_id: 0,
    })
}

// ─── Streamable HTTP helpers ────────────────────────────────────────

fn create_http_transport(cfg: &McpServerCfg) -> Result<HttpTransport, String> {
    let url = cfg
        .url
        .as_deref()
        .ok_or("streamable-http server 未配置 URL")?;
    let custom_headers = cfg.headers.clone().unwrap_or_default();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("创建 HTTP client 失败: {e}"))?;

    Ok(HttpTransport {
        url: url.to_string(),
        custom_headers,
        session_id: None,
        client,
        next_id: 0,
    })
}

/// Send a JSON-RPC request over Streamable HTTP (POST).
/// Handles both `application/json` and `text/event-stream` responses.
/// Captures `Mcp-Session-Id` from response headers for session stickiness.
async fn http_send_request(
    t: &mut HttpTransport,
    method: &str,
    params: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    t.next_id += 1;
    let req = JsonRpcRequest {
        jsonrpc: "2.0",
        id: t.next_id,
        method: method.to_string(),
        params,
    };
    let body = serde_json::to_string(&req).map_err(|e| e.to_string())?;

    let mut builder = t
        .client
        .post(&t.url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream");

    if let Some(sid) = &t.session_id {
        builder = builder.header("Mcp-Session-Id", sid);
    }
    for (k, v) in &t.custom_headers {
        builder = builder.header(k, v);
    }

    let resp = builder
        .body(body)
        .send()
        .await
        .map_err(|e| format!("HTTP request 失败: {e}"))?;

    // Capture session id from response
    if let Some(sid) = resp.headers().get("mcp-session-id") {
        if let Ok(s) = sid.to_str() {
            t.session_id = Some(s.to_string());
        }
    }

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {status}: {text}"));
    }

    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let expected_id = t.next_id;

    if content_type.contains("text/event-stream") {
        // Parse SSE stream — look for the JSON-RPC response matching our id
        let text = resp
            .text()
            .await
            .map_err(|e| format!("读取 SSE 响应失败: {e}"))?;
        for line in text.lines() {
            let line = line.trim();
            if let Some(data) = line.strip_prefix("data:") {
                let data = data.trim();
                if data.is_empty() || data == "[DONE]" {
                    continue;
                }
                if let Ok(rpc_resp) = serde_json::from_str::<JsonRpcResponse>(data) {
                    if rpc_resp.id == Some(expected_id) {
                        if let Some(err) = rpc_resp.error {
                            return Err(format!("JSON-RPC error {}: {}", err.code, err.message));
                        }
                        return rpc_resp.result.ok_or_else(|| "empty result".to_string());
                    }
                }
            }
        }
        Err("SSE 响应中未找到匹配的 JSON-RPC 结果".to_string())
    } else {
        // application/json — single JSON-RPC response
        let rpc_resp: JsonRpcResponse = resp
            .json()
            .await
            .map_err(|e| format!("解析 JSON-RPC 响应失败: {e}"))?;

        if rpc_resp.id != Some(expected_id) {
            return Err("JSON-RPC response id 不匹配".to_string());
        }
        if let Some(err) = rpc_resp.error {
            return Err(format!("JSON-RPC error {}: {}", err.code, err.message));
        }
        rpc_resp.result.ok_or_else(|| "empty result".to_string())
    }
}

/// Send a JSON-RPC notification (no id, no response expected) over Streamable HTTP.
async fn http_send_notification(
    t: &mut HttpTransport,
    method: &str,
    params: Option<serde_json::Value>,
) -> Result<(), String> {
    let notif = JsonRpcNotification {
        jsonrpc: "2.0",
        method: method.to_string(),
        params,
    };
    let body = serde_json::to_string(&notif).map_err(|e| e.to_string())?;

    let mut builder = t
        .client
        .post(&t.url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream");

    if let Some(sid) = &t.session_id {
        builder = builder.header("Mcp-Session-Id", sid);
    }
    for (k, v) in &t.custom_headers {
        builder = builder.header(k, v);
    }

    let resp = builder
        .body(body)
        .send()
        .await
        .map_err(|e| format!("HTTP notification 失败: {e}"))?;

    // Capture session id
    if let Some(sid) = resp.headers().get("mcp-session-id") {
        if let Ok(s) = sid.to_str() {
            t.session_id = Some(s.to_string());
        }
    }

    let status = resp.status();
    // 200 OK or 202 Accepted or 204 No Content are all valid
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP notification {status}: {text}"));
    }
    Ok(())
}

// ─── Unified transport helpers ──────────────────────────────────────

async fn transport_send_request(
    t: &mut McpTransport,
    method: &str,
    params: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    match t {
        McpTransport::Stdio(s) => stdio_send_request(s, method, params).await,
        McpTransport::Http(h) => http_send_request(h, method, params).await,
    }
}

async fn transport_send_notification(
    t: &mut McpTransport,
    method: &str,
    params: Option<serde_json::Value>,
) -> Result<(), String> {
    match t {
        McpTransport::Stdio(s) => stdio_send_notification(s, method, params).await,
        McpTransport::Http(h) => http_send_notification(h, method, params).await,
    }
}

async fn transport_initialize_and_list_tools(
    t: &mut McpTransport,
) -> Result<Vec<McpToolDef>, String> {
    let init_params = serde_json::json!({
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {
            "name": "HaoMD",
            "version": "0.5.0"
        }
    });
    let _server_info = transport_send_request(t, "initialize", Some(init_params)).await?;
    transport_send_notification(t, "notifications/initialized", None).await?;

    let tools_result = transport_send_request(t, "tools/list", None).await?;
    let tools_array = tools_result
        .get("tools")
        .cloned()
        .unwrap_or(serde_json::Value::Array(vec![]));
    let tools: Vec<McpToolDef> = serde_json::from_value(tools_array).unwrap_or_default();
    Ok(tools)
}

// Helper: load MCP settings from file
async fn load_settings(app: &AppHandle) -> Result<McpSettingsCfg, String> {
    let path = crate::mcp_config::mcp_settings_path_pub(app)
        .map_err(|e| format!("获取 mcp_settings 路径失败: {e}"))?;
    match tokio::fs::read(&path).await {
        Ok(bytes) => {
            let cfg: McpSettingsCfg = serde_json::from_slice(&bytes).unwrap_or_default();
            Ok(cfg)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(McpSettingsCfg::default()),
        Err(err) => Err(format!("读取 mcp_settings 失败: {err}")),
    }
}

// ─── Tauri commands ─────────────────────────────────────────────────

#[tauri::command]
pub async fn mcp_start_server(app: AppHandle, server_id: String) -> ResultPayload<Vec<McpToolDef>> {
    let trace = new_trace_id();
    let mgr = app.state::<McpProcessManager>();

    // Load server config
    let settings = match load_settings(&app).await {
        Ok(s) => s,
        Err(e) => return err_payload(ErrorCode::IoError, e, trace),
    };
    let cfg = match settings.servers.iter().find(|s| s.id == server_id) {
        Some(c) => c.clone(),
        None => {
            return err_payload(
                ErrorCode::NotFound,
                format!("MCP Server '{server_id}' 未找到"),
                trace,
            )
        }
    };

    // Create transport based on type
    let mut transport = match cfg.transport.as_str() {
        "stdio" => {
            let t = match spawn_stdio_process(Some(&app), &cfg) {
                Ok(t) => t,
                Err(e) => return err_payload(ErrorCode::IoError, e, trace),
            };
            McpTransport::Stdio(t)
        }
        "streamable-http" => {
            let t = match create_http_transport(&cfg) {
                Ok(t) => t,
                Err(e) => return err_payload(ErrorCode::IoError, e, trace),
            };
            McpTransport::Http(t)
        }
        other => {
            return err_payload(
                ErrorCode::IoError,
                format!("不支持的传输方式 '{other}'，支持 stdio / streamable-http"),
                trace,
            )
        }
    };

    // Initialize + list tools
    let tools = match transport_initialize_and_list_tools(&mut transport).await {
        Ok(t) => t,
        Err(e) => return err_payload(ErrorCode::IoError, format!("MCP 初始化失败: {e}"), trace),
    };

    let instance = McpServerInstance {
        server_id: server_id.clone(),
        server_name: cfg.name.clone(),
        transport,
        tools: tools.clone(),
    };

    let mut instances = mgr.instances.lock().await;
    instances.insert(server_id, instance);

    ok(tools, trace)
}

#[tauri::command]
pub async fn mcp_test_server(app: AppHandle, cfg: McpServerCfg) -> ResultPayload<Vec<McpToolDef>> {
    let trace = new_trace_id();

    let mut transport = match cfg.transport.as_str() {
        "stdio" => {
            let t = match spawn_stdio_process(Some(&app), &cfg) {
                Ok(t) => t,
                Err(e) => return err_payload(ErrorCode::IoError, e, trace),
            };
            McpTransport::Stdio(t)
        }
        "streamable-http" => {
            let t = match create_http_transport(&cfg) {
                Ok(t) => t,
                Err(e) => return err_payload(ErrorCode::IoError, e, trace),
            };
            McpTransport::Http(t)
        }
        other => {
            return err_payload(
                ErrorCode::IoError,
                format!("不支持的传输方式 '{other}'，支持 stdio / streamable-http"),
                trace,
            )
        }
    };

    let tools = match transport_initialize_and_list_tools(&mut transport).await {
        Ok(t) => t,
        Err(e) => return err_payload(ErrorCode::IoError, format!("MCP 初始化失败: {e}"), trace),
    };

    if let McpTransport::Stdio(s) = &mut transport {
        let _ = s.child.kill().await;
    }

    ok(tools, trace)
}

#[tauri::command]
pub async fn mcp_stop_server(app: AppHandle, server_id: String) -> ResultPayload<()> {
    let trace = new_trace_id();
    let mgr = app.state::<McpProcessManager>();
    let mut instances = mgr.instances.lock().await;

    if let Some(mut inst) = instances.remove(&server_id) {
        match &mut inst.transport {
            McpTransport::Stdio(s) => {
                let _ = s.child.kill().await;
            }
            McpTransport::Http(_) => { /* stateless — nothing to kill */ }
        }
        ok((), trace)
    } else {
        err_payload(
            ErrorCode::NotFound,
            format!("MCP Server '{server_id}' 未运行"),
            trace,
        )
    }
}

#[tauri::command]
pub async fn mcp_list_tools(app: AppHandle, server_id: String) -> ResultPayload<Vec<McpToolDef>> {
    let trace = new_trace_id();
    let mgr = app.state::<McpProcessManager>();
    let instances = mgr.instances.lock().await;

    match instances.get(&server_id) {
        Some(inst) => ok(inst.tools.clone(), trace),
        None => err_payload(
            ErrorCode::NotFound,
            format!("MCP Server '{server_id}' 未运行"),
            trace,
        ),
    }
}

#[tauri::command]
pub async fn mcp_call_tool(
    app: AppHandle,
    server_id: String,
    tool_name: String,
    arguments: serde_json::Value,
) -> ResultPayload<serde_json::Value> {
    let trace = new_trace_id();
    let mgr = app.state::<McpProcessManager>();
    let mut instances = mgr.instances.lock().await;

    let inst = match instances.get_mut(&server_id) {
        Some(i) => i,
        None => {
            return err_payload(
                ErrorCode::NotFound,
                format!("MCP Server '{server_id}' 未运行"),
                trace,
            )
        }
    };

    let params = serde_json::json!({
        "name": tool_name,
        "arguments": arguments,
    });

    match transport_send_request(&mut inst.transport, "tools/call", Some(params)).await {
        Ok(result) => ok(result, trace),
        Err(e) => err_payload(
            ErrorCode::IoError,
            format!("调用工具 '{tool_name}' 失败: {e}"),
            trace,
        ),
    }
}

#[tauri::command]
pub async fn mcp_list_running_servers(app: AppHandle) -> ResultPayload<Vec<McpRunningServerInfo>> {
    let trace = new_trace_id();
    let mgr = app.state::<McpProcessManager>();
    let instances = mgr.instances.lock().await;

    let list: Vec<McpRunningServerInfo> = instances
        .values()
        .map(|inst| McpRunningServerInfo {
            id: inst.server_id.clone(),
            name: inst.server_name.clone(),
            tool_count: inst.tools.len(),
        })
        .collect();

    ok(list, trace)
}
