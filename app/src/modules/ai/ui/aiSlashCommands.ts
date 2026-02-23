import type { AiChatCommandBridge } from './AiChatCommandBridgeContext'
import { enqueueSessionDigestFromChatSummary } from '../globalMemory/sessionDigestQueue'

export type AiSlashCommandContext = {
  /** 当前关联文档路径；目前主要用于后续扩展 */
  docPath?: string
  /** 运行已有的 App 命令（通过 WorkspaceShell 中的命令系统桥接） */
  runAppCommand?: AiChatCommandBridge['runAppCommand']
  /** 在当前 AI Chat 中展示一条模态提示 */
  showModal?: (message: string) => void
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
  remember: {
    name: 'remember',
    description: '将当前文档的一段摘要加入 Global Memory 队列',
    async handler(ctx, args) {
      const docPath = ctx.docPath
      if (!docPath) {
        if (ctx.showModal) {
          ctx.showModal('当前文档尚未保存，无法使用 /remember。请先保存文档后再试。')
        } else {
          console.warn('[aiSlashCommands] /remember requires docPath, ignored')
        }
        return
      }

      const summaryText = args.join(' ').trim()
      if (!summaryText) {
        if (ctx.showModal) {
          ctx.showModal('请在 /remember 后输入摘要内容，例如：/remember 本次会话的要点…')
        } else {
          console.warn('[aiSlashCommands] /remember requires non-empty summary text, ignored')
        }
        return
      }

      try {
        enqueueSessionDigestFromChatSummary({
          docPath,
          summary: summaryText,
        })
        console.log('[aiSlashCommands] /remember enqueued SessionDigest for docPath:', docPath)
        if (ctx.showModal) {
          ctx.showModal('已将当前文档摘要加入 Global Memory 待学习队列')
        }
      } catch (e) {
        console.error('[aiSlashCommands] failed to enqueue SessionDigest from /remember', e)
      }
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
