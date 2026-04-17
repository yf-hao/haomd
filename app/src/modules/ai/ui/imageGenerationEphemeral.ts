export type AiChatAgentMode = 'chat' | 'image_generation'

export type EphemeralImageGenerationPromptMessage = {
  id: string
  type: 'image_generation_prompt'
  content: string
}

export type EphemeralImageGenerationResultMessage = {
  id: string
  type: 'image_generation_result'
  prompt: string
  agentId: string
  agentName: string
  status: 'running' | 'succeeded' | 'failed'
  imageUrl?: string
  taskId?: string
  errorMessage?: string
}

export type EphemeralAiChatMessage =
  | EphemeralImageGenerationPromptMessage
  | EphemeralImageGenerationResultMessage

export function createEphemeralId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}
