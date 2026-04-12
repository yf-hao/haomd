import type { ConversationState } from '../domain/chatSession'
import { loadSession, saveSession, type AiChatSessionCfg } from '../config/aiSessionsRepo'
import { generateSessionTitleWithProvider } from './sessionTitleService'
import type { ChatSessionProviderContext } from './chatSessionService'

const inFlightSessions = new Set<string>()
const AUTO_TITLE_MAX_ATTEMPTS = 3
const AUTO_TITLE_RETRY_COOLDOWN_MS = 30_000

type AutoTitleStatus = NonNullable<AiChatSessionCfg['autoTitleStatus']>

function isPersistedSessionKey(sessionKey: string): boolean {
  return sessionKey.startsWith('session:')
}

function getAutoTitleSource(state: ConversationState): string | null {
  const messages = state.viewMessages ?? []
  const firstAssistant = messages.find((message) => message.role === 'assistant' && !message.streaming)
  if (!firstAssistant) return null

  const firstUser = messages.find((message) => message.role === 'user' && !message.hidden)
  const content = firstUser?.content?.trim()
  return content || null
}

function notifySessionUpdated(sessionKey: string, title: string): void {
  if (typeof BroadcastChannel === 'undefined') return
  const channel = new BroadcastChannel('haomd-sessions')
  channel.postMessage({ type: 'session-updated', id: sessionKey, title })
  channel.close()
}

function getNextAttemptCount(existing?: AiChatSessionCfg | null): number {
  return Math.max(0, existing?.autoTitleAttemptCount ?? 0) + 1
}

function canAttemptAutoTitle(existing: AiChatSessionCfg | null, now: number): boolean {
  if (existing?.title?.trim()) return false

  const status = existing?.autoTitleStatus ?? 'idle'
  const attempts = existing?.autoTitleAttemptCount ?? 0
  const lastAttemptAt = existing?.autoTitleLastAttemptAt ?? 0

  if (status === 'done') return false
  if (attempts >= AUTO_TITLE_MAX_ATTEMPTS) return false
  if (status !== 'idle' && lastAttemptAt > 0 && now - lastAttemptAt < AUTO_TITLE_RETRY_COOLDOWN_MS) {
    return false
  }

  return true
}

async function saveAutoTitleState(
  existing: AiChatSessionCfg,
  status: AutoTitleStatus,
  now: number,
  attemptCount = existing.autoTitleAttemptCount ?? 0,
  title = existing.title ?? null,
): Promise<void> {
  await saveSession({
    ...existing,
    title,
    autoTitleStatus: status,
    autoTitleAttemptCount: attemptCount,
    autoTitleLastAttemptAt: now,
    updatedAt: now,
  })
}

export async function ensureSessionAutoTitle(options: {
  sessionKey: string
  state: ConversationState
  entryMode: string
  providerContext?: ChatSessionProviderContext | null
}): Promise<void> {
  const { sessionKey, state, entryMode, providerContext } = options

  if (!isPersistedSessionKey(sessionKey)) return
  if (inFlightSessions.has(sessionKey)) return

  const userMessage = getAutoTitleSource(state)
  if (!userMessage) return

  inFlightSessions.add(sessionKey)
  try {
    const now = Date.now()
    const existing = await loadSession(sessionKey)
    if (!existing) return
    if (!canAttemptAutoTitle(existing, now)) return

    const nextAttemptCount = getNextAttemptCount(existing)
    await saveAutoTitleState(existing, 'pending', now, nextAttemptCount)

    const title = await generateSessionTitleWithProvider(userMessage, providerContext)
    const finishedAt = Date.now()
    if (!title) {
      await saveAutoTitleState(existing, 'failed', finishedAt, nextAttemptCount)
      return
    }

    const updated: AiChatSessionCfg = {
      ...existing,
      title,
      entryMode: existing.entryMode ?? entryMode,
      providerType: existing.providerType ?? providerContext?.providerType ?? null,
      autoTitleStatus: 'done',
      autoTitleAttemptCount: nextAttemptCount,
      autoTitleLastAttemptAt: finishedAt,
      updatedAt: finishedAt,
    }

    await saveSession(updated)
    notifySessionUpdated(sessionKey, title)
  } catch (error) {
    console.warn('[sessionAutoTitleService] ensureSessionAutoTitle failed', error)
  } finally {
    inFlightSessions.delete(sessionKey)
  }
}
