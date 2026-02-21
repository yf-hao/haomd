// Global Memory domain types
// 只包含纯数据结构，不涉及 IO 或具体实现细节

export type SessionDigest = {
  /** 对应文档的绝对路径 */
  docPath: string
  /** 摘要覆盖的时间范围（基于原始会话消息的 timestamp） */
  period: { from: number; to: number }
  /** 一批摘要消息的内容（通常来自不同层级的 summary 消息） */
  summaries: string[]
  /** 可选：该批摘要的主题标签，便于后续全局分析与过滤 */
  topics?: string[]
}

export type UserProfile = {
  /** 固定为 'user-profile'，方便持久化与查询 */
  id: 'user-profile'
  /** 最近一次更新时间（毫秒时间戳） */
  updatedAt: number
  /** 对用户整体特征的自然语言总结 */
  summary: string
  /** 写作 / 对话风格，如："concise", "detailed", "formal", "casual" 等 */
  writingStyle: string
  /** 兴趣主题标签，例如 ['frontend', 'ai-prompts', 'markdown'] */
  interests: string[]
  /** 常用语言，例如 ['zh-CN', 'en'] */
  languages: string[]
  /** 可选：偏好的模型 id 列表 */
  preferredModels?: string[]
}

export type GlobalMemoryItemType = 'preference' | 'habit' | 'fact' | 'instruction'

export type GlobalMemoryItem = {
  id: string
  type: GlobalMemoryItemType
  /** 简短标题，便于在管理列表中展示 */
  title: string
  /** 记忆条目的完整内容（自然语言描述） */
  content: string
  /** 来源文档路径集合 */
  sourceDocs: string[]
  /** 来源 Session 标识集合（实现细节可由 docConversation 层决定） */
  sourceSessions: string[]
  createdAt: number
  updatedAt: number
  /** 重要度 / 置信度，用于过滤与排序，范围约定为 0–1 */
  weight: number
  /** 标签用于快速筛选，如 language / style / format / code / paper 等 */
  tags?: string[]
  /** 被用户固定后，在过滤阶段会获得额外加成 */
  pinned?: boolean
  /** 被禁用的条目在过滤阶段会被直接忽略 */
  disabled?: boolean
}

export type GlobalMemorySettings = {
  /** 是否启用全局记忆功能 */
  enabled: boolean
  /** 是否允许自动从新 Session 学习 */
  autoUpdateEnabled: boolean
  /** 触发自动更新所需的最小 SessionDigest 数量 */
  minDigests: number
  /** 相邻两次自动更新之间的最小间隔（小时） */
  minIntervalHours: number
  /** 每次自动更新最多处理的摘要数量 */
  maxDigestsPerBatch: number
  /** 每日自动更新次数上限 */
  maxAutoUpdatesPerDay: number
}

/**
 * 全局记忆完整持久化状态。
 * - 由前端在本地（例如 localStorage 或后端存储）读写
 * - 后续 GlobalMemoryService 会在此基础上做增量更新
 */
export type GlobalMemoryState = {
  profile: UserProfile | null
  items: GlobalMemoryItem[]
  /** 等待被全局记忆服务消费的 SessionDigest 队列（增量输入） */
  pendingDigests: SessionDigest[]
  /** 最近一次全局记忆更新的时间（毫秒时间戳），无则为 null */
  lastGlobalUpdateTime: number | null
  /** 当日已执行的自动更新次数 */
  autoUpdateCountToday: number
  /** 记录 autoUpdateCountToday 对应的日期（例如 '2025-02-14'），用于跨天重置 */
  autoUpdateDayKey: string | null
}

export const DEFAULT_GLOBAL_MEMORY_SETTINGS: GlobalMemorySettings = {
  enabled: true,
  autoUpdateEnabled: true,
  minDigests: 10,
  minIntervalHours: 24,
  maxDigestsPerBatch: 30,
  maxAutoUpdatesPerDay: 2,
}
