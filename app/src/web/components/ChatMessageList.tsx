import type { WebLiteChatMessage } from '../domain/models'
import { useMessageAutoScroll } from '../hooks/useMessageAutoScroll'

export function ChatMessageList({ messages }: { messages: WebLiteChatMessage[] }) {
  const containerRef = useMessageAutoScroll(messages.length)

  return (
    <div ref={containerRef} className="web-message-list">
      <div className="web-message-stack">
        {messages.map((message) => (
          <article key={message.id} className={`web-message ${message.role}`}>
            <div className="web-message-role">{message.role === 'user' ? '你' : 'AI'}</div>
            <div className="web-message-content">{message.content || '...'}</div>
          </article>
        ))}
      </div>
    </div>
  )
}
