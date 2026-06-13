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
  /** 从被压缩的旧轮次中最多保留多少条原始 user 消息 */
  maxPreservedUserMessages: number
  /** 压缩后允许的最大消息条数，用于兜底保护（当前实现暂未使用） */
  maxMessagesAfterCompress: number
  /** 不同摘要层级允许的最大摘要字符数 */
  maxSummaryCharsPerLevel: (level: SummaryLevel) => number
  /** 单次参与摘要的最大旧消息数量 */
  maxMessagesPerSummaryBatch: number
  /** 单次参与摘要的最大输入字符数，用于在模型上下文不足时更保守地切批 */
  maxInputCharsPerSummaryBatch: number
}

export type CompressionProgressEvent =
  | { phase: 'summarizing-batch'; level: 1; currentBatch: number; totalBatches: number }
  | { phase: 'summarizing-level2'; level: 2; totalBatches: number }

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
  compress(
    record: DocConversationRecord,
    config: CompressionConfig,
    options?: {
      onProgress?: (event: CompressionProgressEvent) => void
    },
  ): Promise<DocConversationRecord>
}

export class ConversationCompressionTimeoutError extends Error {
  readonly timeoutMs: number

  constructor(timeoutMs: number) {
    super(`Conversation compression timed out after ${timeoutMs}ms`)
    this.name = 'ConversationCompressionTimeoutError'
    this.timeoutMs = timeoutMs
  }
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

function toPreservedUserInputSnippet(message: DocConversationMessage): string {
  const normalized = message.content.replace(/\s+/g, ' ').trim()
  if (normalized.length <= 500) return normalized
  return `${normalized.slice(0, 500)}...`
}

function buildPreservedUserInputs(messages: DocConversationMessage[]): string[] {
  const seen = new Set<string>()
  const snippets: string[] = []

  for (const message of messages) {
    const snippet = toPreservedUserInputSnippet(message)
    if (!snippet || seen.has(snippet)) continue
    seen.add(snippet)
    snippets.push(snippet)
  }

  return snippets
}

function estimateSummaryMessageChars(message: DocConversationMessage): number {
  return message.content.trim().length + 64
}

function buildSummaryBatches(
  messages: DocConversationMessage[],
  config: Pick<CompressionConfig, 'maxMessagesPerSummaryBatch' | 'maxInputCharsPerSummaryBatch'>,
): DocConversationMessage[][] {
  if (!messages.length) return []

  const limitedMessages = messages.slice(-config.maxMessagesPerSummaryBatch)
  const batches: DocConversationMessage[][] = []
  let currentBatch: DocConversationMessage[] = []
  let currentChars = 0

  for (const message of limitedMessages) {
    const nextChars = estimateSummaryMessageChars(message)
    const exceedsBudget =
      currentBatch.length > 0 && currentChars + nextChars > config.maxInputCharsPerSummaryBatch

    if (exceedsBudget) {
      batches.push(currentBatch)
      currentBatch = []
      currentChars = 0
    }

    currentBatch.push(message)
    currentChars += nextChars
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch)
  }

  return batches
}

const USER_REFERENCE_PATTERNS = [
  /第[一二三四五六七八九十\d]+个方案/,
  /第[一二三四五六七八九十\d]+种方案/,
  /方案[一二三四五六七八九十\d]+/,
  /按你说的/,
  /按.*实现/,
  /用这个/,
  /就这个/,
  /这样实现/,
  /这个方向/,
  /这个方案/,
  /上面/,
  /前面/,
  /继续/,
]

function containsUserReference(content: string): boolean {
  const normalized = content.replace(/\s+/g, '')
  return USER_REFERENCE_PATTERNS.some((pattern) => pattern.test(normalized))
}

function buildLevel1SummaryInputMessages(batch: DocConversationMessage[]): DocConversationMessage[] {
  const result: DocConversationMessage[] = []
  const includedIds = new Set<string>()
  let previousAssistant: DocConversationMessage | null = null

  const include = (message: DocConversationMessage) => {
    if (includedIds.has(message.id)) return
    includedIds.add(message.id)
    result.push(message)
  }

  for (const message of batch) {
    if (message.role === 'assistant') {
      previousAssistant = message
      continue
    }

    if (message.role !== 'user') {
      continue
    }

    if (previousAssistant && containsUserReference(message.content)) {
      include(previousAssistant)
    }
    include(message)
  }

  return result
}

function collectPreservedUserInputsFromMessages(messages: DocConversationMessage[]): string[] {
  const snippets: string[] = []
  const seen = new Set<string>()

  for (const message of messages) {
    const items = message.meta?.preservedUserInputs ?? []
    for (const item of items) {
      const normalized = item.trim()
      if (!normalized || seen.has(normalized)) continue
      seen.add(normalized)
      snippets.push(normalized)
    }
  }

  return snippets
}

