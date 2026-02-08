// Provider 连接测试服务
// 通过通用流式聊天接口保持可扩展，底层实现由工厂根据 providerType 决定

import type { IStreamingChatClient } from './domain/types'
import type { UiProvider } from './settings'
import { createStreamingClientFromSettings } from './streamingClientFactory'

export type ProviderTestInput = {
  baseUrl: string
  apiKey: string
  modelId: string
  providerType?: UiProvider['providerType']
}

export type ProviderTestResult = {
  ok: boolean
  message: string
  rawContent?: string
}

const SYSTEM_PROMPT = '严格根据用户的要求回答问题，不要自己发挥'

export async function testProviderConnection(
  input: ProviderTestInput,
  client?: IStreamingChatClient,
): Promise<ProviderTestResult> {
  const baseUrl = input.baseUrl.trim()
  const apiKey = input.apiKey.trim()
  const modelId = input.modelId.trim()

  if (!baseUrl || !apiKey || !modelId) {
    return {
      ok: false,
      message: '请填写 Base URL / API Key / Models，并至少包含一个模型',
    }
  }

  const chatClient: IStreamingChatClient =
    client ??
    createStreamingClientFromSettings(
      {
        id: 'test-provider',
        name: 'Test Provider',
        baseUrl,
        apiKey,
        models: [{ id: modelId }],
        defaultModelId: modelId,
        description: undefined,
        providerType: input.providerType ?? 'dify',
      },
      SYSTEM_PROMPT,
    )

  const testMessage = '请严格根据我的要求，仅回复两个字：成功。'

  let buffer = ''

  try {
    const result = await chatClient.askStream(
      {
        messages: [{ role: 'user', content: testMessage }],
        temperature: 0,
        maxTokens: 256,
      },
      {
        onChunk: (chunk) => {
          if (chunk.content) {
            buffer += chunk.content
          }
        },
        onComplete: () => {
          // no-op，结果由 buffer 决定
        },
        onError: () => {
          // 错误会通过 askStream 的返回/异常统一处理
        },
      },
    )

    // 打印原始结果和累积文本，方便分析真实返回行为
    // 注意：这里只用于开发调试，不会影响 UI 行为
    // eslint-disable-next-line no-console
    console.log('[testProviderConnection] stream result', { result, buffer })

    if (result.error) {
      return {
        ok: false,
        message: `连接失败：${result.error.message || '未知错误'}`,
      }
    }

    // 严格按照"有回复才算成功"的要求：只要有任意非空文本，就认为测试成功
    if (buffer.trim()) {
      return {
        ok: true,
        message: '连接成功',
        rawContent: buffer,
      }
    }

    // 流完成但没有任何文本，说明连得上但应用没有返回内容
    // 这种情况视为测试失败，给出更具体的提示
    if (result.completed) {
      return {
        ok: false,
        message: '连接失败：已建立连接，但未收到任何回复，请检查 Dify 应用配置',
      }
    }

    return {
      ok: false,
      message: '连接失败：未收到模型回复，请检查 Base URL / API Key / Models 配置',
    }
  } catch (e) {
    const err = e as Error
    return {
      ok: false,
      message: `连接失败：${err.message || '未知错误'}`,
    }
  }
}
