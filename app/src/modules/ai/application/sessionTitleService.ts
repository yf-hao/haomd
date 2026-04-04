/**
 * sessionTitleService
 *
 * Generates a short title for a sidebar session after the first user message.
 *
 * - Dify: uses a single shared "naming conversation" whose conversation_id is
 *   persisted in localStorage per provider, so the Dify app can accumulate
 *   context across title requests (avoids creating a new conversation each time).
 * - OpenAI-compatible: fires a one-shot non-streaming completion (max_tokens=20).
 *
 * The caller is responsible for persisting the returned title.
 */

import { SimpleChat } from '../dify/SimpleChat'
import { loadAiSettingsState } from '../config/aiSettingsRepo'

// ─── localStorage key for the shared Dify naming conversation ────────
const NAMING_CONV_KEY_PREFIX = 'haomd:ai:naming-conv-id:'

function getNamingConvId(providerId: string): string | null {
  try {
    return localStorage.getItem(`${NAMING_CONV_KEY_PREFIX}${providerId}`)
  } catch {
    return null
  }
}

function setNamingConvId(providerId: string, convId: string): void {
  try {
    localStorage.setItem(`${NAMING_CONV_KEY_PREFIX}${providerId}`, convId)
  } catch {
    // ignore
  }
}

// ─── Prompt template ──────────────────────────────────────────────────
function buildTitlePrompt(userMessage: string): string {
  const trimmed = userMessage.trim().slice(0, 500)
  return `请用不超过10个字为下面这个问题命名一个会话标题，只输出标题本身，不加任何标点符号或解释：\n\n${trimmed}`
}

// ─── Dify path ────────────────────────────────────────────────────────
async function generateTitleViaDify(
  userMessage: string,
  providerId: string,
  baseURL: string,
  apiKey: string,
  model: string,
): Promise<string | null> {
  const chat = new SimpleChat()
  chat.init({ apiKey, baseURL, model })

  // Restore the shared naming conversation_id for this provider
  const savedConvId = getNamingConvId(providerId)
  if (savedConvId) {
    chat.setConversationId(savedConvId)
  }

  const prompt = buildTitlePrompt(userMessage)
  let title = ''

  const result = await chat.askStream(
    { messages: [{ role: 'user', content: prompt }] },
    {
      enabled: true,
      onChunk: (chunk) => {
        if (chunk.content) title += chunk.content
      },
    },
  )

  if (!result.completed && !title) return null

  // Persist updated conversationId for future calls
  const newConvId = chat.getConversationId()
  if (newConvId) {
    setNamingConvId(providerId, newConvId)
  }

  return cleanTitle(title)
}

// ─── OpenAI-compatible path ───────────────────────────────────────────
async function generateTitleViaOpenAI(
  userMessage: string,
  baseUrl: string,
  apiKey: string,
  model: string,
): Promise<string | null> {
  const trimmed = baseUrl.replace(/\/+$/, '')
  const url = /\/(v\d+|beta)$/.test(trimmed)
    ? `${trimmed}/chat/completions`
    : `${trimmed}/v1/chat/completions`

  const body = {
    model,
    messages: [
      {
        role: 'user',
        content: buildTitlePrompt(userMessage),
      },
    ],
    max_tokens: 30,
    temperature: 0.3,
    stream: false,
  }

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!resp.ok) return null
    const json = await resp.json() as { choices?: { message?: { content?: string } }[] }
    const content = json.choices?.[0]?.message?.content ?? ''
    return cleanTitle(content)
  } catch {
    return null
  }
}

// ─── Trim punctuation / whitespace from AI output ─────────────────────
function cleanTitle(raw: string): string | null {
  const cleaned = raw.trim().replace(/^["'「」【】《》\s]+|["'「」【】《》\s]+$/g, '').slice(0, 50)
  return cleaned || null
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Generate a short title for a session based on the first user message.
 * Returns null if no provider is configured or the call fails.
 */
export async function generateSessionTitle(userMessage: string): Promise<string | null> {
  if (!userMessage.trim()) return null

  try {
    const settings = await loadAiSettingsState()
    const provider = settings.providers.find((p) => p.id === settings.defaultProviderId)
    if (!provider || !provider.defaultModelId) return null

    const providerType = provider.providerType ?? 'dify'

    if (providerType === 'openai') {
      return await generateTitleViaOpenAI(
        userMessage,
        provider.baseUrl,
        provider.apiKey,
        provider.defaultModelId,
      )
    }

    // Dify (default)
    return await generateTitleViaDify(
      userMessage,
      provider.id,
      provider.baseUrl,
      provider.apiKey,
      provider.defaultModelId,
    )
  } catch (e) {
    console.warn('[sessionTitleService] generateSessionTitle error', e)
    return null
  }
}
