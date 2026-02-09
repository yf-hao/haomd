// Dify 专用简化 Chat 类，基于 web-chat/src/web/simple-chat.ts 复制并适配

import { BrowserLogger } from './BrowserLogger'

export const MessageRole = {
  User: 'user',
  Assistant: 'assistant',
} as const
export type MessageRole = typeof MessageRole[keyof typeof MessageRole]

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
const DifyEventType = {
  Message: 'message',
  TextChunk: 'text_chunk',
  MessageEnd: 'message_end',
  WorkflowFinished: 'workflow_finished',
} as const

interface DifySSEEvent {
  event: string
  task_id?: string
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
  private currentTaskId: string | null = null

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
  public async askStream(
    request: CompletionRequest & { signal?: AbortSignal },
    streamConfig: StreamConfig,
  ): Promise<StreamResult> {
    if (!this.config) {
      throw new Error('Config not initialized. Call init() first.')
    }

    this.logger.info('Starting stream request', {
      conversationId: this.conversationId || '(none)',
      messagesCount: request.messages.length,
    })

    const signal = request.signal
    this.currentTaskId = null

    const onAbort = async () => {
      const taskIdToStop = this.currentTaskId // 立即捕获，防止被 finally 块抹除
      this.logger.info('Abort event received in SimpleChat', {
        hasTaskId: !!taskIdToStop,
        taskId: taskIdToStop
      })

      if (taskIdToStop) {
        this.logger.info('Aborting Dify task on server', { taskId: taskIdToStop })
        try {
          await this.stopStream(taskIdToStop)
        } catch (e) {
          this.logger.error('Failed to stop Dify stream on server', { error: String(e) })
        }
      }
    }

    if (signal) {
      if (signal.aborted) {
        this.logger.warn('Signal already aborted before starting request')
        void onAbort()
      } else {
        signal.addEventListener('abort', onAbort)
        this.logger.info('Registered abort listener')
      }
    }

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

      this.logger.info('Sending fetch request', { url })
      const response = await this.fetchWithTimeout(url, body, signal)
      this.logger.info('Fetch response received', { status: response.status, ok: response.ok })

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
      try {
        this.logger.info('Starting reader loop')
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            this.logger.info('Stream reader reported done')
            break
          }

          const decoded = decoder.decode(value, { stream: true })
          this.logger.info('Raw chunk received', { size: decoded.length })

          buffer += decoded
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue

            this.logger.info('Processing line', { line: trimmed.slice(0, 100) + (trimmed.length > 100 ? '...' : '') })

            if (!trimmed.startsWith('data: ')) {
              this.logger.warn('Non-data line received', { line: trimmed })
              continue
            }

            const jsonStr = trimmed.slice(6)
            try {
              const event: DifySSEEvent = JSON.parse(jsonStr)
              this.logger.info('Event parsed', { event: event.event, taskId: event.task_id })

              // 提取 Conversation ID 和 Task ID
              if (event.conversation_id && !this.conversationId) {
                this.conversationId = event.conversation_id
              }
              if (event.task_id && !this.currentTaskId) {
                this.currentTaskId = event.task_id
                this.logger.info('Current Task ID set', { taskId: this.currentTaskId })
              }

              // 处理错误事件
              if (event.event === 'error') {
                this.logger.error('Dify stream error event', { data: event.data })
                throw new Error(`Dify error: ${event.data?.message || 'Unknown error'}`)
              }

              const chunk = this.convertToChunk(event)
              if (chunk?.content) {
                fullContent += chunk.content
                if (streamConfig.onChunk) {
                  streamConfig.onChunk(chunk)
                }
              }

              if (chunk?.finish_reason) {
                this.logger.info('Finish reason received', { reason: chunk.finish_reason })
                tokenCount = chunk.finish_reason === 'stop' ? fullContent.length : 0
              }
            } catch (e) {
              this.logger.error('Failed to parse XML/JSON from line', {
                line: trimmed.slice(0, 50),
                error: String(e)
              })
            }
          }
        }
      } catch (e) {
        const error = e as Error
        if (error.name === 'AbortError') {
          this.logger.info('Stream reader loop caught abort')
          return {
            content: fullContent,
            tokenCount: fullContent.length,
            completed: false,
          }
        }
        this.logger.error('Error during stream reading', { error: error.message })
        throw e
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
    } finally {
      if (signal) {
        signal.removeEventListener('abort', onAbort)
      }
      this.currentTaskId = null
    }
  }

  /**
   * 停止流式传输
   */
  public async stopStream(taskId: string): Promise<void> {
    if (!this.config) return
    const url = `${this.config.baseURL.replace(/\/+$/, '')}/chat-messages/${taskId}/stop`
    await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user: 'ai-settings-tester',
      }),
    })
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
  private async fetchWithTimeout(
    url: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Response> {
    return fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config?.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal,
    })
  }
}
