import type { IStreamingChatClient, StreamingChatRequest, StreamingChatResult, ToolCallRequest } from '../domain/types'
import { isTauriEnv } from '../../platform/runtime'
import { createOpenAICompatTauriClient } from './openaiCompatTauriClient'

export type OpenAIChatClientConfig = {
  apiKey: string
  baseUrl: string
  modelId: string
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
}

type CompletionTransportMode = 'stream' | 'non-stream'
type MaxTokenParamMode = 'max_tokens' | 'max_completion_tokens'

class OpenAICompatRequestError extends Error {
  status?: number
  responseText?: string
  transportMode: CompletionTransportMode
  tokenParamMode: MaxTokenParamMode

  constructor(
    message: string,
    transportMode: CompletionTransportMode,
    tokenParamMode: MaxTokenParamMode,
    status?: number,
    responseText?: string,
  ) {
    super(message)
    this.name = 'OpenAICompatRequestError'
    this.status = status
    this.responseText = responseText
    this.transportMode = transportMode
    this.tokenParamMode = tokenParamMode
  }
}

function buildCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  if (/\/(v\d+|beta)$/.test(trimmed)) {
    return `${trimmed}/chat/completions`
  }
  return `${trimmed}/v1/chat/completions`
}

function buildRequestMessages(config: OpenAIChatClientConfig, request: StreamingChatRequest) {
  return [
    ...(config.systemPrompt ? [{ role: 'system', content: config.systemPrompt }] : []),
    ...request.messages.map((m) => {
      if (m.role === 'tool') {
        return { role: 'tool', content: m.content, tool_call_id: m.tool_call_id }
      }
      if (m.role === 'assistant' && m.tool_calls?.length) {
        return {
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.tool_calls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        }
      }
      return { role: m.role, content: m.content }
    }),
  ]
}

function buildCompletionBody(
  config: OpenAIChatClientConfig,
  request: StreamingChatRequest,
  transportMode: CompletionTransportMode,
  tokenParamMode: MaxTokenParamMode,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any = {
    model: config.modelId,
    messages: buildRequestMessages(config, request),
    temperature: request.temperature ?? config.temperature ?? 0,
    stream: transportMode === 'stream',
  }

  const maxTokens = request.maxTokens ?? config.maxTokens
  if (typeof maxTokens === 'number') {
    body[tokenParamMode] = maxTokens
  }

  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools
    body.tool_choice = 'auto'
  }

  return body
}

async function readResponseText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

function buildHttpError(
  response: Response,
  responseText: string,
  transportMode: CompletionTransportMode,
  tokenParamMode: MaxTokenParamMode,
): OpenAICompatRequestError {
  return new OpenAICompatRequestError(
    `OpenAI API error (${response.status}): ${responseText || 'Empty response body'}`,
    transportMode,
    tokenParamMode,
    response.status,
    responseText,
  )
}

function buildRetryPlan(error: unknown): Array<{ transportMode: CompletionTransportMode; tokenParamMode: MaxTokenParamMode }> {
  if (!(error instanceof OpenAICompatRequestError)) {
    return []
  }
  if (error.status === 401 || error.status === 403 || error.status === 404) {
    return []
  }

  const responseText = `${error.responseText || ''} ${error.message}`.toLowerCase()
  const looksLikeMaxTokensIssue =
    responseText.includes('max_tokens') ||
    responseText.includes('max completion tokens') ||
    responseText.includes('max_completion_tokens')

  const candidates: Array<{ transportMode: CompletionTransportMode; tokenParamMode: MaxTokenParamMode }> = []

  if (looksLikeMaxTokensIssue) {
    if (error.tokenParamMode === 'max_tokens') {
      candidates.push({ transportMode: error.transportMode, tokenParamMode: 'max_completion_tokens' })
      if (error.transportMode === 'stream') {
        candidates.push({ transportMode: 'non-stream', tokenParamMode: 'max_completion_tokens' })
      }
      return candidates
    }
    if (error.transportMode === 'stream') {
      candidates.push({ transportMode: 'non-stream', tokenParamMode: error.tokenParamMode })
    }
    return candidates
  }

  if (error.transportMode === 'stream') {
    candidates.push({ transportMode: 'non-stream', tokenParamMode: error.tokenParamMode })
  }

  if (error.tokenParamMode === 'max_tokens') {
    candidates.push({ transportMode: error.transportMode, tokenParamMode: 'max_completion_tokens' })
    if (error.transportMode === 'stream') {
      candidates.push({ transportMode: 'non-stream', tokenParamMode: 'max_completion_tokens' })
    }
  }

  return candidates
}

