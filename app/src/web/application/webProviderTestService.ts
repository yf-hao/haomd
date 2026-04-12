import type { ProviderType, UiProvider } from '../../modules/ai/settings'
import { builtinPromptRoles } from '../../modules/ai/promptSettings'
import { createStreamingClientFromSettings } from '../../modules/ai/streamingClientFactory'

export function buildSingleWebProvider(input: {
  providerType: ProviderType
  baseUrl: string
  apiKey: string
  modelId: string
}): UiProvider {
  return {
    id: 'default-web-provider',
    name: 'Default Provider',
    providerType: input.providerType,
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    defaultModelId: input.modelId,
    models: input.modelId ? [{ id: input.modelId }] : [],
  }
}

export async function testWebProviderConnection(input: {
  providerType: ProviderType
  baseUrl: string
  apiKey: string
  modelId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const client = createStreamingClientFromSettings(
      buildSingleWebProvider(input),
      builtinPromptRoles[0]?.prompt,
    )
    const result = await client.askStream({
      messages: [{ role: 'user', content: '请只回复“ok”。' }],
      temperature: 0,
      maxTokens: 16,
    }, {})
    if (!result.completed && !result.content.trim()) {
      return { ok: false, error: result.error?.message ?? '连接测试失败' }
    }
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '连接测试失败',
    }
  }
}
