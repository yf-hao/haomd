import { loadAgentSettingsState } from '../../config/agentSettingsRepo'
import type { AgentProvider } from '../../domain/types'
import { runModelscopeImageGeneration } from './modelscopeImageGenerationClient'
import type {
  ImageGenerationAgentProvider,
  ImageGenerationRequest,
  ImageGenerationResult,
} from './types'

export function toImageGenerationAgentProvider(agent: AgentProvider): ImageGenerationAgentProvider {
  if (agent.kind !== 'image_generation') {
    throw new Error('当前 Agent 不是图片生成类型')
  }
  if (agent.platform !== 'modelscope_image') {
    throw new Error(`当前暂不支持 ${agent.platform} 图片生成 Agent`)
  }
  if (!agent.baseUrl.trim()) {
    throw new Error('缺少图片生成 Base URL')
  }
  if (!agent.apiKey.trim()) {
    throw new Error('缺少图片生成 API Key')
  }
  if (!agent.modelId?.trim()) {
    throw new Error('缺少图片生成模型 ID')
  }

  return {
    id: agent.id,
    name: agent.name,
    baseUrl: agent.baseUrl.trim(),
    apiKey: agent.apiKey.trim(),
    platform: agent.platform,
    modelId: agent.modelId.trim(),
    defaultAspectRatio: agent.defaultAspectRatio?.trim() || undefined,
  }
}

export async function loadImageGenerationAgents(): Promise<AgentProvider[]> {
  const settings = await loadAgentSettingsState()
  return settings.providers.filter((provider) => provider.kind === 'image_generation')
}

export async function runImageGenerationWithAgent(
  agent: AgentProvider,
  request: ImageGenerationRequest,
): Promise<ImageGenerationResult> {
  const latestAgents = await loadImageGenerationAgents()
  const latestAgent = latestAgents.find((item) => item.id === agent.id) ?? agent
  const provider = toImageGenerationAgentProvider(latestAgent)
  return runModelscopeImageGeneration(provider, {
    ...request,
    aspectRatio: request.aspectRatio ?? provider.defaultAspectRatio,
  })
}
