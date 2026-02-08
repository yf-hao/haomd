// Dify 专用简化 Chat 类，基于 web-chat/src/web/simple-chat.ts 复制并适配

import { BrowserLogger } from './BrowserLogger'

export enum MessageRole {
  User = 'user',
  Assistant = 'assistant',
}

export interface ChatMessage {
  role: MessageRole
  content: string
}

export interface ChatConfig {
  apiKey: string
  baseURL: string
  model: string
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
}

export interface StreamConfig {
  enabled: boolean
  onChunk?: (chunk: { content?: string }) => void
  onComplete?: (content: string, tokenCount: number) => void
  onError?: (error: Error) => void
}

export interface StreamResult {
  content: string
  tokenCount: number
  completed: boolean
  error?: Error
}

export interface CompletionRequest {
  messages: ChatMessage[]
  conversationId?: string
  temperature?: number
  maxTokens?: number
}

// Dify SSE 事件类型
enum DifyEventType {
  Message = 'message',
  TextChunk = 'text_chunk',
  MessageEnd = 'message_end',
  WorkflowFinished = 'workflow_finished',
}

interface DifySSEEvent {
  event: string
  answer?: string
  data?: {
    text?: string
    answer?: string
    [key: string]: unknown
  }
  conversation_id?: string
}

interface StreamChunk {
  content?: string
  finish_reason?: string
}

export class SimpleChat {
  private logger: BrowserLogger
  private config: ChatConfig | null = null
  private conversationId: string | null = null

  constructor() {
    this.logger = new BrowserLogger()
  }

  /**
   * 初始化配置
   */
  public init(config: ChatConfig): void {
    this.config = config
    this.logger.info('Initializing chat', {
      model: config.model,
      baseURL: config.baseURL,
    })

    this.conversationId = null
  }

  /**
   * 发送流式消息
   */
  public async askStream(request: CompletionRequest, streamConfig: StreamConfig): Promise<StreamResult> {
    if (!this.config) {
      throw new Error('Config not initialized. Call init() first.')
    }

    this.logger.info('Starting stream request', {
      conversationId: this.conversationId || '(none)',
      messagesCount: request.messages.length,
    })

    try {
      const query = this.getLastUserMessage(request)
      const url = `${this.config.baseURL.replace(/\/+$/, '')}/chat-messages`
      const body = this.buildRequestBody(
        query,
        'streaming',
        this.conversationId || undefined,
        request.temperature,
        request.maxTokens,
      )

      const response = await this.fetchWithTimeout(url, body)

      if (!response.ok || !response.body) {
        const errorText = await response.text()
        throw new Error(`Dify API error (${response.status}): ${errorText}`)
      }

      let fullContent = ''
      let tokenCount = 0
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      // 处理流
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue

          const jsonStr = trimmed.slice(6)
          try {
            const event: DifySSEEvent = JSON.parse(jsonStr)

            // 提取 Conversation ID
            if (event.conversation_id && !this.conversationId) {
              this.conversationId = event.conversation_id
              this.logger.info('Conversation ID updated', { conversationId: this.conversationId })
            }

            const chunk = this.convertToChunk(event)
            if (chunk?.content) {
              fullContent += chunk.content
              if (streamConfig.onChunk) {
                streamConfig.onChunk(chunk)
              }
            }

            if (chunk?.finish_reason) {
              tokenCount = chunk.finish_reason === 'stop' ? fullContent.length : 0
            }
          } catch {
            // 忽略解析错误
          }
        }
      }

      if (streamConfig.onComplete) {
        streamConfig.onComplete(fullContent, tokenCount)
      }

      return {
        content: fullContent,
        tokenCount,
        completed: true,
        error: undefined,
      }
    } catch (error) {
      this.logger.error('Stream request failed', {
        error: error instanceof Error ? error.message : String(error),
      })

      if (streamConfig.onError) {
        streamConfig.onError(error as Error)
      }

      return {
        content: '',
        tokenCount: 0,
        completed: false,
        error: error as Error,
      }
    }
  }

  /** 清除历史 */
  public clearHistory(): void {
    this.conversationId = null
    this.logger.info('History cleared')
  }

  /** 获取当前配置 */
  public getConfig(): ChatConfig | null {
    return this.config
  }

  /** 获取最后一条用户消息 */
  private getLastUserMessage(request: CompletionRequest): string {
    const last = request.messages[request.messages.length - 1]
    if (!last || last.role !== MessageRole.User) {
      throw new Error('Last message must be from user')
    }
    return typeof last.content === 'string' ? last.content : ''
  }

  /** 构建请求体 */
  private buildRequestBody(
    query: string,
    mode: 'blocking' | 'streaming',
    conversationId?: string,
    temperature?: number,
    maxTokens?: number,
  ) {
    const body: Record<string, unknown> = {
      inputs: {
        system: this.config?.systemPrompt || '',
        model: this.config?.model,
      },
      query,
      response_mode: mode,
      user: 'ai-settings-tester',
      conversation_id: conversationId || '',
    }

    if (temperature !== undefined) {
      body.temperature = temperature
    }
    if (maxTokens !== undefined) {
      body.max_tokens = maxTokens
    }

    return body
  }

  /** 将 Dify 事件转换为内部 Chunk */
  private convertToChunk(event: DifySSEEvent): StreamChunk | null {
    switch (event.event) {
      case DifyEventType.Message:
        return { content: event.answer || event.data?.answer || '' }
      case DifyEventType.TextChunk:
        return { content: event.data?.text || '' }
      case DifyEventType.MessageEnd:
      case DifyEventType.WorkflowFinished:
        return { content: '', finish_reason: 'stop' }
      default:
        return null
    }
  }

  /** 实际发起 fetch 请求 */
  // 可根据需要扩展超时控制
  private async fetchWithTimeout(url: string, body: Record<string, unknown>): Promise<Response> {
    return fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config?.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  }
}
