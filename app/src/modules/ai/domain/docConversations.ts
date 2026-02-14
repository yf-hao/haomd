// 文档级会话数据模型：只包含纯数据结构，不涉及 IO

export type SummaryLevel = 0 | 1 | 2

export type DocConversationMessageMeta = {
  providerType?: 'dify' | 'openai' | 'local' | 'coze' | 'other'
  modelName?: string
  hasImage?: boolean
  tokensUsed?: number
  /** 0 表示原始消息，1/2 表示不同层级的摘要 */
  summaryLevel?: SummaryLevel
  /** 仅摘要消息使用：覆盖的原始/摘要消息 ID 列表 */
  coversMessageIds?: string[]
  /** 仅摘要消息使用：覆盖的时间范围 */
  coveredTimeRange?: { from: number; to: number }
}

// 单条消息（用于文档会话时间线与非 Dify 模型上下文来源）
export type DocConversationMessage = {
  id: string
  docPath: string
  timestamp: number
  role: 'user' | 'assistant' | 'system'
  content: string
  meta?: DocConversationMessageMeta
}

// 按 docPath 聚合的一份文档会话记录
export type DocConversationRecord = {
  docPath: string
  sessionId: string
  lastActiveAt: number
  difyConversationId?: string
  messages: DocConversationMessage[]
}

// 轻量索引结构：用于列表/菜单展示
export type ConversationIndexEntry = {
  docPath: string
  sessionId: string
  lastActiveAt: number
  hasDifyConversation: boolean
  messageCount: number
}
