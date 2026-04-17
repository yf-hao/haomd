import type { AgentProvider } from '../../domain/types'

export type ImageGenerationAgentProvider = {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  platform: 'modelscope_image' | 'other'
  modelId: string
  defaultAspectRatio?: string
}

export type ImageGenerationRequest = {
  prompt: string
  aspectRatio?: string
}

export type ImageGenerationTaskStatus = 'idle' | 'running' | 'succeeded' | 'failed'

export type ImageGenerationResult = {
  taskId: string
  imageUrl: string
  raw?: unknown
}

export function isImageGenerationAgent(provider: AgentProvider): boolean {
  return provider.kind === 'image_generation'
}
