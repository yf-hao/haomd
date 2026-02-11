import type {
  FC,
  FormEvent,
  KeyboardEvent,
  RefObject,
  ChangeEvent,
} from 'react'
import { useRef } from 'react'
import { MarkdownViewer } from '../../../components/MarkdownViewer'
import type { ChatMessageView } from '../domain/chatSession'
import type { VisionMode, UploadedFileRef } from '../domain/types'

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
  onStop: () => void
  resetError: () => void
  roles?: { id: string; name: string }[]
  activeRoleId?: string
  onChangeRole?: (roleId: string) => void
  models?: { id: string; providerName: string; visionMode?: VisionMode }[]
  activeModelId?: string | null
  onChangeModel?: (modelId: string) => void
  /** 当前输入区已附加的图片（data URL），用于控制发送按钮状态与提示 */
  attachedImageDataUrl?: string | null
  /** 选择图片并转换为 data URL 后的回调 */
  onAttachImage?: (dataUrl: string) => void
  /** 清除已附加图片 */
  onClearImage?: () => void
  /** Dify 方案：已上传成功的附件列表（含预览图 URL） */
  pendingAttachments?: UploadedFileRef[]
  /** 移除特定附件 */
  onRemoveAttachment?: (id: string) => void
  /** 是否正在上传中 */
  isUploading?: boolean
  /** 批量上传文件回调 */
  onUploadFiles?: (files: File[]) => void
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
  onStop,
  resetError,
  roles,
  activeRoleId,
  onChangeRole,
  models,
  activeModelId,
  onChangeModel,
  attachedImageDataUrl,
  onAttachImage,
  onClearImage,
  pendingAttachments,
  onRemoveAttachment,
  isUploading,
  onUploadFiles,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // 提取模型显示名称（去掉 provider 前缀）
  const getModelDisplayName = (modelId: string) => {
    // 处理形如 "provider/model" 或 "provider/model:version" 的格式
    const shortName = modelId.split('/').pop() || modelId
    return shortName
  }

  // 默认视觉提示词（用于图片-only场景）
  const DEFAULT_VISION_PROMPT = '解析图片并根据上下文回复图片中内容的含义'

  // 获取用户消息的显示内容（过滤掉默认提示词）
  const getUserDisplayContent = (content: string) => {
    // 如果是默认提示词，返回空字符串（只显示图片）
    if (content.trim() === DEFAULT_VISION_PROMPT) {
      return ''
    }
    return content
  }

  const handleToolClick = () => {
    console.warn('[AiChatBody] Upload button clicked')
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    console.warn('[AiChatBody] handleFileChange', { filesCount: files.length, hasOnUploadFiles: !!onUploadFiles })

    if (files.length === 0) return

    const images = files.filter(f => f.type.startsWith('image/'))
    if (images.length === 0) {
      console.warn('[AiChatBody] No image files selected')
      return
    }

    // 如果提供了批量上传回调，优先使用（Dify 方案）
    if (onUploadFiles) {
      console.warn('[AiChatBody] Using onUploadFiles (Dify path)')
      onUploadFiles(images)
      e.target.value = ''
      return
    }

    console.warn('[AiChatBody] Fast-track to onAttachImage (Legacy path)')
    // 传统方案：仅取第一张
    const file = images[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') {
        onAttachImage?.(result)
      }
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  return (
    <div className="modal-content ai-chat-body">
      <div
        className="ai-chat-messages"
        ref={messagesContainerRef}
      >
        {messages.length === 0 && !loading && (
          <div className="ai-chat-empty muted small"></div>
        )}
        {messages.map((msg) => {
          const displayContent =
            msg.role === 'assistant'
              ? getDisplayContent(msg.id, msg.content, msg.streaming)
              : getUserDisplayContent(msg.content)

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
        {/* 加载指示器：loading 且还没有助手消息返回任何内容时显示 */}
        {(() => {
          const hasAssistantContent = messages.some((m) => m.role === 'assistant' && m.content.length > 0)
          console.log('[AiChatBody] Loading indicator check:', { loading, hasAssistantContent, shouldShow: loading && !hasAssistantContent, messagesCount: messages.length })
          return loading && !hasAssistantContent ? (
            <div className="ai-chat-loading-indicator">
              <span className="ai-chat-spinner" aria-hidden="true" />
            </div>
          ) : null
        })()}
      </div>

      <form className="ai-chat-input" onSubmit={loading ? (e) => e.preventDefault() : onSubmit}>
        <div className="ai-chat-input-container">
          {((pendingAttachments && pendingAttachments.length > 0) || attachedImageDataUrl || isUploading) && (
            <div className="ai-chat-attachment-preview-bar">
              {pendingAttachments && pendingAttachments.map((att) => (
                <div key={att.id} className="ai-chat-attachment-item">
                  {att.sourceUrl && (
                    <img src={att.sourceUrl} alt={att.name} className="ai-chat-attachment-thumb" />
                  )}
                  <button
                    type="button"
                    className="ai-chat-attachment-remove"
                    onClick={() => onRemoveAttachment?.(att.id)}
                    title="移除图片"
                  >
                    ×
                  </button>
                </div>
              ))}
              {attachedImageDataUrl && (
                <div className="ai-chat-attachment-item">
                  <img src={attachedImageDataUrl} alt="已附加图片" className="ai-chat-attachment-thumb" />
                  <button
                    type="button"
                    className="ai-chat-attachment-remove"
                    onClick={() => onClearImage?.()}
                    title="移除图片"
                  >
                    ×
                  </button>
                </div>
              )}
              {isUploading && (
                <div className="ai-chat-attachment-item uploading">
                  <div className="ai-chat-attachment-loading-spinner" />
                </div>
              )}
            </div>
          )}
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
            placeholder="Ask anything to AI"
          />
          <div className="ai-chat-input-footer">
            <div className="ai-chat-input-tools-left">
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                ref={fileInputRef}
                onChange={handleFileChange}
              />
              <button
                type="button"
                className="ai-chat-tool-btn"
                title="上传图片"
                onClick={handleToolClick}
              >
                <span className="ai-chat-icon-plus" aria-hidden="true" />
              </button>
              <div className="ai-chat-input-badge ai-chat-role-badge">
                <span className="ai-chat-icon-chevron-up" aria-hidden="true" />
                <select
                  className="ai-chat-role-select-inline"
                  value={activeModelId ?? ''}
                  onChange={(e) => onChangeModel?.(e.target.value)}
                >
                  {models?.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.visionMode !== 'none' && m.visionMode !== undefined ? '👁️ ' : ''}
                      {getModelDisplayName(m.id)} ({m.providerName})
                    </option>
                  ))}
                </select>
              </div>
              <div className="ai-chat-input-badge ai-chat-role-badge">
                <span className="ai-chat-icon-chevron-up" aria-hidden="true" />
                <select
                  className="ai-chat-role-select-inline"
                  value={activeRoleId ?? ''}
                  onChange={(e) => onChangeRole?.(e.target.value)}
                >
                  {roles?.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="ai-chat-input-tools-right">
              <button
                className={`ai-chat-send-button ${loading ? 'loading' : ''}`}
                type={loading ? 'button' : 'submit'}
                onClick={() => {
                  if (loading) {
                    console.log('[AiChatBody] Stop button clicked')
                    onStop()
                  }
                }}
                title={loading ? '停止生成' : '发送'}
                disabled={!loading && !input.trim() && !attachedImageDataUrl && (pendingAttachments?.length ?? 0) === 0}
              >
                {loading ? (
                  <span className="ai-chat-icon-stop" aria-hidden="true" />
                ) : (
                  <span className="ai-chat-icon-arrow-right" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        </div>
        {error && (
          <div className="form-error" onClick={resetError}>
            {error.message}
          </div>
        )}
      </form>
    </div>
  )
}
