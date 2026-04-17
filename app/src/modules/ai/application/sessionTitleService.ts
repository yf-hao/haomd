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
import { loadNamingConv, saveNamingConv } from '../config/aiSessionsRepo'
import { createGeminiTauriClient } from '../gemini/createGeminiTauriClient'
import { createOpenAIStreamingClient } from '../openai/createOpenAIStreamingClient'
import type { ChatSessionProviderContext } from './chatSessionService'

// ─── Tauri-persisted naming conversation ID per provider ─────────────
async function getNamingConvId(providerId: string): Promise<string | null> {
  try {
    const cfg = await loadNamingConv()
    return cfg.convIds[providerId] ?? null
  } catch (e) {
    console.warn('[sessionTitleService] getNamingConvId error', e)
    return null
  }
}

async function setNamingConvId(providerId: string, convId: string): Promise<void> {
  try {
    const cfg = await loadNamingConv()
    cfg.convIds[providerId] = convId
    await saveNamingConv(cfg)
  } catch (e) {
    console.warn('[sessionTitleService] setNamingConvId error', e)
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
  const savedConvId = await getNamingConvId(providerId)
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
    await setNamingConvId(providerId, newConvId)
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
  try {
    const client = createOpenAIStreamingClient({
      apiKey,
      baseUrl,
      modelId: model,
      temperature: 0.3,
      maxTokens: 30,
    })

    const result = await client.askStream(
      {
        messages: [
          {
            role: 'user',
            content: buildTitlePrompt(userMessage),
          },
        ],
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

async function generateTitleViaGemini(
  userMessage: string,
  baseUrl: string,
  apiKey: string,
  model: string,
): Promise<string | null> {
  try {
    const client = createGeminiTauriClient({
      apiKey,
      baseUrl,
      modelId: model,
    })

    const result = await client.askStream(
      {
        messages: [
          {
            role: 'user',
            content: buildTitlePrompt(userMessage),
          },
        ],
      },
      {},
    )

    if (!result.completed && !result.content) return null
    return cleanTitle(result.content)
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
    return await generateSessionTitleWithProvider(userMessage)
  } catch (e) {
    console.warn('[sessionTitleService] generateSessionTitle error', e)
    return null
  }
}

export async function generateSessionTitleWithProvider(
  userMessage: string,
  providerContext?: ChatSessionProviderContext | null,
): Promise<string | null> {
  if (!userMessage.trim()) return null

  try {
    if (providerContext?.providerId && providerContext.modelId) {
      if (providerContext.providerType === 'openai') {
        return await generateTitleViaOpenAI(
          userMessage,
          providerContext.baseUrl,
          providerContext.apiKey,
          providerContext.modelId,
        )
      }

      if (providerContext.providerType === 'gemini') {
        return await generateTitleViaGemini(
          userMessage,
          providerContext.baseUrl,
          providerContext.apiKey,
          providerContext.modelId,
        )
      }

      return await generateTitleViaDify(
        userMessage,
        providerContext.providerId,
        providerContext.baseUrl,
        providerContext.apiKey,
        providerContext.modelId,
      )
    }

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

    if (providerType === 'gemini') {
      return await generateTitleViaGemini(
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
    console.warn('[sessionTitleService] generateSessionTitleWithProvider error', e)
    return null
  }
}
