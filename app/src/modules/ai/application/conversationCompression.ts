import type { DocConversationMessage, DocConversationRecord, SummaryLevel } from '../domain/docConversations'
import type { ChatMessage } from '../domain/types'
import type { UiProvider } from '../settings'
import { loadAiSettingsState } from '../settings'
import { createStreamingClientFromSettings } from '../streamingClientFactory'
import { getAiCompressionSettings } from '../../settings/editorSettings'

/** 会话压缩策略配置 */
export type CompressionConfig = {
  /** 会话总消息数超过多少才考虑压缩 */
  minMessagesToCompress: number
  /** 保留最近多少轮完整对话（Tail），例如 8 轮 */
  keepRecentRounds: number
  /** 压缩后允许的最大消息条数，用于兜底保护（当前实现暂未使用） */
  maxMessagesAfterCompress: number
  /** 不同摘要层级允许的最大摘要字符数 */
  maxSummaryCharsPerLevel: (level: SummaryLevel) => number
  /** 单次参与摘要的最大旧消息数量 */
  maxMessagesPerSummaryBatch: number
}

/** 摘要提供方：封装具体模型/后端调用 */
export interface SummaryProvider {
  summarizeBatch(input: {
    docPath: string
    level: SummaryLevel
    messages: DocConversationMessage[]
  }): Promise<string>
}

/** 会话压缩服务接口：输入一份文档会话记录，输出压缩后的记录 */
export interface ConversationCompressor {
  compress(record: DocConversationRecord, config: CompressionConfig): Promise<DocConversationRecord>
}

/** 对话轮次分组结构，与 History UI 中的分组规则保持一致 */
type ConversationGroup = {
  id: string
  userMessages: DocConversationMessage[]
  assistantMessages: DocConversationMessage[]
  systemMessages: DocConversationMessage[]
  startedAt: number
}

function buildConversationGroups(messages: DocConversationMessage[]): ConversationGroup[] {
  if (!messages.length) return []

  const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp)
  const groups: ConversationGroup[] = []
  let current: ConversationGroup | null = null

  for (const m of sorted) {
    if (!current) {
      current = {
        id: m.id,
        userMessages: [],
        assistantMessages: [],
        systemMessages: [],
        startedAt: m.timestamp,
      }
      groups.push(current)
    }

    if (m.role === 'system') {
      current.systemMessages.push(m)
      continue
    }

    if (m.role === 'user') {
      // 简单策略：如果当前组已经有 user 或 assistant，则开启新组；否则归入当前组
      if (current.userMessages.length > 0 || current.assistantMessages.length > 0) {
        current = {
          id: m.id,
          userMessages: [m],
          assistantMessages: [],
          systemMessages: [],
          startedAt: m.timestamp,
        }
        groups.push(current)
      } else {
        current.userMessages.push(m)
      }
      continue
    }

    if (m.role === 'assistant') {
      current.assistantMessages.push(m)
      continue
    }
  }

  return groups
}

function flattenGroupMessages(groups: ConversationGroup[]): DocConversationMessage[] {
  const result: DocConversationMessage[] = []
  for (const g of groups) {
    result.push(...g.systemMessages, ...g.userMessages, ...g.assistantMessages)
  }
  return result
}

function pickOldAndRecentGroups(groups: ConversationGroup[], keepRecentRounds: number): {
  oldGroups: ConversationGroup[]
  recentGroups: ConversationGroup[]
} {
  if (groups.length <= keepRecentRounds) {
    return { oldGroups: [], recentGroups: groups }
  }
  const cutoff = Math.max(0, groups.length - keepRecentRounds)
  return {
    oldGroups: groups.slice(0, cutoff),
    recentGroups: groups.slice(cutoff),
  }
}

function createSummaryMessage(options: {
  docPath: string
  level: SummaryLevel
  content: string
  sourceMessages: DocConversationMessage[]
}): DocConversationMessage {
  const { docPath, level, content, sourceMessages } = options

  const now = Date.now()
  const timestamps = sourceMessages.map((m) => m.timestamp)
  const from = timestamps.length ? Math.min(...timestamps) : now
  const to = timestamps.length ? Math.max(...timestamps) : now

  return {
    id: `summary_${level}_${now}_${Math.random().toString(36).slice(2, 8)}`,
    docPath,
    timestamp: now,
    role: 'system',
    content,
    meta: {
      summaryLevel: level,
      coversMessageIds: sourceMessages.map((m) => m.id),
      coveredTimeRange: { from, to },
    },
  }
}

