import type { CSSProperties, Dispatch, RefObject, SetStateAction } from 'react'
import { memo } from 'react'
import { MarkdownViewer } from '../../../components/MarkdownViewer'
import type { ChatMessageView } from '../domain/chatSession'
import type { AssistantToolExecutionView } from '../domain/chatSession'
import type { EphemeralAiChatMessage, EphemeralImageGenerationResultMessage } from './imageGenerationEphemeral'

export type MessageViewMode = 'rendered' | 'source'

type AiChatMessageItemProps = {
  msg: ChatMessageView
  displayContent: string
  viewMode: MessageViewMode
  onCopy: (content: string) => void | Promise<void>
  onInsert: (content: string) => void | Promise<void>
  onReplace: (content: string) => void | Promise<void>
  onSave: (content: string) => void | Promise<void>
  onSaveToNotes?: (content: string) => void | Promise<void>
  onToggleViewMode?: () => void
  toolExecutionDetailsLabel: string
  copyMarkdownLabel: string
  insertIntoEditorLabel: string
  replaceSelectionLabel: string
  saveAsNewDocumentLabel: string
  saveToNotesLabel: string
  showRenderedMarkdownLabel: string
  viewMarkdownSourceLabel: string
  summaryPreservedUserInputLabel: string
}

export type AiChatMessagesPaneProps = {
  visibleMessages: ChatMessageView[]
  renderedMessages: ChatMessageView[]
  ephemeralMessages: EphemeralAiChatMessage[]
  loading: boolean
  isResizing: boolean
  aiChatBackgroundUrl: string | null
  aiChatBackgroundStyle: CSSProperties | undefined
  aiChatBackgroundSize?: string
  messagesContainerRef: RefObject<HTMLDivElement>
  messageViewModes: Record<string, MessageViewMode>
  latestDynamicAssistantId: string | null
  getDisplayContent: (msgId: string, full: string, streaming?: boolean) => string
  onCopy: (content: string) => void | Promise<void>
  onInsert: (content: string) => void | Promise<void>
  onReplace: (content: string) => void | Promise<void>
  onSave: (content: string) => void | Promise<void>
  onSaveToNotes?: (content: string) => void | Promise<void>
  setMessageViewModes: Dispatch<SetStateAction<Record<string, MessageViewMode>>>
  toolExecutionDetailsLabel: string
  copyMarkdownLabel: string
  insertIntoEditorLabel: string
  replaceSelectionLabel: string
  saveAsNewDocumentLabel: string
  saveToNotesLabel: string
  showRenderedMarkdownLabel: string
  viewMarkdownSourceLabel: string
  summaryPreservedUserInputLabel: string
  imageGenerationTemporaryLabel: string
  imageGenerationRunningLabel: string
  imageGenerationFailedLabel: string
  imageGenerationResultAltLabel: string
  imageGenerationCopyUrlLabel: string
  imageGenerationCopyMarkdownLabel: string
  imageGenerationSaveLocalLabel: string
  imageGenerationInsertEditorLabel: string
  imageGenerationSaveToNotesLabel: string
  imageGenerationTaskIdLabelTemplate: string
  onCopyImageUrl?: (message: EphemeralImageGenerationResultMessage) => void | Promise<void>
  onCopyImageMarkdown?: (message: EphemeralImageGenerationResultMessage) => void | Promise<void>
  onSaveGeneratedImage?: (message: EphemeralImageGenerationResultMessage) => void | Promise<void>
  onInsertGeneratedImage?: (message: EphemeralImageGenerationResultMessage) => void | Promise<void>
  onSaveGeneratedImageToNotes?: (message: EphemeralImageGenerationResultMessage) => void | Promise<void>
}

const DEFAULT_VISION_PROMPT = '请详细识别并描述这张图片中的内容。如果图片中包含文字、公式、表格、题目或文档，请先完整提取关键信息，再直接回答。若图片信息不足，请明确说明。'

const getUserDisplayContent = (content: string) => {
  const trimmed = content.trim()
  if (trimmed === DEFAULT_VISION_PROMPT) return ''
  const marker = '根据以上问题回答：'
  const idx = trimmed.indexOf(marker)
  if (idx !== -1) {
    const after = trimmed.slice(idx + marker.length).trim()
    if (after) return after
    return ''
  }
  return content
}

