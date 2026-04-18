import type { UiProvider } from './settings'
import type { IStreamingChatClient } from './domain/types'
import { createDifyStreamingClient } from './dify/createDifyStreamingClient'
import { createGeminiTauriClient } from './gemini/createGeminiTauriClient'
import { createOpenAIStreamingClient } from './openai/createOpenAIStreamingClient'

/**
 * 根据 UiProvider 的配置与类型创建对应的流式聊天客户端。
 * 当 providerType 为空或为 'dify' 时使用 Dify；为 'openai' 时使用 OpenAI 兼容接口。
 * 可选的 systemPrompt 会传递给底层 Provider，用于设置系统提示词。
 */
export function createStreamingClientFromSettings(
  provider: UiProvider,
  systemPrompt?: string,
  overrideModelId?: string,
  initialConversationId?: string,
): IStreamingChatClient {
  const baseUrl = provider.baseUrl.trim()
  const apiKey = provider.apiKey.trim()
  const modelId = overrideModelId || provider.defaultModelId || provider.models[0]?.id || ''
  const modelMaxTokens = provider.models.find((model) => model.id === modelId)?.maxTokens
  const providerType = provider.providerType ?? 'dify'

  if (!baseUrl || !apiKey || !modelId) {
    throw new Error('Provider 配置不完整：缺少 Base URL / API Key / Model')
  }

  switch (providerType) {
    case 'gemini':
      return createGeminiTauriClient({
        apiKey,
        baseUrl,
        modelId,
        systemPrompt,
        geminiThinkingLevel: provider.geminiThinkingLevel,
      })
    case 'openai':
      return createOpenAIStreamingClient({
        apiKey,
        baseUrl,
        modelId,
        systemPrompt,
        maxTokens: modelMaxTokens,
      })
    case 'dify':
    default:
      return createDifyStreamingClient({
        apiKey,
        baseUrl,
        modelId,
        systemPrompt,
        temperature: 0,
        maxTokens: modelMaxTokens,
        omitModelInput: provider.omitDifyModelInput,
        initialConversationId,
      })
  }
}