export function createConversationCompressor(summaryProvider: SummaryProvider): ConversationCompressor {
  return {
    async compress(record, config): Promise<DocConversationRecord> {
      const { messages } = record

      if (!messages.length || messages.length < config.minMessagesToCompress) {
        return record
      }

      const groups = buildConversationGroups(messages)
      if (!groups.length) return record

      const { oldGroups, recentGroups } = pickOldAndRecentGroups(groups, config.keepRecentRounds)
      if (!oldGroups.length) {
        // 没有足够旧的对话需要压缩
        return record
      }

      const oldMessagesAll = flattenGroupMessages(oldGroups)
      if (!oldMessagesAll.length) return record

      // 控制参与摘要的旧消息数量：优先使用最近的旧消息
      const sampledOldMessages = oldMessagesAll.slice(-config.maxMessagesPerSummaryBatch)

      // 先生成一级摘要
      const level1SummaryContent = await summaryProvider.summarizeBatch({
        docPath: record.docPath,
        level: 1,
        messages: sampledOldMessages,
      })
      const level1Summary = createSummaryMessage({
        docPath: record.docPath,
        level: 1,
        content: level1SummaryContent,
        sourceMessages: sampledOldMessages,
      })

      // 检查是否需要多级摘要：如果现有摘要内容总体超过阈值，则对摘要再做一次总结，生成二级摘要
      const existingSummaries = messages.filter((m) => (m.meta?.summaryLevel ?? 0) >= 1)
      const allLevel1Summaries = [...existingSummaries.filter((m) => (m.meta?.summaryLevel ?? 0) === 1), level1Summary]
      const totalLevel1Chars = allLevel1Summaries.reduce((sum, m) => sum + m.content.length, 0)

      let finalSummaries: DocConversationMessage[]

      if (totalLevel1Chars > config.maxSummaryCharsPerLevel(1)) {
        // 生成二级摘要：对所有一级摘要再次总结
        const level2SummaryContent = await summaryProvider.summarizeBatch({
          docPath: record.docPath,
          level: 2,
          messages: allLevel1Summaries,
        })
        const level2Summary = createSummaryMessage({
          docPath: record.docPath,
          level: 2,
          content: level2SummaryContent,
          sourceMessages: allLevel1Summaries,
        })
        finalSummaries = [level2Summary]
      } else {
        // 仅保留最新的一份一级摘要
        finalSummaries = [level1Summary]
      }

      const recentMessages = flattenGroupMessages(recentGroups)

      const next: DocConversationRecord = {
        ...record,
        lastActiveAt: Date.now(),
        messages: [...finalSummaries, ...recentMessages].sort((a, b) => a.timestamp - b.timestamp),
      }

      return next
    },
  }
}

/** 默认压缩配置：保留最近 8 轮对话，适配中等长度上下文模型 */
export const defaultCompressionConfig: CompressionConfig = {
  minMessagesToCompress: 80,
  keepRecentRounds: 8,
  maxMessagesAfterCompress: 200,
  maxMessagesPerSummaryBatch: 200,
  maxSummaryCharsPerLevel: (level: SummaryLevel) => {
    // Level 越高，允许的摘要长度可以稍微放宽一点
    if (level >= 2) return 12000
    return 8000
  },
}

/** 从 editor_settings 中动态加载压缩配置，失败时回退到默认值 */
export async function loadCompressionConfig(): Promise<CompressionConfig> {
  try {
    const uiCfg = await getAiCompressionSettings()
    return {
      minMessagesToCompress: uiCfg.minMessagesToCompress,
      keepRecentRounds: uiCfg.keepRecentRounds,
      maxMessagesAfterCompress: uiCfg.maxMessagesAfterCompress,
      maxMessagesPerSummaryBatch: uiCfg.maxMessagesPerSummaryBatch,
      maxSummaryCharsPerLevel: defaultCompressionConfig.maxSummaryCharsPerLevel,
    }
  } catch (e) {
    console.error('[conversationCompression] loadCompressionConfig failed, using defaults', e)
    return defaultCompressionConfig
  }
}

/** 一个简单的本地摘要实现：不会调用外部模型，用于占位和测试 */
export function createSimpleSummaryProvider(): SummaryProvider {
  return {
    async summarizeBatch({ docPath, level, messages }): Promise<string> {
      const lines: string[] = []

      lines.push(`## 会话摘要（Level ${level}）`)
      lines.push('')
      lines.push(`- 文档：${docPath}`)
      lines.push(`- 覆盖消息数：${messages.length}`)
      lines.push('')

      const maxItems = 20
      const tail = messages.slice(-maxItems)

      for (const m of tail) {
        const roleLabel = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'System'
        const ts = new Date(m.timestamp).toLocaleString()
        const snippet = m.content.length > 200 ? `${m.content.slice(0, 200)}...` : m.content
        lines.push(`- **${roleLabel} @ ${ts}**`)
        lines.push('')
        lines.push(`  ${snippet.replace(/\n/g, ' ')}`)
        lines.push('')
      }

      lines.push('')
      lines.push('> 注：当前摘要由本地规则生成，仅用于占位，后续可替换为真实 LLM 摘要。')

      return lines.join('\n')
    },
  }
}

