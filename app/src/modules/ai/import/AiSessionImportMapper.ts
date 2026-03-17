import type { ExportedAiSessionsPayload, ExportedAiSession, ExportedAiMessage } from '../export/AiSessionExportModel'
import type { DocConversationMessage } from '../domain/docConversations'

function genMessageId(): string {
  return `imported_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function toTimestamp(ms: ExportedAiMessage, session: ExportedAiSession, now: number): number {
  if (ms.createdAt) {
    const t = Date.parse(ms.createdAt)
    if (Number.isFinite(t)) return t
  }
  if (session.updatedAt) {
    const t = Date.parse(session.updatedAt)
    if (Number.isFinite(t)) return t
  }
  if (session.createdAt) {
    const t = Date.parse(session.createdAt)
    if (Number.isFinite(t)) return t
  }
  return now
}

/**
 * 将导出的会话 payload 展平为一批 DocConversationMessage：
 * - docPath 先使用传入的 targetDocPath，稍后会在 service 层归一为稳定 key；
 * - 时间戳优先使用 message.createdAt，其次 session.updatedAt / createdAt，最后使用当前时间；
 * - meta 中仅填充基本 provider/model 信息，summary 相关字段保持空。
 */
export function buildImportedMessagesFromPayload(
  payload: ExportedAiSessionsPayload,
  targetDocPath: string,
): DocConversationMessage[] {
  const now = Date.now()
  const messages: DocConversationMessage[] = []

  for (const session of payload.sessions) {
    const providerType: 'dify' | 'openai' | 'local' | 'coze' | 'other' | undefined = 'other'
    const modelName = session.model || undefined

    for (const m of session.messages) {
      const timestamp = toTimestamp(m, session, now)
      messages.push({
        id: genMessageId(),
        docPath: targetDocPath,
        timestamp,
        role: m.role,
        content: m.content,
        meta: {
          providerType,
          modelName,
        },
      })
    }
  }

  // 为防止输入乱序，这里先按 timestamp 排一下序；后续在 service 合并时会再次排序
  messages.sort((a, b) => a.timestamp - b.timestamp)

  return messages
}
