import type { ConversationState, EntryContext, ChatEntryMode } from './chatSession'
import type { SystemPromptInfo } from '../application/systemPromptService'
import type { ProviderType } from './types'

/**
 * 按 tab 维度持久化的 AI Chat 会话快照。
 * 只保存纯数据，不保存 ChatSession 实例本身。
 */
export type PersistedAiChatSession = {
  /** Tab ID，作为会话的逻辑主键 */
  tabId: string
  /** 会话状态（engineHistory + viewMessages 等） */
  state: ConversationState
  /** 系统提示词信息 */
  systemPromptInfo: SystemPromptInfo | null
  /** 当前使用的 Provider 类型（openai / dify / local 等） */
  providerType: ProviderType | null
  /** 对话入口模式（chat/file/selection） */
  entryMode: ChatEntryMode
  /** 初始上下文（文件全文 / 选区等），用于首轮对话 */
  initialContext?: EntryContext
  /** 创建时间戳（ms） */
  createdAt: number
  /** 最近一次更新的时间戳（ms） */
  updatedAt: number
}

/**
 * AI Chat 会话持久化管理器接口。
 *
 * - 负责在浏览器环境中读写 localStorage（或未来的其它存储实现）。
 * - 通过 tabId 读写对应的会话快照。
 */
export interface IAiChatSessionManager {
  /**
   * 获取已保存的会话快照；如果不存在，返回 null。
   * 注意：这里不负责真正“创建” ChatSession，仅管理持久化数据。
   */
  getOrCreateSession(tabId: string): PersistedAiChatSession | null

  /**
   * 保存会话状态（幂等覆盖）。
   */
  saveSession(tabId: string, data: {
    state: ConversationState
    systemPromptInfo: SystemPromptInfo | null
    providerType: ProviderType | null
    entryMode?: ChatEntryMode
    initialContext?: EntryContext
  }): void

  /** 删除指定 tabId 下的会话快照。 */
  deleteSession(tabId: string): void

  /** 清理所有会话快照。 */
  clearAllSessions(): void

  /** 判断指定 tabId 是否存在会话快照。 */
  hasSession(tabId: string): boolean
}
