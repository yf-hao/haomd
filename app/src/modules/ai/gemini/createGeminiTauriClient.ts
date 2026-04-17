import { invoke } from '@tauri-apps/api/core'
import type {
  ChatMessage,
  IStreamingChatClient,
  StreamingChatRequest,
  StreamingChatResult,
} from '../domain/types'

type GeminiGenerateContentResponse = {
  content: string
}

export type GeminiTauriClientConfig = {
  apiKey: string
  baseUrl: string
  modelId: string
  systemPrompt?: string
}

type GeminiCompatMessageInput = {
  role: 'user' | 'assistant'
  content: string
}

function mapMessages(messages: ChatMessage[]): GeminiCompatMessageInput[] {
  return messages
    .filter(
      (message): message is ChatMessage & { role: 'user' | 'assistant' } =>
        message.role === 'user' || message.role === 'assistant',
    )
    .map((message) => ({
      role: message.role,
      content: message.content,
    }))
}

export function createGeminiTauriClient(
  config: GeminiTauriClientConfig,
): IStreamingChatClient {
  return {
    async askStream(request: StreamingChatRequest, handlers): Promise<StreamingChatResult> {
      if (request.signal?.aborted) {
        return {
          content: '',
          tokenCount: 0,
          completed: false,
        }
      }

      try {
        const response = await invoke<GeminiGenerateContentResponse>(
          'gemini_generate_content',
          {
            request: {
              apiKey: config.apiKey,
              baseUrl: config.baseUrl,
              modelId: config.modelId,
              systemPrompt: config.systemPrompt,
              messages: mapMessages(request.messages),
            },
          },
        )

        const content = response.content ?? ''

        if (content && handlers.onChunk) {
          handlers.onChunk({ content })
        }

        if (handlers.onComplete) {
          handlers.onComplete(content, content.length)
        }

        return {
          content,
          tokenCount: content.length,
          completed: true,
        }
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e))
        if (handlers.onError) handlers.onError(error)
        return {
          content: '',
          tokenCount: 0,
          completed: false,
          error,
        }
      }
    },
  }
}