const areToolExecutionsEqual = (
  left: AssistantToolExecutionView[] | undefined,
  right: AssistantToolExecutionView[] | undefined,
) => {
  if (left === right) return true
  if (!left || !right) return !left && !right
  if (left.length !== right.length) return false
  return left.every((item, index) => {
    const candidate = right[index]
    return candidate
      && candidate.id === item.id
      && candidate.label === item.label
      && candidate.status === item.status
      && candidate.detail === item.detail
  })
}

const AiChatMessageItem = memo(({
  msg,
  displayContent,
  viewMode,
  onCopy,
  onInsert,
  onReplace,
  onSave,
  onSaveToNotes,
  onToggleViewMode,
  toolExecutionDetailsLabel,
  copyMarkdownLabel,
  insertIntoEditorLabel,
  replaceSelectionLabel,
  saveAsNewDocumentLabel,
  saveToNotesLabel,
  showRenderedMarkdownLabel,
  viewMarkdownSourceLabel,
  summaryPreservedUserInputLabel,
}: AiChatMessageItemProps) => {
  const showStreamingIndicator = msg.role === 'assistant' && msg.streaming && displayContent.trim().length === 0
  const toolExecutions = msg.role === 'assistant' ? (msg.toolExecutions ?? []) : []
  const showToolExecutions = toolExecutions.length > 0

  return (
    <div className={`ai-chat-message ai-chat-message-${msg.role}`}>
      {msg.source === 'summary-preserved' && (
        <div className="ai-chat-message-badge ai-chat-message-badge-summary-preserved">
          {summaryPreservedUserInputLabel}
        </div>
      )}
      {msg.role === 'assistant' ? (
        showStreamingIndicator ? (
          <div className="ai-chat-loading-indicator ai-chat-loading-indicator-inline" aria-label={showRenderedMarkdownLabel}>
            <span className="ai-typing-dot" />
            <span className="ai-typing-dot" />
            <span className="ai-typing-dot" />
          </div>
        ) : displayContent.trim() ? (
          <MarkdownViewer value={displayContent} mode={viewMode} />
        ) : null
      ) : (
        <div className="ai-chat-message-content">{displayContent}</div>
      )}
      {msg.role === 'assistant' && showToolExecutions && (
        <details className="ai-chat-tool-executions" open>
          <summary className="ai-chat-tool-executions-summary">
            {toolExecutionDetailsLabel}
          </summary>
          <div className="ai-chat-tool-executions-list">
            {toolExecutions.map((execution) => (
              <div key={execution.id} className="ai-chat-tool-execution-item">
                <div className="ai-chat-tool-execution-header">
                  <span
                    className={`ai-chat-tool-execution-status ai-chat-tool-execution-status-${execution.status}`}
                    aria-hidden="true"
                  />
                  <span className="ai-chat-tool-execution-label">{execution.label}</span>
                </div>
                {execution.detail?.trim() && (
                  <div className="ai-chat-tool-execution-detail">{execution.detail}</div>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
      {msg.role === 'assistant' && !msg.streaming && msg.content.trim() && (
        <div className="ai-chat-message-actions">
          <button type="button" className="icon-button ai-chat-icon-button" title={copyMarkdownLabel} aria-label={copyMarkdownLabel} onClick={() => void onCopy(msg.content)}>
            <span className="ai-chat-icon ai-chat-icon-copy" aria-hidden="true" />
          </button>
          <button type="button" className="icon-button ai-chat-icon-button" title={insertIntoEditorLabel} aria-label={insertIntoEditorLabel} onClick={() => void onInsert(msg.content)}>
            <span className="ai-chat-icon ai-chat-icon-insert" aria-hidden="true" />
          </button>
          <button type="button" className="icon-button ai-chat-icon-button" title={replaceSelectionLabel} aria-label={replaceSelectionLabel} onClick={() => void onReplace(msg.content)}>
            <span className="ai-chat-icon ai-chat-icon-replace" aria-hidden="true" />
          </button>
          <button type="button" className="icon-button ai-chat-icon-button" title={saveAsNewDocumentLabel} aria-label={saveAsNewDocumentLabel} onClick={() => void onSave(msg.content)}>
            <span className="ai-chat-icon ai-chat-icon-save" aria-hidden="true" />
          </button>
          {onSaveToNotes && (
            <button type="button" className="icon-button ai-chat-icon-button" title={saveToNotesLabel} aria-label={saveToNotesLabel} onClick={() => void onSaveToNotes(msg.content)}>
              <span className="ai-chat-icon ai-chat-icon-note" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className={`icon-button ai-chat-icon-button ${viewMode === 'source' ? 'ai-chat-icon-button-active' : ''}`}
            title={viewMode === 'source' ? showRenderedMarkdownLabel : viewMarkdownSourceLabel}
            aria-label={viewMode === 'source' ? showRenderedMarkdownLabel : viewMarkdownSourceLabel}
            aria-pressed={viewMode === 'source'}
            onClick={onToggleViewMode}
          >
            <span className="ai-chat-icon ai-chat-icon-source" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  )
}, (prev, next) => (
  prev.msg.id === next.msg.id
  && prev.msg.role === next.msg.role
  && prev.msg.source === next.msg.source
  && prev.msg.streaming === next.msg.streaming
  && prev.msg.content === next.msg.content
  && prev.displayContent === next.displayContent
  && prev.viewMode === next.viewMode
  && areToolExecutionsEqual(prev.msg.toolExecutions, next.msg.toolExecutions)
))

export const AiChatMessagesPane = memo(({
  visibleMessages,
  renderedMessages,
  ephemeralMessages,
  loading,
  isResizing,
  aiChatBackgroundUrl,
  aiChatBackgroundStyle,
  aiChatBackgroundSize = 'cover',
  messagesContainerRef,
  messageViewModes,
  latestDynamicAssistantId,
  getDisplayContent,
  onCopy,
  onInsert,
  onReplace,
  onSave,
  onSaveToNotes,
  setMessageViewModes,
  toolExecutionDetailsLabel,
  copyMarkdownLabel,
  insertIntoEditorLabel,
  replaceSelectionLabel,
  saveAsNewDocumentLabel,
  saveToNotesLabel,
  showRenderedMarkdownLabel,
  viewMarkdownSourceLabel,
  summaryPreservedUserInputLabel,
  imageGenerationTemporaryLabel,
  imageGenerationRunningLabel,
  imageGenerationFailedLabel,
  imageGenerationResultAltLabel,
  imageGenerationCopyUrlLabel,
  imageGenerationCopyMarkdownLabel,
  imageGenerationSaveLocalLabel,
  imageGenerationInsertEditorLabel,
  imageGenerationSaveToNotesLabel,
  imageGenerationTaskIdLabelTemplate,
  onCopyImageUrl,
  onCopyImageMarkdown,
  onSaveGeneratedImage,
  onInsertGeneratedImage,
  onSaveGeneratedImageToNotes,
}: AiChatMessagesPaneProps) => {
  return (
    <div
      className={`ai-chat-messages ${aiChatBackgroundUrl ? 'has-ai-chat-background' : ''} ${isResizing ? 'is-ai-chat-resizing' : ''} ai-chat-bg-fit-${aiChatBackgroundSize}`}
      style={aiChatBackgroundStyle}
    >
      {aiChatBackgroundUrl ? (
        <>
          <img className="ai-chat-messages-background" src={aiChatBackgroundUrl} alt="" aria-hidden="true" />
          <div className="ai-chat-messages-background-overlay" aria-hidden="true" />
        </>
      ) : null}
      <div className="ai-chat-messages-scroll" ref={messagesContainerRef}>
        <div className="ai-chat-messages-content">
          {visibleMessages.length === 0 && !loading && (
            <div className="ai-chat-empty muted small"></div>
          )}
          {renderedMessages.map((msg) => {
            const viewMode: MessageViewMode = messageViewModes[msg.id] ?? 'rendered'
            const displayContent =
              msg.role === 'assistant'
                ? (
                  viewMode === 'source'
                    ? msg.content
                    : msg.id === latestDynamicAssistantId
                      ? getDisplayContent(msg.id, msg.content, msg.streaming)
                      : msg.content
                )
                : getUserDisplayContent(msg.content)
            return (
              <AiChatMessageItem
                key={msg.id}
                msg={msg}
                displayContent={displayContent}
                viewMode={viewMode}
                onCopy={onCopy}
                onInsert={onInsert}
                onReplace={onReplace}
                onSave={onSave}
                onSaveToNotes={onSaveToNotes}
                onToggleViewMode={() => {
                  setMessageViewModes((prev) => {
                    const current = prev[msg.id] ?? 'rendered'
                    const next: MessageViewMode = current === 'rendered' ? 'source' : 'rendered'
                    return { ...prev, [msg.id]: next }
                  })
                }}
                toolExecutionDetailsLabel={toolExecutionDetailsLabel}
                copyMarkdownLabel={copyMarkdownLabel}
                insertIntoEditorLabel={insertIntoEditorLabel}
                replaceSelectionLabel={replaceSelectionLabel}
                saveAsNewDocumentLabel={saveAsNewDocumentLabel}
                saveToNotesLabel={saveToNotesLabel}
                showRenderedMarkdownLabel={showRenderedMarkdownLabel}
                viewMarkdownSourceLabel={viewMarkdownSourceLabel}
                summaryPreservedUserInputLabel={summaryPreservedUserInputLabel}
              />
            )
          })}
          {ephemeralMessages.map((message) => {
            if (message.type === 'image_generation_prompt') {
              return (
                <div key={message.id} className="ai-chat-message ai-chat-message-user ai-chat-message-ephemeral">
                  <div className="ai-chat-message-badge ai-chat-message-badge-image-generation">
                    {imageGenerationTemporaryLabel}
                  </div>
                  <div className="ai-chat-message-content">{message.content}</div>
                </div>
              )
            }

            const imageMessage = message
            return (
              <div key={imageMessage.id} className="ai-chat-message ai-chat-message-assistant ai-chat-message-image-generation">
                <div className="ai-chat-message-badge ai-chat-message-badge-image-generation">
                  {imageGenerationTemporaryLabel}
                </div>
                <div className="ai-chat-image-card">
                  <div className="ai-chat-image-card-title">
                    {imageMessage.agentName}
                  </div>
                  {imageMessage.status === 'running' && (
                    <div className="ai-chat-image-card-status">{imageGenerationRunningLabel}</div>
                  )}
                  {imageMessage.status === 'failed' && (
                    <div className="ai-chat-image-card-status ai-chat-image-card-status-error">
                      {imageMessage.errorMessage || imageGenerationFailedLabel}
                    </div>
                  )}
                  {imageMessage.status === 'succeeded' && imageMessage.imageUrl && (
                    <>
                      <img className="ai-chat-image-card-preview" src={imageMessage.imageUrl} alt={imageGenerationResultAltLabel} />
                      <div className="ai-chat-image-card-meta">
                        {imageMessage.taskId
                          ? imageGenerationTaskIdLabelTemplate.replace('{taskId}', imageMessage.taskId)
                          : null}
                      </div>
                      <div className="ai-chat-message-actions">
                        <button type="button" className="icon-button ai-chat-icon-button" title={imageGenerationCopyUrlLabel} aria-label={imageGenerationCopyUrlLabel} onClick={() => void onCopyImageUrl?.(imageMessage)}>
                          <span className="ai-chat-icon ai-chat-icon-copy" aria-hidden="true" />
                        </button>
                        <button type="button" className="icon-button ai-chat-icon-button" title={imageGenerationCopyMarkdownLabel} aria-label={imageGenerationCopyMarkdownLabel} onClick={() => void onCopyImageMarkdown?.(imageMessage)}>
                          <span className="ai-chat-icon ai-chat-icon-source" aria-hidden="true" />
                        </button>
                        <button type="button" className="icon-button ai-chat-icon-button" title={imageGenerationSaveLocalLabel} aria-label={imageGenerationSaveLocalLabel} onClick={() => void onSaveGeneratedImage?.(imageMessage)}>
                          <span className="ai-chat-icon ai-chat-icon-save" aria-hidden="true" />
                        </button>
                        <button type="button" className="icon-button ai-chat-icon-button" title={imageGenerationInsertEditorLabel} aria-label={imageGenerationInsertEditorLabel} onClick={() => void onInsertGeneratedImage?.(imageMessage)}>
                          <span className="ai-chat-icon ai-chat-icon-insert" aria-hidden="true" />
                        </button>
                        <button type="button" className="icon-button ai-chat-icon-button" title={imageGenerationSaveToNotesLabel} aria-label={imageGenerationSaveToNotesLabel} onClick={() => void onSaveGeneratedImageToNotes?.(imageMessage)}>
                          <span className="ai-chat-icon ai-chat-icon-note" aria-hidden="true" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
})
