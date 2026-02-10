import { SimpleChat, MessageRole } from './SimpleChat'
import type { IStreamingChatClient, StreamingChatRequest, StreamingChatResult, ChatMessage } from '../domain/types'

export type DifyChatClientConfig = {
  apiKey: string
  baseUrl: string
  modelId: string
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
}

function toDifyMessages(messages: ChatMessage[]) {
  return messages.map((m) => ({
    role: m.role === 'user' ? MessageRole.User : MessageRole.Assistant,
    content: m.content,
  }))
}

export function createDifyStreamingClient(config: DifyChatClientConfig): IStreamingChatClient {
  const chat = new SimpleChat()

  chat.init({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    model: config.modelId,
    systemPrompt: config.systemPrompt,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
  })

  return {
    async askStream(request: StreamingChatRequest, handlers): Promise<StreamingChatResult> {
      const result = await chat.askStream(
        {
          messages: toDifyMessages(request.messages),
          temperature: request.temperature,
          maxTokens: request.maxTokens,
          signal: request.signal,
          attachments: request.attachments,
        },
        {
          enabled: true,
          onChunk: handlers.onChunk,
          onComplete: handlers.onComplete,
          onError: handlers.onError,
        },
      )

      return {
        content: result.content,
        tokenCount: result.tokenCount,
        completed: result.completed,
        error: result.error,
      }
    },
  }
}