function parseToolCalls(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawToolCalls: any[] | undefined,
): ToolCallRequest[] | undefined {
  if (!rawToolCalls?.length) return undefined
  const toolCalls = rawToolCalls
    .map((tc) => {
      const name = tc?.function?.name
      const args = tc?.function?.arguments
      if (!name || typeof args !== 'string') return null
      return {
        id: tc.id ?? '',
        function: { name, arguments: args },
      }
    })
    .filter((item): item is ToolCallRequest => !!item)
  return toolCalls.length > 0 ? toolCalls : undefined
}

async function sendCompletionRequest(
  url: string,
  config: OpenAIChatClientConfig,
  request: StreamingChatRequest,
  handlers: Parameters<IStreamingChatClient['askStream']>[1],
  transportMode: CompletionTransportMode,
  tokenParamMode: MaxTokenParamMode,
): Promise<StreamingChatResult> {
  const body = buildCompletionBody(config, request, transportMode, tokenParamMode)
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: request.signal,
  })

  if (!response.ok) {
    const text = await readResponseText(response)
    throw buildHttpError(response, text, transportMode, tokenParamMode)
  }

  if (transportMode === 'non-stream') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = await response.json() as any
    const message = json?.choices?.[0]?.message
    const content = typeof message?.content === 'string'
      ? message.content
      : Array.isArray(message?.content)
        ? message.content.map((part: { text?: string }) => part?.text ?? '').join('')
        : ''
    const toolCalls = parseToolCalls(message?.tool_calls)

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
      error: undefined,
      toolCalls,
    }
  }

  if (!response.body) {
    throw new OpenAICompatRequestError(
      'OpenAI API returned no stream body',
      transportMode,
      tokenParamMode,
    )
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let fullContent = ''
  const toolCallsMap = new Map<number, { id: string; name: string; arguments: string }>()

  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data:')) continue
      const payload = trimmed.slice('data:'.length).trim()
      if (payload === '[DONE]') {
        continue
      }
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const json = JSON.parse(payload) as any
        const choice = json.choices?.[0]
        if (!choice) continue

        const delta = choice.delta

        if (delta?.content) {
          fullContent += delta.content
          if (handlers.onChunk) {
            handlers.onChunk({ content: delta.content })
          }
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0
            if (!toolCallsMap.has(idx)) {
              toolCallsMap.set(idx, {
                id: tc.id ?? '',
                name: tc.function?.name ?? '',
                arguments: '',
              })
            }
            const entry = toolCallsMap.get(idx)!
            if (tc.id) entry.id = tc.id
            if (tc.function?.name) entry.name = tc.function.name
            if (tc.function?.arguments) entry.arguments += tc.function.arguments
          }
        }
      } catch {
        // ignore single-line parse errors
      }
    }
  }

  const toolCalls: ToolCallRequest[] = []
  for (const [, entry] of toolCallsMap) {
    if (entry.name) {
      toolCalls.push({
        id: entry.id,
        function: { name: entry.name, arguments: entry.arguments },
      })
    }
  }

  if (handlers.onComplete) {
    handlers.onComplete(fullContent, fullContent.length)
  }

  return {
    content: fullContent,
    tokenCount: fullContent.length,
    completed: true,
    error: undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  }
}

export function createOpenAIStreamingClient(config: OpenAIChatClientConfig): IStreamingChatClient {
  if (isTauriEnv()) {
    return createOpenAICompatTauriClient(config)
  }

  const url = buildCompletionsUrl(config.baseUrl)

  return {
    async askStream(request: StreamingChatRequest, handlers): Promise<StreamingChatResult> {
      try {
        const tried = new Set<string>()
        const queue: Array<{ transportMode: CompletionTransportMode; tokenParamMode: MaxTokenParamMode }> = [
          { transportMode: 'stream', tokenParamMode: 'max_tokens' },
        ]
        let lastError: Error | undefined

        while (queue.length > 0) {
          const attempt = queue.shift()!
          const key = `${attempt.transportMode}:${attempt.tokenParamMode}`
          if (tried.has(key)) continue
          tried.add(key)

          try {
            return await sendCompletionRequest(
              url,
              config,
              request,
              handlers,
              attempt.transportMode,
              attempt.tokenParamMode,
            )
          } catch (e) {
            const error = e as Error
            if (error.name === 'AbortError') {
              return { content: '', tokenCount: 0, completed: false }
            }
            lastError = error
            for (const fallback of buildRetryPlan(e)) {
              const fallbackKey = `${fallback.transportMode}:${fallback.tokenParamMode}`
              if (!tried.has(fallbackKey)) {
                queue.push(fallback)
              }
            }
          }
        }

        if (handlers.onError && lastError) handlers.onError(lastError)
        return { content: '', tokenCount: 0, completed: false, error: lastError }
      } catch (e) {
        const error = e as Error
        if (error.name === 'AbortError') {
          return { content: '', tokenCount: 0, completed: false }
        }
        if (handlers.onError) handlers.onError(error)
        return { content: '', tokenCount: 0, completed: false, error }
      }
    },
  }
}
