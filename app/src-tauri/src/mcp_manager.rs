use crate::mcp_config::{McpServerCfg, McpSettingsCfg};
use crate::{err_payload, new_trace_id, ok, ErrorCode, ResultPayload};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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

// ─── Transport abstraction ──────────────────────────────────────────

struct StdioTransport {
    #[allow(dead_code)]
    child: Child,
    stdin: ChildStdin,
    stdout_reader: BufReader<ChildStdout>,
    next_id: u64,
}

// ─── Server instance ────────────────────────────────────────────────

pub(crate) struct McpServerInstance {
    #[allow(dead_code)]
    server_id: String,
    server_name: String,
    transport: StdioTransport,
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

// ─── Internal helpers ───────────────────────────────────────────────

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

    // Read lines until we get a response matching our id
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
            // id mismatch (notification or other) — keep reading
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

fn spawn_stdio_process(cfg: &McpServerCfg) -> Result<StdioTransport, String> {
    let command = cfg
        .command
        .as_deref()
        .ok_or("stdio server 未配置 command")?;
    let args = cfg.args.as_deref().unwrap_or(&[]);

    let mut cmd = tokio::process::Command::new(command);
    cmd.args(args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    if let Some(env) = &cfg.env {
        for (k, v) in env {
            cmd.env(k, v);
        }
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("启动 MCP Server 失败: {e}"))?;
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

async fn initialize_and_list_tools(
    t: &mut StdioTransport,
) -> Result<Vec<McpToolDef>, String> {
    // 1. initialize handshake
    let init_params = serde_json::json!({
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {
            "name": "HaoMD",
            "version": "0.5.0"
        }
    });
    let _server_info = stdio_send_request(t, "initialize", Some(init_params)).await?;

    // 2. send initialized notification
    stdio_send_notification(t, "notifications/initialized", None).await?;

    // 3. list tools
    let tools_result = stdio_send_request(t, "tools/list", None).await?;
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
pub async fn mcp_start_server(
    app: AppHandle,
    server_id: String,
) -> ResultPayload<Vec<McpToolDef>> {
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

    if cfg.transport != "stdio" {
        return err_payload(
            ErrorCode::IoError,
            format!("暂不支持 '{}' 传输方式，目前仅支持 stdio", cfg.transport),
            trace,
        );
    }

    // Spawn process
    let mut transport = match spawn_stdio_process(&cfg) {
        Ok(t) => t,
        Err(e) => return err_payload(ErrorCode::IoError, e, trace),
    };

    // Initialize + list tools
    let tools = match initialize_and_list_tools(&mut transport).await {
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
pub async fn mcp_stop_server(
    app: AppHandle,
    server_id: String,
) -> ResultPayload<()> {
    let trace = new_trace_id();
    let mgr = app.state::<McpProcessManager>();
    let mut instances = mgr.instances.lock().await;

    if let Some(mut inst) = instances.remove(&server_id) {
        let _ = inst.transport.child.kill().await;
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
pub async fn mcp_list_tools(
    app: AppHandle,
    server_id: String,
) -> ResultPayload<Vec<McpToolDef>> {
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

    match stdio_send_request(&mut inst.transport, "tools/call", Some(params)).await {
        Ok(result) => ok(result, trace),
        Err(e) => err_payload(
            ErrorCode::IoError,
            format!("调用工具 '{tool_name}' 失败: {e}"),
            trace,
        ),
    }
}

#[tauri::command]
pub async fn mcp_list_running_servers(
    app: AppHandle,
) -> ResultPayload<Vec<McpRunningServerInfo>> {
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
