import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type {
  IStreamingChatClient,
  StreamingChatRequest,
  StreamingChatResult,
  ToolCallRequest,
} from '../domain/types'

type OpenAICompatToolFunction = {
  name: string
  arguments: string
}

type OpenAICompatToolCall = {
  id: string
  function: OpenAICompatToolFunction
}

type OpenAICompatMessageInput = {
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: ToolCallRequest[]
  toolCallId?: string
}

type OpenAICompatChunkEventPayload = {
  requestId: string
  content: string
}

type OpenAICompatDoneEventPayload = {
  requestId: string
  content: string
  toolCalls?: OpenAICompatToolCall[]
}

type OpenAICompatErrorEventPayload = {
  requestId: string
  message: string
}

export type OpenAICompatTauriClientConfig = {
  apiKey: string
  baseUrl: string
  modelId: string
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
}

function mapMessages(request: StreamingChatRequest): OpenAICompatMessageInput[] {
  return request.messages.map((message) => ({
    role: message.role,
    content: message.content,
    toolCalls: message.tool_calls,
    toolCallId: message.tool_call_id,
  }))
}

function mapToolCalls(toolCalls?: OpenAICompatToolCall[]): ToolCallRequest[] | undefined {
  if (!toolCalls?.length) return undefined
  return toolCalls.map((toolCall) => ({
    id: toolCall.id,
    function: {
      name: toolCall.function.name,
      arguments: toolCall.function.arguments,
    },
  }))
}

function genRequestId(): string {
  return `openai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function createOpenAICompatTauriClient(
  config: OpenAICompatTauriClientConfig,
): IStreamingChatClient {
  return {
    async askStream(request: StreamingChatRequest, handlers): Promise<StreamingChatResult> {
      const requestId = genRequestId()
      let fullContent = ''
      let resolved = false
      let cleanupDone = false
      let currentToolCalls: ToolCallRequest[] | undefined

      const cleanupTasks: Array<() => void | Promise<void>> = []
      const cleanup = async () => {
        if (cleanupDone) return
        cleanupDone = true
        await Promise.all(
          cleanupTasks.map(async (task) => {
            try {
              await task()
            } catch {
              // ignore listener cleanup errors
            }
          }),
        )
      }

      const finish = async (result: StreamingChatResult) => {
        if (resolved) return result
        resolved = true
        await cleanup()
        return result
      }

      const abortHandler = async () => {
        try {
          await invoke('cancel_openai_compat_chat_stream', { requestId })
        } catch {
          // ignore cancellation bridge errors
        }
      }

      if (request.signal) {
        if (request.signal.aborted) {
          await abortHandler()
          return finish({ content: '', tokenCount: 0, completed: false })
        }
        const listener = () => {
          void abortHandler()
        }
        request.signal.addEventListener('abort', listener, { once: true })
        cleanupTasks.push(() => request.signal?.removeEventListener('abort', listener))
      }

      const unlistenChunk = await listen<OpenAICompatChunkEventPayload>('openai://compat_chunk', (event) => {
        if (event.payload.requestId !== requestId) return
        if (!event.payload.content) return
        fullContent += event.payload.content
        if (handlers.onChunk) {
          handlers.onChunk({ content: event.payload.content })
        }
      })
      cleanupTasks.push(unlistenChunk)

      const chunkDonePromise = new Promise<StreamingChatResult>((resolve) => {
        void listen<OpenAICompatDoneEventPayload>('openai://compat_done', async (event) => {
          if (event.payload.requestId !== requestId || resolved) return
          currentToolCalls = mapToolCalls(event.payload.toolCalls)
          if (handlers.onComplete) {
            handlers.onComplete(event.payload.content, event.payload.content.length)
          }
          resolve(
            await finish({
              content: event.payload.content,
              tokenCount: event.payload.content.length,
              completed: true,
              toolCalls: currentToolCalls,
            }),
          )
        }).then((unlisten) => {
          cleanupTasks.push(unlisten)
        })
      })

      const errorPromise = new Promise<StreamingChatResult>((resolve) => {
        void listen<OpenAICompatErrorEventPayload>('openai://compat_error', async (event) => {
          if (event.payload.requestId !== requestId || resolved) return
          if (event.payload.message === '请求已取消') {
            resolve(
              await finish({
                content: fullContent,
                tokenCount: fullContent.length,
                completed: false,
                toolCalls: currentToolCalls,
              }),
            )
            return
          }
          const error = new Error(event.payload.message)
          if (handlers.onError) handlers.onError(error)
          resolve(
            await finish({
              content: fullContent,
              tokenCount: fullContent.length,
              completed: false,
              error,
              toolCalls: currentToolCalls,
            }),
          )
        }).then((unlisten) => {
          cleanupTasks.push(unlisten)
        })
      })

      try {
        await invoke('start_openai_compat_chat_stream', {
          requestId,
          request: {
            apiKey: config.apiKey,
            baseUrl: config.baseUrl,
            modelId: config.modelId,
            systemPrompt: config.systemPrompt,
            temperature: request.temperature ?? config.temperature ?? 0,
            maxTokens: request.maxTokens ?? config.maxTokens,
            messages: mapMessages(request),
            tools: request.tools,
          },
        })
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e))
        if (handlers.onError) handlers.onError(error)
        return finish({
          content: '',
          tokenCount: 0,
          completed: false,
          error,
        })
      }

      return Promise.race([chunkDonePromise, errorPromise])
    },
  }
}
