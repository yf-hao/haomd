import type { AiChatCommandBridge } from './AiChatCommandBridgeContext'
import type { ChatMessageView } from '../domain/chatSession'
import { enqueueSessionDigestFromChat } from '../globalMemory/sessionDigestQueue'
import { buildAutoDigestSummaryForCurrentChat } from '../globalMemory/chatAutoDigest'

export type AiSlashCommandContext = {
  /** 当前关联文档路径；目前主要用于后续扩展 */
  docPath?: string
  /** 运行已有的 App 命令（通过 WorkspaceShell 中的命令系统桥接） */
  runAppCommand?: AiChatCommandBridge['runAppCommand']
  /** 在当前 AI Chat 中展示一条模态提示 */
  showModal?: (message: string) => void
  /**
   * 从当前 AI Chat 会话中获取最近的若干条消息，用于会话摘要/全局记忆。
   * - 只应返回 user/assistant 消息；
   * - 应过滤掉 hidden 消息；
   * - 按时间顺序返回最后 limit 条。
   */
  getRecentMessagesForDigest?: (limit: number) => ChatMessageView[]
  /** 在当前 AI Chat 中打开输入历史弹窗（例如 /list 命令） */
  openHistoryDialog?: (payload: { docPath?: string }) => void
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
    description: '显示当前文档的 AI 会话历史',
    async handler(ctx) {
      if (!ctx.runAppCommand) return
      await ctx.runAppCommand('ai_conversation_history')
    },
  },
  list: {
    name: 'list',
    description: '显示当前目录的 AI 输入历史列表',
    async handler(ctx) {
      if (ctx.openHistoryDialog) {
        ctx.openHistoryDialog({ docPath: ctx.docPath })
        return
      }
      if (ctx.showModal) {
        ctx.showModal('当前版本未挂载输入历史弹窗，无法使用 /list。')
      } else {
        console.warn('[aiSlashCommands] /list requires openHistoryDialog, ignored')
      }
    },
  },
  remember: {
    name: 'remember',
    description: '将当前会话中对未来有用的偏好摘要加入 Global Memory 队列',
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

      const userSummary = args.join(' ').trim()
      const hasUserSummary = !!userSummary

      const getMessages = ctx.getRecentMessagesForDigest

      // 情况一：用户提供了手写摘要
      if (hasUserSummary) {
        let autoSummary: string | null = null

        if (getMessages) {
          try {
            const messages = getMessages(30)
            if (messages.length) {
              const summary = await buildAutoDigestSummaryForCurrentChat({
                docPath,
                messages,
              })
              if (summary.trim()) {
                autoSummary = summary.trim()
              }
            }
          } catch (err) {
            console.warn('[aiSlashCommands] /remember auto summary failed, fallback to user only', err)
          }
        }

        const summaries = autoSummary ? [userSummary, autoSummary] : [userSummary]

        try {
          enqueueSessionDigestFromChat({
            docPath,
            summaries,
          })
          console.log('[aiSlashCommands] /remember enqueued SessionDigest for docPath:', docPath)
          if (ctx.showModal) {
            if (autoSummary) {
              ctx.showModal('已将你手写摘要及自动总结一起加入 Global Memory 队列。')
            } else {
              ctx.showModal('已将你手写的摘要加入 Global Memory 队列（自动总结失败，未加入）。')
            }
          }
        } catch (e) {
          console.error('[aiSlashCommands] failed to enqueue SessionDigest from /remember', e)
        }

        return
      }

      // 情况二：无参数，纯自动摘要
      if (!getMessages) {
        if (ctx.showModal) {
          ctx.showModal('当前会话内容太少，无法生成摘要。')
        }
        console.warn('[aiSlashCommands] /remember auto summary requested but getRecentMessagesForDigest is not available')
        return
      }

      const messages = getMessages(30)
      if (!messages.length) {
        if (ctx.showModal) {
          ctx.showModal('当前会话内容太少，无法生成摘要。')
        }
        return
      }

      try {
        const autoSummary = (await buildAutoDigestSummaryForCurrentChat({ docPath, messages })).trim()
        if (!autoSummary) {
          if (ctx.showModal) {
            ctx.showModal('自动总结结果为空，未加入 Global Memory。')
          }
          return
        }

        enqueueSessionDigestFromChat({
          docPath,
          summaries: [autoSummary],
          source: 'chat-remember-auto',
        })
        console.log('[aiSlashCommands] /remember enqueued auto SessionDigest for docPath:', docPath)
        if (ctx.showModal) {
          ctx.showModal('已根据当前会话生成摘要并加入 Global Memory 队列。')
        }
      } catch (err) {
        console.error('[aiSlashCommands] /remember auto summary failed', err)
        if (ctx.showModal) {
          ctx.showModal('自动总结当前会话失败，请稍后重试。')
        }
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

/**
 * 解析形如 `!2` 或 `！2` 的本地历史回填命令：
 * - 以半角/全角感叹号开头；
 * - 后面紧跟正整数编号（按时间顺序编号，最早为 1，最新为 N）。
 */
export function parseHistoryRecallCommand(input: string): number | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const first = trimmed[0]
  if (first !== '!' && first !== '！') return null
  const rest = trimmed.slice(1).trim()
  if (!rest) return null
  if (!/^\d+$/.test(rest)) return null
  const n = Number(rest)
  if (!Number.isSafeInteger(n) || n <= 0) return null
  return n
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

/**
 * 返回当前可用的 slash 命令定义列表，用于输入提示等 UI 逻辑。
 * UI 层不应直接依赖内部的 slashCommands 映射，以便未来支持隐藏命令等扩展。
 */
export function listAiSlashCommands(): AiSlashCommandDef[] {
  return Object.values(slashCommands)
}
