import type { ChatMessageView } from '../domain/chatSession'

function extractTimestampFromMessageId(id: string): number | null {
  const match = id.match(/^(\d{10,})_/)
  if (!match) return null
  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : null
}

export function buildDisplayMessages(
  persistedMessages: ChatMessageView[],
  localFeedbackMessages: ChatMessageView[],
): ChatMessageView[] {
  return [...persistedMessages, ...localFeedbackMessages]
    .map((message, index) => ({
      message,
      index,
      timestamp: extractTimestampFromMessageId(message.id),
    }))
    .sort((left, right) => {
      if (left.timestamp != null && right.timestamp != null && left.timestamp !== right.timestamp) {
        return left.timestamp - right.timestamp
      }
      if (left.timestamp != null && right.timestamp == null) return 1
      if (left.timestamp == null && right.timestamp != null) return -1
      return left.index - right.index
    })
    .map((entry) => entry.message)
}
