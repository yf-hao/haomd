import { ChatComposer } from '../components/ChatComposer'
import { ChatMessageList } from '../components/ChatMessageList'
import type { WebLiteChatSession } from '../domain/models'

export function ChatDetailPage({
  session,
  loading,
  sending,
  error,
  onBack,
  onSend,
  onSaveToNote,
  onVoiceError,
}: {
  session: WebLiteChatSession | null
  loading: boolean
  sending: boolean
  error: string | null
  onBack?: () => void
  onSend: (value: string) => Promise<void>
  onSaveToNote?: () => Promise<void> | void
  onVoiceError?: (message: string) => void
}) {
  if (loading) {
    return <section className="web-detail"><div className="web-empty">加载中...</div></section>
  }

  if (!session) {
    return <section className="web-detail"><div className="web-empty">请选择一个会话。</div></section>
  }

  return (
    <section className="web-detail web-chat-detail">
      <header className="web-detail-header">
        {onBack ? <button onClick={onBack}>返回</button> : <span />}
        <h2>{session.title}</h2>
        {onSaveToNote ? <button onClick={() => void onSaveToNote()}>保存到随笔</button> : <span />}
      </header>
      {error ? <div className="web-error web-chat-error">{error}</div> : null}
      <div className="web-chat-main">
        <ChatMessageList messages={session.messages} />
        <ChatComposer disabled={sending} onSend={onSend} onVoiceError={onVoiceError} />
      </div>
    </section>
  )
}
