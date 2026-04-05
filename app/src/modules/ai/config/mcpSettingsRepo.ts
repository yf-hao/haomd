import { invoke } from '@tauri-apps/api/core'
import type { BackendResult } from '../../platform/backendTypes'

// ─── Types matching Rust structs (camelCase via serde rename_all) ────

export type McpGroupCfg = {
  id: string
  name: string
  order: number
}

export type McpServerCfg = {
  id: string
  name: string
  groupId?: string | null
  enabled: boolean
  transport: 'stdio' | 'sse' | 'streamable-http'
  // stdio
  command?: string | null
  args?: string[] | null
  env?: Record<string, string> | null
  // sse
  url?: string | null
  headers?: Record<string, string> | null
  order: number
}

export type McpSettingsCfg = {
  groups: McpGroupCfg[]
  servers: McpServerCfg[]
}

export type McpToolDef = {
  name: string
  description: string
  inputSchema: unknown
}

export type McpRunningServerInfo = {
  id: string
  name: string
  toolCount: number
}

// ─── Config CRUD ────────────────────────────────────────────────────

export async function loadMcpSettings(): Promise<McpSettingsCfg> {
  const resp = await invoke<BackendResult<McpSettingsCfg>>('load_mcp_settings')
  if ('Ok' in resp) return resp.Ok.data
  console.warn('[mcp] load_mcp_settings error', resp.Err.error)
  return { groups: [], servers: [] }
}

export async function saveMcpSettings(cfg: McpSettingsCfg): Promise<void> {
  const resp = await invoke<BackendResult<void>>('save_mcp_settings', { cfg })
  if ('Err' in resp) {
    console.error('[mcp] save_mcp_settings error', resp.Err.error)
  }
}

// ─── Server management ──────────────────────────────────────────────

export async function mcpStartServer(serverId: string): Promise<McpToolDef[]> {
  const resp = await invoke<BackendResult<McpToolDef[]>>('mcp_start_server', { serverId })
  if ('Ok' in resp) return resp.Ok.data
  console.error('[mcp] mcp_start_server error', resp.Err.error)
  throw new Error(resp.Err.error.message)
}

export async function mcpTestServer(cfg: McpServerCfg): Promise<McpToolDef[]> {
  const resp = await invoke<BackendResult<McpToolDef[]>>('mcp_test_server', { cfg })
  if ('Ok' in resp) return resp.Ok.data
  console.error('[mcp] mcp_test_server error', resp.Err.error)
  throw new Error(resp.Err.error.message)
}

export async function mcpStopServer(serverId: string): Promise<void> {
  const resp = await invoke<BackendResult<void>>('mcp_stop_server', { serverId })
  if ('Err' in resp) {
    console.error('[mcp] mcp_stop_server error', resp.Err.error)
  }
}

export async function mcpListTools(serverId: string): Promise<McpToolDef[]> {
  const resp = await invoke<BackendResult<McpToolDef[]>>('mcp_list_tools', { serverId })
  if ('Ok' in resp) return resp.Ok.data
  console.warn('[mcp] mcp_list_tools error', resp.Err.error)
  return []
}

export async function mcpCallTool(
  serverId: string,
  toolName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const resp = await invoke<BackendResult<unknown>>('mcp_call_tool', {
    serverId,
    toolName,
    arguments: args,
  })
  if ('Ok' in resp) return resp.Ok.data
  console.error('[mcp] mcp_call_tool error', resp.Err.error)
  throw new Error(resp.Err.error.message)
}

export async function mcpListRunningServers(): Promise<McpRunningServerInfo[]> {
  const resp = await invoke<BackendResult<McpRunningServerInfo[]>>('mcp_list_running_servers')
  if ('Ok' in resp) return resp.Ok.data
  console.warn('[mcp] mcp_list_running_servers error', resp.Err.error)
  return []
}
