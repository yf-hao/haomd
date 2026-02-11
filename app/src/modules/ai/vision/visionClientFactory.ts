import type { UiProvider } from '../domain/types'
import type { IVisionClient } from './visionClient'
import { defaultImageUrlResolver } from '../../images/defaultImageUrlResolver'
import { createModelScopeVisionClient } from '../modelscope/createModelScopeVisionClient'

/**
 * 根据 UiProvider 的配置创建对应的 VisionClient。
 * 当前实现：
 * - visionMode = 'enabled' 时，使用 ModelScope/OpenAI 兼容的 image_url 适配器
 * - 其他情况返回 null，表示该 Provider 不支持 Vision
 */
function isLikelyVisionModelId(modelId: string | undefined): boolean {
  if (!modelId) return false
  const id = modelId.toLowerCase()

  const keywords = [
    'qwen-vl',
    'qwen2-vl',
    'qwen3-vl',
    '/qvq',
    'qvq-',
    'vision',
    'glm-4v',
    'glm-4v-9b',
    'gpt-4o',
    'gpt-4.1-mini',
    'k2.5-v',
    'kimi-k2',
  ]

  return keywords.some((k) => id.includes(k))
}

export function createVisionClientFromProvider(provider: UiProvider, activeModelId?: string): IVisionClient | null {
  const activeModel = activeModelId ? provider.models.find((m) => m.id === activeModelId) : undefined
  const modelVisionMode = activeModel?.visionMode

  // 0. 模型级配置优先：显式声明的 visionMode 覆盖 Provider 默认和自动检测
  if (modelVisionMode === 'none') {
    return null
  }
  if (modelVisionMode === 'enabled') {
    return createModelScopeVisionClient(provider, defaultImageUrlResolver, activeModelId)
  }

  // 1. Provider 级显式配置：只要不是 'auto' / undefined，就按配置走
  if (provider.visionMode === 'none') {
    return null
  }
  if (provider.visionMode === 'enabled') {
    return createModelScopeVisionClient(provider, defaultImageUrlResolver, activeModelId)
  }

  // 2. 未配置或设置为自动时，根据 Provider 类型 + 模型名自动推断
  // 目前仅对 OpenAI 兼容 Provider 启用自动检测，避免误伤 Dify 等聚合服务
  if (provider.providerType !== 'openai') {
    return null
  }

  const candidateIds = new Set<string>()
  if (activeModelId) candidateIds.add(activeModelId)
  if (provider.defaultModelId) candidateIds.add(provider.defaultModelId)
  for (const m of provider.models) {
    candidateIds.add(m.id)
  }

  const supportsOpenAiImageUrl = Array.from(candidateIds).some((id) => isLikelyVisionModelId(id))

  if (supportsOpenAiImageUrl) {
    // 自动检测命中时，按 enabled 模式创建 VisionClient（不写回配置，只在运行时生效）
    return createModelScopeVisionClient(provider, defaultImageUrlResolver, activeModelId)
  }

  return null
}