function truncateContent(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}...`
}

function buildSummarySystemPrompt(level: SummaryLevel): string {
  const lines: string[] = []

  lines.push('你现在是一个会话压缩助手，负责为某个文档的 AI 对话历史生成结构化摘要。')
  lines.push('')
  lines.push('- 输出语言：与原始对话保持一致（通常为中文）。')
  lines.push('- 输出格式：Markdown，使用小标题和条目列表。')
  lines.push('- 摘要内容应包括：')
  lines.push('  - 主要目标与问题背景')
  lines.push('  - 关键结论与设计/实现决策')
  lines.push('  - 重要约定（参数、配置、接口约定等）')
  lines.push('  - 已完成的工作与落地方案')
  lines.push('  - 后续 TODO 或风险点')
  lines.push('')
  if (level >= 2) {
    lines.push('当前是更高层次的二级摘要，请聚焦更宏观的主题和结论，可以省略底层实现细节。')
  } else {
    lines.push('当前是一阶摘要，请尽量保留关键信息，但避免逐段复述原文。')
  }

  return lines.join('\n')
}

function buildSummaryChatMessages(input: {
  docPath: string
  level: SummaryLevel
  messages: DocConversationMessage[]
}): ChatMessage[] {
  const { docPath, level, messages } = input

  const MAX_PER_MESSAGE = 2000
  const normalized = messages.map((m) => ({
    ...m,
    content: truncateContent(m.content, MAX_PER_MESSAGE),
  }))

  const headerLines: string[] = []
  headerLines.push(`文档路径：${docPath}`)
  headerLines.push('')
  headerLines.push(`下面是需要被压缩的对话历史（Level ${level} 输入片段）：`)
  headerLines.push('')

  const bodyLines: string[] = []
  for (const m of normalized) {
    const roleLabel = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'System'
    const ts = new Date(m.timestamp).toISOString()
    bodyLines.push(`[${roleLabel} @ ${ts}]`)
    bodyLines.push(m.content)
    bodyLines.push('')
  }

  const userContent = [...headerLines, ...bodyLines].join('\n')

  const chatMessages: ChatMessage[] = [
    {
      role: 'user',
      content: userContent,
    },
  ]

  return chatMessages
}

async function pickDefaultProviderForSummary(): Promise<UiProvider | null> {
  const state = await loadAiSettingsState()
  if (!state.providers.length) return null
  const byDefault = state.providers.find((p) => p.id === state.defaultProviderId)
  return byDefault ?? state.providers[0]!
}

/** 使用当前默认 Provider/Model 的真实 LLM 摘要实现 */
export function createLLMSummaryProvider(): SummaryProvider {
  const fallback = createSimpleSummaryProvider()

  return {
    async summarizeBatch({ docPath, level, messages }): Promise<string> {
      try {
        const provider = await pickDefaultProviderForSummary()
        if (!provider) {
          console.warn('[SummaryProvider] no provider configured, fallback to simple summary')
          return fallback.summarizeBatch({ docPath, level, messages })
        }

        const systemPrompt = buildSummarySystemPrompt(level)
        const modelId = provider.defaultModelId ?? provider.models[0]?.id ?? ''
        if (!modelId) {
          console.warn('[SummaryProvider] provider has no modelId, fallback to simple summary')
          return fallback.summarizeBatch({ docPath, level, messages })
        }

        const client = createStreamingClientFromSettings(provider as UiProvider, systemPrompt, modelId)
        const chatMessages = buildSummaryChatMessages({ docPath, level, messages })

        let fullContent = ''
        const result = await client.askStream(
          {
            messages: chatMessages,
            temperature: 0,
            maxTokens: 1024,
          },
          {
            onChunk: (chunk) => {
              if (chunk.content) {
                fullContent += chunk.content
              }
            },
            onComplete: () => {
              // no-op, content 已在 onChunk 中累积
            },
            onError: (err) => {
              console.error('[SummaryProvider] LLM summarize error', err)
            },
          },
        )

        const trimmed = fullContent.trim() || result.content.trim()
        if (!trimmed) {
          console.warn('[SummaryProvider] empty summary from LLM, fallback to simple summary')
          return fallback.summarizeBatch({ docPath, level, messages })
        }

        return trimmed
      } catch (e) {
        console.error('[SummaryProvider] summarizeBatch failed, fallback to simple summary', e)
        return fallback.summarizeBatch({ docPath, level, messages })
      }
    },
  }
}
