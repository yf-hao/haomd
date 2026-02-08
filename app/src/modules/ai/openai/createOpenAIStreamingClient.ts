import type { IStreamingChatClient, StreamingChatRequest, StreamingChatResult } from '../domain/types'

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
      const controller = new AbortController()

      const body = {
        model: config.modelId,
        messages: [
          ...(config.systemPrompt
            ? [{ role: 'system', content: config.systemPrompt }]
            : []),
          ...request.messages.map((m) => ({ role: m.role, content: m.content })),
        ],
        temperature: request.temperature ?? config.temperature ?? 0,
        max_tokens: request.maxTokens ?? config.maxTokens,
        stream: true,
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
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

      try {
        // 按行解析 SSE: data: {...}
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
              const json = JSON.parse(payload) as any
              const delta: string | undefined = json.choices?.[0]?.delta?.content
              if (delta) {
                fullContent += delta
                if (handlers.onChunk) {
                  handlers.onChunk({ content: delta })
                }
              }
            } catch {
              // 忽略单行解析错误
            }
          }
        }

        if (handlers.onComplete) {
          handlers.onComplete(fullContent, fullContent.length)
        }

        return { content: fullContent, tokenCount: fullContent.length, completed: true, error: undefined }
      } catch (e) {
        const error = e as Error
        if (handlers.onError) handlers.onError(error)
        return { content: '', tokenCount: 0, completed: false, error }
      } finally {
        controller.abort()
      }
    },
  }
}
