/**
 * MCP Tool Service — aggregates tools from enabled servers, routes execution,
 * and generates Dify-compatible prompt descriptions.
 */
import {
  loadMcpSettings,
  mcpStartServer,
  mcpCallTool,
  mcpListRunningServers,
  mcpListTools,
  type McpToolDef,
  type McpServerCfg,
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

function decodeToolName(qualifiedName: string): { serverName: string; toolName: string } | null {
  const parts = qualifiedName.split(SEPARATOR)
  if (parts.length < 3 || parts[0] !== 'mcp') return null
  return {
    serverName: parts[1],
    toolName: parts.slice(2).join(SEPARATOR),
  }
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
      // Start server if not running
      let serverTools: McpToolDef[]
      if (!runningIds.has(srv.id)) {
        serverTools = await mcpStartServer(srv.id)
      } else {
        serverTools = await mcpListTools(srv.id)
      }

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
  return mcpCallTool(tool.serverId, tool.originalName, args)
}

/**
 * Generates tool description text for Dify prompt injection.
 * Format similar to what Claude/GPT system prompts use for tool descriptions.
 */
export function buildToolsPromptForDify(tools: AggregatedTool[]): string {
  if (tools.length === 0) return ''

  const lines: string[] = [
    'You have access to the following tools. To use a tool, respond with a JSON block:',
    '```json',
    '{"tool": "<tool_name>", "arguments": {<tool_arguments>}}',
    '```',
    '',
    'Available tools:',
    '',
  ]

  for (const t of tools) {
    lines.push(`### ${t.qualifiedName}`)
    lines.push(t.description)
    if (t.inputSchema && typeof t.inputSchema === 'object') {
      const schema = t.inputSchema as { properties?: Record<string, { type?: string; description?: string }> }
      if (schema.properties) {
        lines.push('Parameters:')
        for (const [key, prop] of Object.entries(schema.properties)) {
          lines.push(`- **${key}** (${prop.type ?? 'any'}): ${prop.description ?? ''}`)
        }
      }
    }
    lines.push('')
  }

  return lines.join('\n')
}
