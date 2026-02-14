import type { AiChatCommandBridge } from './AiChatCommandBridgeContext'

export type AiSlashCommandContext = {
  /** 当前关联文档路径；目前主要用于后续扩展 */
  docPath?: string
  /** 运行已有的 App 命令（通过 WorkspaceShell 中的命令系统桥接） */
  runAppCommand?: AiChatCommandBridge['runAppCommand']
}

export type AiSlashCommandHandler = (ctx: AiSlashCommandContext, args: string[]) => Promise<void> | void

export type AiSlashCommandDef = {
  name: string
  description: string
  handler: AiSlashCommandHandler
}

const slashCommands: Record<string, AiSlashCommandDef> = {
  clear: {
    name: 'clear',
    description: '清空当前文档的 AI 会话历史',
    async handler(ctx) {
      if (!ctx.runAppCommand) return
      await ctx.runAppCommand('ai_conversation_clear')
    },
  },
  compress: {
    name: 'compress',
    description: '压缩当前文档的 AI 会话历史',
    async handler(ctx) {
      if (!ctx.runAppCommand) return
      await ctx.runAppCommand('ai_conversation_compress')
    },
  },
  history: {
    name: 'history',
    description: '显示当前文档的 AI Session History',
    async handler(ctx) {
      if (!ctx.runAppCommand) return
      await ctx.runAppCommand('ai_conversation_history')
    },
  },
}

export function parseSlashCommand(input: string): { cmd: string; args: string[] } | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) return null

  const [rawCmd, ...args] = trimmed.slice(1).split(/\s+/)
  const cmd = rawCmd.toLowerCase()
  if (!cmd) return null

  return { cmd, args }
}

export async function tryHandleSlashCommand(
  input: string,
  ctx: AiSlashCommandContext,
): Promise<'handled' | 'not_command'> {
  const parsed = parseSlashCommand(input)
  if (!parsed) return 'not_command'

  const def = slashCommands[parsed.cmd]
  if (!def) {
    // 未知指令：目前直接让内容继续走模型，避免在 UI 中额外处理系统消息
    return 'not_command'
  }

  await Promise.resolve(def.handler(ctx, parsed.args))
  return 'handled'
}
