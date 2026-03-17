import type { DocConversationRecord, DocConversationMessage } from '../domain/docConversations'

export interface ExportedAiMessage {
  id?: string
  role: 'user' | 'assistant' | 'system'
  content: string
  /** ISO 8601 格式的时间 */
  createdAt?: string
}

export interface ExportedAiSession {
  /** 原始会话 ID（导入时不会直接复用为内部 ID） */
  sessionId: string | null
  /** 可选标题，目前 DocConversationRecord 中没有，预留字段便于将来扩展 */
  title?: string
  createdAt: string
  updatedAt: string
  model?: string
  provider?: string
  workspaceId?: string | null
  documentPath?: string | null
  meta?: Record<string, unknown>
  messages: ExportedAiMessage[]
}

export interface ExportedAiSessionsPayload {
  version: number
  app: string
  exportedAt: string
  sessions: ExportedAiSession[]
}

function mapMessageToExported(m: DocConversationMessage): ExportedAiMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    createdAt: new Date(m.timestamp).toISOString(),
  }
}

export function mapDocConversationToExportedSession(record: DocConversationRecord): ExportedAiSession {
  const sortedMessages = [...record.messages].sort((a, b) => a.timestamp - b.timestamp)

  const createdAt =
    sortedMessages.length > 0 ? new Date(sortedMessages[0]!.timestamp).toISOString() : new Date().toISOString()
  const updatedAt = new Date(record.lastActiveAt).toISOString()

  return {
    sessionId: record.sessionId ?? null,
    title: undefined,
    createdAt,
    updatedAt,
    model: undefined,
    provider: undefined,
    workspaceId: undefined,
    documentPath: record.docPath,
    meta: undefined,
    messages: sortedMessages.map(mapMessageToExported),
  }
}

export function serializeExportedPayload(payload: ExportedAiSessionsPayload): string {
  return JSON.stringify(payload, null, 2)
}
