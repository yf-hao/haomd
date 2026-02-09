import type {
  FC,
  FormEvent,
  KeyboardEvent,
  RefObject,
} from 'react'
import { MarkdownViewer } from '../../../components/MarkdownViewer'
import type { ChatMessageView } from '../domain/chatSession'

export interface AiChatBodyProps {
  messages: ChatMessageView[]
  loading: boolean
  error: { message: string } | null
  input: string
  onInputChange: (value: string) => void
  onSubmit: (e: FormEvent<HTMLFormElement>) => void
  onInputKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  onCompositionStart?: () => void
  onCompositionEnd?: () => void
  inputRef?: RefObject<HTMLTextAreaElement>
  messagesContainerRef: RefObject<HTMLDivElement>
  getDisplayContent: (msgId: string, full: string, streaming?: boolean) => string
  onCopy: (content: string) => void | Promise<void>
  onInsert: (content: string) => void | Promise<void>
  onReplace: (content: string) => void | Promise<void>
  onSave: (content: string) => void | Promise<void>
  resetError: () => void
}

export const AiChatBody: FC<AiChatBodyProps> = ({
  messages,
  loading,
  error,
  input,
  onInputChange,
  onSubmit,
  onInputKeyDown,
  onCompositionStart,
  onCompositionEnd,
  inputRef,
  messagesContainerRef,
  getDisplayContent,
  onCopy,
  onInsert,
  onReplace,
  onSave,
  resetError,
}) => {
  return (
    <div className="modal-content ai-chat-body">
      <div
        className="ai-chat-messages"
        ref={messagesContainerRef}
      >
        {messages.length === 0 && !loading && (
          <div className="ai-chat-empty muted small">开始对话，或通过文件/选区入口提问。</div>
        )}
        {messages.map((msg) => {
          const displayContent =
            msg.role === 'assistant'
              ? getDisplayContent(msg.id, msg.content, msg.streaming)
              : msg.content

          return (
            <div key={msg.id} className={`ai-chat-message ai-chat-message-${msg.role}`}>
              {msg.role === 'assistant' ? (
                <MarkdownViewer value={displayContent} />
              ) : (
                <div className="ai-chat-message-content">{displayContent}</div>
              )}
              {msg.role === 'assistant' && !msg.streaming && msg.content.trim() && (
                <div className="ai-chat-message-actions">
                  <button
                    type="button"
                    className="icon-button ai-chat-icon-button"
                    title="复制为 Markdown"
                    aria-label="复制为 Markdown"
                    onClick={() => void onCopy(msg.content)}
                  >
                    <span className="ai-chat-icon ai-chat-icon-copy" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="icon-button ai-chat-icon-button"
                    title="插入到编辑器"
                    aria-label="插入到编辑器"
                    onClick={() => void onInsert(msg.content)}
                  >
                    <span className="ai-chat-icon ai-chat-icon-insert" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="icon-button ai-chat-icon-button"
                    title="替换选区"
                    aria-label="替换选区"
                    onClick={() => void onReplace(msg.content)}
                  >
                    <span className="ai-chat-icon ai-chat-icon-replace" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="icon-button ai-chat-icon-button"
                    title="保存为新文档"
                    aria-label="保存为新文档"
                    onClick={() => void onSave(msg.content)}
                  >
                    <span className="ai-chat-icon ai-chat-icon-save" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <form className="ai-chat-input" onSubmit={onSubmit}>
        <textarea
          id="ai-chat-input"
          className="field-textarea"
          rows={1}
          ref={inputRef}
          value={input}
          onChange={(e) => {
            onInputChange(e.target.value)
          }}
          onKeyDown={onInputKeyDown}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          placeholder="向 AI 提问，或继续就当前话题追问…"
        />
        <div className="ai-chat-input-actions">
          {error && (
            <div className="form-error" onClick={resetError}>
              {error.message}
            </div>
          )}
          <button className="ghost primary" type="submit" disabled={loading}>
            {loading ? '思考中…' : '发送'}
          </button>
        </div>
      </form>
    </div>
  )
}
