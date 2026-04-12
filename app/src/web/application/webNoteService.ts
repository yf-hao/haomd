import type { WebLiteChatMessage, WebLiteChatSession, WebLiteNote } from '../domain/models'

function stripMarkdownTitle(content: string): string {
  const firstNonEmptyLine = content
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)

  if (!firstNonEmptyLine) return 'AI 随笔'
  return firstNonEmptyLine
    .replace(/^#+\s*/, '')
    .replace(/[*_`~]/g, '')
    .slice(0, 40) || 'AI 随笔'
}

export function getLatestAssistantMessage(session: WebLiteChatSession | null): WebLiteChatMessage | null {
  if (!session) return null
  const messages = [...session.messages].reverse()
  return messages.find((message) => message.role === 'assistant' && message.content.trim()) ?? null
}

export function createNoteFromAssistantMessage(input: {
  session: WebLiteChatSession
  assistantMessage: WebLiteChatMessage
}): WebLiteNote {
  const now = Date.now()
  const titleSource = input.session.title.trim() && input.session.title !== '新对话'
    ? input.session.title
    : stripMarkdownTitle(input.assistantMessage.content)

  return {
    id: crypto.randomUUID(),
    title: titleSource,
    content: input.assistantMessage.content.trim(),
    createdAt: now,
    updatedAt: now,
  }
}
