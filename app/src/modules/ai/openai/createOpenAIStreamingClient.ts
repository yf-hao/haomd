import type { IStreamingChatClient, StreamingChatRequest, StreamingChatResult, ToolCallRequest } from '../domain/types'

export type OpenAIChatClientConfig = {
  apiKey: string
  baseUrl: string
  modelId: string
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
}

function buildCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  if (/\/(v\d+|beta)$/.test(trimmed)) {
    return `${trimmed}/chat/completions`
  }
  return `${trimmed}/v1/chat/completions`
}

export function createOpenAIStreamingClient(config: OpenAIChatClientConfig): IStreamingChatClient {
  const url = buildCompletionsUrl(config.baseUrl)

  return {
    async askStream(request: StreamingChatRequest, handlers): Promise<StreamingChatResult> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body: any = {
        model: config.modelId,
        messages: [
          ...(config.systemPrompt
            ? [{ role: 'system', content: config.systemPrompt }]
            : []),
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
        ],
        temperature: request.temperature ?? config.temperature ?? 0,
        max_tokens: request.maxTokens ?? config.maxTokens,
        stream: true,
      }

      // Inject tools if provided
      if (request.tools && request.tools.length > 0) {
        body.tools = request.tools
        body.tool_choice = 'auto'
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: request.signal,
      })

      if (!response.ok || !response.body) {
        const text = await response.text()
        const error = new Error(`OpenAI API error (${response.status}): ${text}`)
        if (handlers.onError) handlers.onError(error)
        return { content: '', tokenCount: 0, completed: false, error }
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let fullContent = ''
      // Accumulate tool_calls from deltas
      const toolCallsMap = new Map<number, { id: string; name: string; arguments: string }>()

      try {
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

              // Text content
              if (delta?.content) {
                fullContent += delta.content
                if (handlers.onChunk) {
                  handlers.onChunk({ content: delta.content })
                }
              }

              // Tool calls delta accumulation
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

        // Build tool calls result
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
      } catch (e) {
        const error = e as Error
        if (error.name === 'AbortError') {
          return { content: fullContent, tokenCount: fullContent.length, completed: false }
        }
        if (handlers.onError) handlers.onError(error)
        return { content: '', tokenCount: 0, completed: false, error }
      }
    },
  }
}
