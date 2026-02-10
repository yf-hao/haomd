import { createOpenAIStreamingClient } from '../openai/createOpenAIStreamingClient'
import type { UiProvider } from '../domain/types'
import type { IImageUrlResolver } from '../../images/imageUrlResolver'
import { ModelScopeVisionClient } from './ModelScopeVisionClient'

/**
 * 从 UiProvider 配置创建一个 ModelScopeVisionClient：
 * - 依赖现有的 OpenAI 兼容流式客户端
 * - 使用外部注入的 IImageUrlResolver 处理图片来源
 */
export function createModelScopeVisionClient(
  provider: UiProvider,
  imageUrlResolver: IImageUrlResolver,
  modelIdOverride?: string,
) {
  const baseUrl = provider.baseUrl.trim()
  const apiKey = provider.apiKey.trim()
  const modelId = modelIdOverride || provider.defaultModelId || provider.models[0]?.id || ''

  const streamingClient = createOpenAIStreamingClient({
    apiKey,
    baseUrl,
    modelId,
    temperature: 0,
    maxTokens: 512,
  })

  return new ModelScopeVisionClient(streamingClient, imageUrlResolver)
}
