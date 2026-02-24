import type { ChatMessageView } from '../domain/chatSession'
import type { ChatMessage, UiProvider, AiSettingsState } from '../domain/types'
import { loadAiSettingsState } from '../settings'
import { createStreamingClientFromSettings } from '../streamingClientFactory'

function pickDefaultProvider(state: AiSettingsState): UiProvider | null {
  if (!state.providers.length) {
    console.warn('[ChatAutoDigest] no providers configured, skip auto digest')
    return null
  }
  const byDefault = state.providers.find((p) => p.id === state.defaultProviderId)
  return byDefault ?? state.providers[0]!
}

function buildAutoDigestSystemPrompt(): string {
  return [
    '你是一个“用户全局记忆（Global Memory）整理助手”。',
    '',
    '你的任务是：',
    '- 阅读一段用户和 AI 助手围绕某个文档的对话记录；',
    '- 只提取那些“对未来任何新文档都可能有用”的长期信息，用于优化以后的 AI 对话体验；',
    '- 将这些信息整理成结构化的、简短的“用户记忆摘要”。',
    '',
    '注意：你不是在写本次文档的总结报告，而是在给“未来帮用户写任何文档的 AI”写一份“使用说明书更新”。',
  ].join('\n')
}

function buildConversationMessagesBlock(messages: ChatMessageView[]): string {
  const lines: string[] = []
  for (const msg of messages) {
    const roleLabel = msg.role === 'user' ? '用户' : '助手'
    const content = msg.content.trim()
    if (!content) continue
    lines.push(`- [${roleLabel}] ${content}`)
  }
  return lines.join('\n')
}

function buildAutoDigestUserPrompt(input: { docPath: string; messages: ChatMessageView[] }): string {
  const { docPath, messages } = input
  const conversationMessages = buildConversationMessagesBlock(messages)

  const lines: string[] = []
  lines.push(`下面是一段用户与 AI 助手的对话记录，关联的文档路径为：${docPath}。`)
  lines.push('')
  lines.push('【对话开始】')
  lines.push(conversationMessages)
  lines.push('【对话结束】')
  lines.push('')
  lines.push('其中对话格式为多行文本，例如：')
  lines.push('- [用户] ...')
  lines.push('- [助手] ...')
  lines.push('')
  lines.push('请基于这些对话，生成一份“面向未来新文档对话场景”的全局记忆摘要，用于更新用户画像和工作偏好。请严格遵守以下要求：')
  lines.push('')
  lines.push('1. 只关注“跨文档可复用的”长期信息，优先包括但不限于：')
  lines.push('   - 用户的目标与长期方向（例如：希望产出什么类型的内容、研究方向、写作目标等）；')
  lines.push('   - 用户的工作流与协作方式（例如：喜欢先出大纲再细化、偏好分阶段迭代、喜欢你先问问题再给方案等）；')
  lines.push('   - 用户对 AI 行为的偏好和禁忌（例如：回答要简洁 / 要详细、不要废话、不要自动改写格式、需要中文回答等）；')
  lines.push('   - 用户的内容和风格偏好（例如：更偏工程实现细节 / 更偏概念解释、喜欢表格 / 列表 / 分节结构等）；')
  lines.push('   - 用户对工具、模型、参数的偏好（例如：偏好某个模型、temperature 较低、喜欢先跑 lint 再改代码等）；')
  lines.push('   - 用户对项目/代码库的一般性约定（例如：命名风格、错误处理策略、测试约定、性能优先级等）。')
  lines.push('')
  lines.push('2. 有意识地“过滤掉”以下内容：')
  lines.push('   - 只对当前这一个文档有效、未来很难复用的具体事实和细节；')
  lines.push('   - 一次性的临时状态；')
  lines.push('   - 对未来新文档帮助不大的原始问答细节。')
  lines.push('')
  lines.push('3. 在表达上：')
  lines.push('   - 使用简体中文；')
  lines.push('   - 使用简洁的分条或小段落描述，便于后续模型直接读入；')
  lines.push('   - 不要编造对话中没有出现的偏好或设定，如果不确定就写“暂无信息”或省略该点；')
  lines.push('   - 当信息有冲突时，以最近一次明确的表述为准，并在总结中采用用户最新的要求。')
  lines.push('')
  lines.push('4. 请按照下面结构化格式输出（如果某一部分没有信息，可以写“暂无信息”）：')
  lines.push('')
  lines.push('- 用户长期目标与关注点：')
  lines.push('  - …')
  lines.push('')
  lines.push('- 用户在新文档协作中的工作方式（workflow）：')
  lines.push('  - …')
  lines.push('')
  lines.push('- 用户对 AI 回答的风格和格式偏好：')
  lines.push('  - …')
  lines.push('')
  lines.push('- 用户对模型 / 参数 / 工具的偏好与约束：')
  lines.push('  - …')
  lines.push('')
  lines.push('- 适用于未来文档的一般性约定（代码风格、架构倾向、性能/可读性权衡等）：')
  lines.push('  - …')
  lines.push('')
  lines.push('- 需要特别避免的行为或雷区：')
  lines.push('  - …')
  lines.push('')
  lines.push('请只输出上述结构化摘要，不要额外加解释性前言或后记。')

  return lines.join('\n')
}

export async function buildAutoDigestSummaryForCurrentChat(input: {
  docPath: string
  messages: ChatMessageView[]
}): Promise<string> {
  const { docPath, messages } = input

  const visibleMessages = messages.filter((m) => m.content && m.content.trim())
  if (!visibleMessages.length) {
    return ''
  }

  const aiState = await loadAiSettingsState()
  const provider = pickDefaultProvider(aiState)
  if (!provider) {
    return ''
  }

  const systemPrompt = buildAutoDigestSystemPrompt()
  const modelId = provider.defaultModelId ?? provider.models[0]?.id ?? ''
  if (!modelId) {
    console.warn('[ChatAutoDigest] provider has no model id, skip auto digest')
    return ''
  }

  const client = createStreamingClientFromSettings(provider, systemPrompt, modelId)

  const userContent = buildAutoDigestUserPrompt({ docPath, messages: visibleMessages })

  const chatMessages: ChatMessage[] = [
    {
      role: 'user',
      content: userContent,
    },
  ]

  let fullContent = ''

  try {
    const result = await client.askStream(
      {
        messages: chatMessages,
        temperature: 0,
        maxTokens: 800,
      },
      {
        onChunk: (chunk) => {
          if (chunk.content) {
            fullContent += chunk.content
          }
        },
        onComplete: () => {
          // no-op
        },
        onError: (err) => {
          console.error('[ChatAutoDigest] streaming error', err)
        },
      },
    )

    const raw = (fullContent || result.content || '').trim()
    return raw
  } catch (e) {
    console.error('[ChatAutoDigest] buildAutoDigestSummaryForCurrentChat failed', e)
    throw e
  }
}
