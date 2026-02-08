// 领域层类型定义：不包含任何 IO 或具体 Provider 细节

// Provider & AI Settings
export type UiProviderModel = {
  id: string
  /** 每个模型单独可配置的最大回复 token 数 */
  maxTokens?: number
}

/** Provider 协议类型，目前支持 Dify 与 OpenAI 兼容接口 */
export type ProviderType = 'dify' | 'openai'

export type UiProvider = {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  models: UiProviderModel[]
  defaultModelId?: string
  description?: string
  /** Provider 类型，例如 'dify' | 'openai' 等，缺省视为 'dify' */
  providerType?: ProviderType
}

export type AiSettingsState = {
  providers: UiProvider[]
  defaultProviderId?: string
}

export const emptySettings: AiSettingsState = {
  providers: [],
  defaultProviderId: undefined,
}

export type DefaultChatConfig = {
  baseUrl: string
  apiKey: string
  model: string
}

// Prompt Settings
export type PromptRole = {
  id: string
  name: string
  description?: string
  prompt: string
}

export type PromptSettingsState = {
  roles: PromptRole[]
  defaultRoleId?: string
}

export const emptyPromptSettings: PromptSettingsState = {
  roles: [],
  defaultRoleId: undefined,
}

// AI 客户端通用响应与接口
export type AiResponse = {
  ok: boolean
  message: string
  config?: DefaultChatConfig | null
}

export interface IAiClient {
  /** 打开通用对话入口，例如 “AI Chat”。 */
  openChat(): Promise<AiResponse>
  /** 针对当前文件发起提问。 */
  askAboutFile(): Promise<AiResponse>
  /** 针对当前选中内容发起提问。 */
  askAboutSelection(): Promise<AiResponse>
}

// 通用流式聊天接口（用于 Provider 适配，比如 Dify / OpenAI 等）
export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type StreamingChatRequest = {
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
}

export type StreamingChatResult = {
  content: string
  tokenCount: number
  completed: boolean
  error?: Error
}

export interface IStreamingChatClient {
  askStream(
    request: StreamingChatRequest,
    handlers: {
      onChunk?: (chunk: { content?: string }) => void
      onComplete?: (content: string, tokenCount: number) => void
      onError?: (error: Error) => void
    },
  ): Promise<StreamingChatResult>
}
