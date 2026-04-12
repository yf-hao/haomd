import type { WebLiteChatSession, WebLiteNote } from '../domain/models'

export function createChatSessionFromNote(note: WebLiteNote): WebLiteChatSession {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    title: note.title.trim() || '新对话',
    createdAt: now,
    updatedAt: now,
    messages: [
      {
        id: crypto.randomUUID(),
        role: 'user',
        content: `请基于这篇随笔继续聊天：\n\n# ${note.title}\n\n${note.content}`.trim(),
        createdAt: now,
      },
    ],
  }
}