function createSummaryMessage(options: {
  docPath: string
  level: SummaryLevel
  content: string
  sourceMessages: DocConversationMessage[]
  preservedUserInputs?: string[]
}): DocConversationMessage {
  const { docPath, level, content, sourceMessages, preservedUserInputs = [] } = options

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
      preservedUserInputs,
    },
  }
}

export function createConversationCompressor(summaryProvider: SummaryProvider): ConversationCompressor {
  return {
    async compress(record, config, options): Promise<DocConversationRecord> {
      const { messages } = record

      if (!messages.length || messages.length < config.minMessagesToCompress) {
        return record
      }

      // #2/#6: 分离已有摘要与普通消息
      const existingSummaries = messages.filter((m) => (m.meta?.summaryLevel ?? 0) >= 1)
      const normalMessages = messages.filter((m) => (m.meta?.summaryLevel ?? 0) === 0)

      const groups = buildConversationGroups(normalMessages)
      if (!groups.length) return record

      const { oldGroups, recentGroups } = pickOldAndRecentGroups(groups, config.keepRecentRounds)
      if (!oldGroups.length) {
        return record
      }

      const oldMessagesAll = flattenGroupMessages(oldGroups)
      if (!oldMessagesAll.length) return record

      // #6 增量压缩：排除已被摘要覆盖的消息
      const coveredIds = new Set(existingSummaries.flatMap((s) => s.meta?.coversMessageIds ?? []))
      const uncoveredOldMessages = oldMessagesAll.filter((m) => !coveredIds.has(m.id))

      const recentMessages = flattenGroupMessages(recentGroups)

      if (!uncoveredOldMessages.length) {
        // 所有旧消息都已被摘要覆盖，无需再次压缩，仅清理结构
        return {
          ...record,
          lastActiveAt: Date.now(),
          messages: [...existingSummaries, ...recentMessages].sort((a, b) => a.timestamp - b.timestamp),
        }
      }

      const summaryBatches = buildSummaryBatches(uncoveredOldMessages, config)
      if (!summaryBatches.length) {
        return {
          ...record,
          lastActiveAt: Date.now(),
          messages: [...existingSummaries, ...recentMessages].sort((a, b) => a.timestamp - b.timestamp),
        }
      }

      const level1Summaries: DocConversationMessage[] = []
      for (const [index, batch] of summaryBatches.entries()) {
        options?.onProgress?.({
          phase: 'summarizing-batch',
          level: 1,
          currentBatch: index + 1,
          totalBatches: summaryBatches.length,
        })
        const preservedUserInputs = buildPreservedUserInputs(
          batch.filter((message): message is DocConversationMessage => message.role === 'user'),
        )
        const level1InputMessages = buildLevel1SummaryInputMessages(batch)
        if (!level1InputMessages.length) {
          continue
        }
        const level1SummaryContent = await summaryProvider.summarizeBatch({
          docPath: record.docPath,
          level: 1,
          messages: level1InputMessages,
        })
        level1Summaries.push(
          createSummaryMessage({
            docPath: record.docPath,
            level: 1,
            content: level1SummaryContent,
            sourceMessages: batch,
            preservedUserInputs,
          }),
        )
      }

      // #2 累积保留：将已有摘要与新摘要合并
      const allLevel1Summaries = [
        ...existingSummaries.filter((m) => (m.meta?.summaryLevel ?? 0) === 1),
        ...level1Summaries,
      ]
      const totalLevel1Chars = allLevel1Summaries.reduce((sum, m) => sum + m.content.length, 0)

      let finalSummaries: DocConversationMessage[]

      if (totalLevel1Chars > config.maxSummaryCharsPerLevel(1)) {
        options?.onProgress?.({
          phase: 'summarizing-level2',
          level: 2,
          totalBatches: allLevel1Summaries.length,
        })
        const level2PreservedUserInputs = collectPreservedUserInputsFromMessages(allLevel1Summaries)
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
          preservedUserInputs: level2PreservedUserInputs,
        })
        finalSummaries = [level2Summary]
      } else {
        // #2: 保留所有已有摘要 + 新摘要（而非仅保留最新一份）
        finalSummaries = [...existingSummaries, ...level1Summaries]
      }

      // #3: 结果中不再包含 preservedUserMessages 完整消息
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
  minMessagesToCompress: 0,
  keepRecentRounds: 8,
  maxPreservedUserMessages: 50,
  maxMessagesAfterCompress: 200,
  maxMessagesPerSummaryBatch: 200,
  maxInputCharsPerSummaryBatch: 12000,
  maxSummaryCharsPerLevel: (level: SummaryLevel) => {
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
      maxPreservedUserMessages: defaultCompressionConfig.maxPreservedUserMessages,
      maxMessagesAfterCompress: uiCfg.maxMessagesAfterCompress,
      maxMessagesPerSummaryBatch: uiCfg.maxMessagesPerSummaryBatch,
      maxInputCharsPerSummaryBatch: uiCfg.maxInputCharsPerSummaryBatch,
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

      const userSnippets = tail
        .filter((m) => m.role === 'user')
        .map((m) => {
          const snippet = m.content.length > 120 ? `${m.content.slice(0, 120)}...` : m.content
          return `- ${snippet.replace(/\n/g, ' ')}`
        })

      if (userSnippets.length) {
        lines.push('### 用户输入分类整理')
        lines.push('')
        lines.push(...userSnippets)
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
  lines.push('  - **用户输入分类整理**（这是最重要的部分，见下方详细要求）')
  lines.push('  - 重要约定（参数、配置、接口约定等）')
  lines.push('  - 已完成的工作与落地方案')
  lines.push('  - 后续 TODO 或风险点')
  lines.push('')
  lines.push('### 用户输入分类整理要求（核心）')
  lines.push('- 必须输出“用户输入分类整理”这一节，将用户的所有核心输入按主题分类归纳。')
  lines.push('- 分类维度示例：需求/功能要求、技术约束/限制、方案选择与确认、Bug 反馈、偏好与风格要求。')
  lines.push('- 每个分类下列出用户的关键原话或核心意图，尽量保留用户原始措辞中的关键词。')
  lines.push('- 不能只总结 assistant 的回答，必须完整体现用户到底问了什么、要求了什么、限制了什么、确认了什么。')
  lines.push('- 不得遗漏任何实质性的用户需求或决策。')
  lines.push('')
  if (level >= 2) {
    lines.push('当前是更高层次的二级摘要，请聚焦更宏观的主题和结论，可以省略底层实现细节，但用户输入分类整理仍需完整保留。')
  } else {
    lines.push('当前是一阶摘要，重点不是总结 assistant 回答，而是尽可能完整保留用户输入。')
    lines.push('- 必须优先记录用户提出的问题、需求、限制、纠正、偏好、确认和反复强调的点。')
    lines.push('- 如果输入中出现 Assistant Context，它只用于解析用户的引用表达，例如“第二个方案”“按你说的”“继续”，不要独立总结 assistant 内容。')
    lines.push('- assistant 的内容只作为理解用户输入背景、结论和已完成工作的辅助信息，不要让 assistant 回答淹没用户意图。')
    lines.push('- 对短用户输入也要保留其原始关键词，例如“继续”“为什么”“转换为 typst”“不要保存”等，因为这些通常代表上下文动作或约束。')
    lines.push('- 避免逐段复述 assistant 长回答；如果需要引用 assistant 内容，应压缩为与用户输入相关的结论。')
  }

  return lines.join('\n')
}

function buildSummaryChatMessages(input: {
  docPath: string
  level: SummaryLevel
  messages: DocConversationMessage[]
}): ChatMessage[] {
  const { docPath, level, messages } = input

  // #4 智能截断：总量预算制，user 消息不截断，assistant/system 按比例分配
  const TOTAL_BUDGET = 30000
  let usedByUser = 0
  for (const m of messages) {
    if (m.role === 'user') usedByUser += m.content.length
  }
  const nonUserMessages = messages.filter((m) => m.role !== 'user')
  const budgetForNonUser = Math.max(TOTAL_BUDGET - usedByUser, nonUserMessages.length * 200)
  const perNonUser = Math.floor(budgetForNonUser / Math.max(nonUserMessages.length, 1))

  const normalized = messages.map((m) => ({
    ...m,
    content: m.role === 'user' ? m.content : truncateContent(m.content, Math.max(perNonUser, 500)),
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

        // #1: 动态 maxTokens — L1 摘要需完整保留分类整理，L2 更简洁
        const maxTokens = level >= 2 ? 2048 : 4096

        let fullContent = ''

        const result = await client.askStream(
          {
            messages: chatMessages,
            temperature: 0.1, // #5: 适度随机性，避免固化句式
            maxTokens,
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
        if (e instanceof ConversationCompressionTimeoutError) {
          throw e
        }
        console.error('[SummaryProvider] summarizeBatch failed, fallback to simple summary', e)
        return fallback.summarizeBatch({ docPath, level, messages })
      }
    },
  }
}
