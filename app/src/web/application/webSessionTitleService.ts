import type { UiProvider } from '../../modules/ai/settings'
import { createStreamingClientFromSettings } from '../../modules/ai/streamingClientFactory'

function buildTitlePrompt(userMessage: string): string {
  const trimmed = userMessage.trim().slice(0, 500)
  return `请用不超过10个字为下面这个问题命名一个会话标题，只输出标题本身，不加任何标点符号或解释：\n\n${trimmed}`
}

function cleanTitle(raw: string): string | null {
  const cleaned = raw.trim().replace(/^["'「」【】《》\s]+|["'「」【】《》\s]+$/g, '').slice(0, 50)
  return cleaned || null
}

export async function generateWebSessionTitle(userMessage: string, provider: UiProvider): Promise<string | null> {
  if (!userMessage.trim()) return null
  try {
    const client = createStreamingClientFromSettings(provider)
    const result = await client.askStream(
      {
        messages: [{ role: 'user', content: buildTitlePrompt(userMessage) }],
        temperature: 0.3,
        maxTokens: 30,
      },
      {},
    )
    if (!result.completed && !result.content) return null
    return cleanTitle(result.content)
  } catch {
    return null
  }
}
