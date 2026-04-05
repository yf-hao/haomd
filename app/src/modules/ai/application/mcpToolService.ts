/**
 * MCP Tool Service — aggregates tools from enabled servers, routes execution,
 * and generates Dify-compatible prompt descriptions.
 */
import {
  loadMcpSettings,
  mcpStartServer,
  mcpStopServer,
  mcpCallTool,
  mcpListRunningServers,
  mcpListTools,
  type McpToolDef,
} from '../config/mcpSettingsRepo'

// ─── Types ──────────────────────────────────────────────────────────

/** OpenAI function-calling compatible tool definition */
export type OpenAITool = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: unknown
  }
}

export type AggregatedTool = {
  /** e.g. mcp__filesystem__read_file */
  qualifiedName: string
  serverId: string
  serverName: string
  originalName: string
  description: string
  inputSchema: unknown
}

// ─── Tool name encoding ─────────────────────────────────────────────

const SEPARATOR = '__'

function encodeToolName(serverName: string, toolName: string): string {
  const safe = serverName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()
  return `mcp${SEPARATOR}${safe}${SEPARATOR}${toolName}`
}

type McpRuntimeErrorKind = 'expired' | 'not_running' | 'auth' | 'other'

function isExpiredMcpSessionError(error: unknown): boolean {
  const message = String(error).toLowerCase()
  return (
    message.includes('会话已过期') ||
    message.includes('sessionexpired') ||
    message.includes('session expired') ||
    message.includes('invalid session') ||
    message.includes('unknown session') ||
    message.includes('mcp-session-id') ||
    message.includes('session id')
  )
}

function isServerNotRunningError(error: unknown): boolean {
  const message = String(error).toLowerCase()
  return (
    message.includes('未运行') ||
    message.includes('not running') ||
    message.includes("server '") && message.includes('未找到')
  )
}

function isAuthMcpError(error: unknown): boolean {
  const message = String(error).toLowerCase()
  return (
    message.includes('401') ||
    message.includes('unauthorized') ||
    message.includes('403') ||
    message.includes('forbidden') ||
    message.includes('invalid api key') ||
    message.includes('invalid token') ||
    message.includes('bearer')
  )
}

function classifyMcpRuntimeError(error: unknown): McpRuntimeErrorKind {
  if (isExpiredMcpSessionError(error)) return 'expired'
  if (isAuthMcpError(error)) return 'auth'
  if (isServerNotRunningError(error)) return 'not_running'
  return 'other'
}

async function loadServerToolsWithRecovery(serverId: string, running: boolean): Promise<McpToolDef[]> {
  if (!running) {
    return mcpStartServer(serverId)
  }

  let tools = await mcpListTools(serverId)
  if (tools.length > 0) {
    return tools
  }

  try {
    await mcpStopServer(serverId)
  } catch {
    // ignore stop failures; stale runtime state is acceptable here
  }

  tools = await mcpStartServer(serverId)
  return tools
}

// ─── Core functions ─────────────────────────────────────────────────

/**
 * Ensures all enabled servers are started, then aggregates their tools.
 * Returns flat list of tools with qualified names.
 */
export async function getEnabledTools(): Promise<AggregatedTool[]> {
  const settings = await loadMcpSettings()
  const enabledServers = settings.servers.filter((s) => s.enabled)
  if (enabledServers.length === 0) return []

  const running = await mcpListRunningServers()
  const runningIds = new Set(running.map((r) => r.id))

  const tools: AggregatedTool[] = []

  for (const srv of enabledServers) {
    try {
      const serverTools = await loadServerToolsWithRecovery(srv.id, runningIds.has(srv.id))

      for (const tool of serverTools) {
        tools.push({
          qualifiedName: encodeToolName(srv.name, tool.name),
          serverId: srv.id,
          serverName: srv.name,
          originalName: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })
      }
    } catch (err) {
      console.warn(`[mcpToolService] Failed to load tools from ${srv.name}:`, err)
    }
  }

  return tools
}

/**
 * Converts aggregated tools to OpenAI function-calling format.
 */
export function toOpenAITools(tools: AggregatedTool[]): OpenAITool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.qualifiedName,
      description: t.description,
      parameters: t.inputSchema ?? { type: 'object', properties: {} },
    },
  }))
}

/** Maximum number of full tool schemas to include in a single request */
const MAX_SCHEMA_TOOLS = 20

/**
 * Builds a compact catalog (name: description) for injection into the system prompt.
 * The catalog lets the model know ALL available tools without the token cost of full schemas.
 */
export function buildToolCatalog(tools: AggregatedTool[]): string {
  if (tools.length === 0) return ''
  const lines = tools.map((t) => `- ${t.qualifiedName}: ${t.description || '(no description)'}`)
  return `\n\n以下 MCP 工具可供调用（按需选择合适工具）：\n${lines.join('\n')}`
}

/**
 * Filters tools to the most relevant ones for the given user message.
 * Only the returned tools' full schemas are sent to the model — the rest appear
 * in the catalog so the model knows they exist but won't generate calls for them.
 */
export function filterToolsByRelevance(
  userMessage: string,
  allTools: AggregatedTool[],
  maxTools = MAX_SCHEMA_TOOLS,
): AggregatedTool[] {
  if (allTools.length <= maxTools) return allTools

  const words = userMessage
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2)

  if (words.length === 0) return allTools.slice(0, maxTools)

  const scored = allTools.map((tool) => {
    const haystack =
      `${tool.qualifiedName} ${tool.description} ${tool.serverName}`.toLowerCase()
    let score = 0
    for (const word of words) {
      if (haystack.includes(word)) score++
    }
    return { tool, score }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, maxTools).map((s) => s.tool)
}

/**
 * Execute a tool by qualified name. Routes to the correct MCP server.
 */
export async function executeTool(
  qualifiedName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any,
  tools: AggregatedTool[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const tool = tools.find((t) => t.qualifiedName === qualifiedName)
  if (!tool) {
    throw new Error(`Unknown tool: ${qualifiedName}`)
  }

  try {
    return await mcpCallTool(tool.serverId, tool.originalName, args)
  } catch (error) {
    const kind = classifyMcpRuntimeError(error)

    if (kind === 'auth') {
      throw error
    }

    if (kind === 'not_running') {
      console.warn(`[mcpToolService] MCP server not running for ${tool.serverName}, starting`)
      await mcpStartServer(tool.serverId)
      return mcpCallTool(tool.serverId, tool.originalName, args)
    }

    if (kind !== 'expired') {
      throw error
    }

    console.warn(`[mcpToolService] MCP session expired for ${tool.serverName}, restarting once`)

    try {
      await mcpStopServer(tool.serverId)
    } catch {
      // ignore stop failures; server may already be gone
    }

    await mcpStartServer(tool.serverId)
    return mcpCallTool(tool.serverId, tool.originalName, args)
  }
}
