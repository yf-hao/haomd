import type { AiSettingsState, UiProvider } from '../../modules/ai/settings'
import { builtinPromptRoles } from '../../modules/ai/promptSettings'
import { createStreamingClientFromSettings } from '../../modules/ai/streamingClientFactory'
import type { ChatMessage } from '../../modules/ai/domain/types'
import type { WebLiteChatMessage, WebLiteChatSession } from '../domain/models'
import { generateWebSessionTitle } from './webSessionTitleService'

function getDefaultProvider(settings: AiSettingsState): UiProvider | null {
  const provider = settings.providers.find((item) => item.id === settings.defaultProviderId)
  if (!provider) return null
  const modelId = provider.defaultModelId ?? provider.models[0]?.id
  if (!provider.baseUrl.trim() || !provider.apiKey.trim() || !modelId) return null
  return {
    ...provider,
    defaultModelId: modelId,
  }
}

function toProviderMessages(messages: WebLiteChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }))
}

export async function sendWebChatMessage(options: {
  session: WebLiteChatSession
  input: string
  settings: AiSettingsState
  onAssistantChunk?: (content: string) => void
}): Promise<{ session: WebLiteChatSession; error?: string }> {
  const provider = getDefaultProvider(options.settings)
  if (!provider) {
    return {
      session: options.session,
      error: '请先在设置中配置默认 Provider / Model',
    }
  }

  const userContent = options.input.trim()
  if (!userContent) {
    return {
      session: options.session,
      error: '请输入消息内容',
    }
  }

  const now = Date.now()
  const userMessage: WebLiteChatMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    content: userContent,
    createdAt: now,
  }
  const assistantMessage: WebLiteChatMessage = {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: '',
    createdAt: now + 1,
  }

  let nextSession: WebLiteChatSession = {
    ...options.session,
    messages: [...options.session.messages, userMessage, assistantMessage],
    updatedAt: now + 1,
  }

  const client = createStreamingClientFromSettings(provider, builtinPromptRoles[0]?.prompt)
  const requestMessages = toProviderMessages([...options.session.messages, userMessage])

  const result = await client.askStream(
    {
      messages: requestMessages,
      temperature: 0.2,
      maxTokens: 1024,
    },
    {
      onChunk: (chunk) => {
        if (!chunk.content) return
        assistantMessage.content += chunk.content
        options.onAssistantChunk?.(assistantMessage.content)
      },
    },
  )

  if (!result.completed && !assistantMessage.content) {
    return {
      session: options.session,
      error: result.error?.message ?? '请求失败，请检查 Provider 配置',
    }
  }

  nextSession = {
    ...nextSession,
    messages: nextSession.messages.map((message) =>
      message.id === assistantMessage.id
        ? {
            ...assistantMessage,
            content: result.content || assistantMessage.content,
          }
        : message,
    ),
    updatedAt: Date.now(),
  }

  if ((options.session.title === '新对话' || !options.session.title.trim()) && options.session.messages.length === 0) {
    const title = await generateWebSessionTitle(userContent, provider)
    if (title) {
      nextSession = { ...nextSession, title }
    }
  }

  return { session: nextSession }
}
