import type {
  FC,
  FormEvent,
  KeyboardEvent,
  RefObject,
  ChangeEvent,
  ClipboardEvent,
  CSSProperties,
} from 'react'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MarkdownViewer } from '../../../components/MarkdownViewer'
import type { ChatMessageView } from '../domain/chatSession'
import type { AssistantToolExecutionView } from '../domain/chatSession'
import type { VisionMode, UploadedFileRef } from '../domain/types'
import { useAiSlashCommandHints } from './hooks/useAiSlashCommandHints'
import { AiSlashCommandHintPanel } from './AiSlashCommandHintPanel'
import { BadgeSelect, type BadgeSelectGroup } from './BadgeSelect'
import { useThemeContext } from '../../theme/ThemeContext'
import {
  resolveAiChatEffectiveBackground,
  resolveManagedBackgroundImageUrl,
} from '../../theme/backgroundImageRuntime'
import { useI18n } from '../../i18n/I18nContext'
import { inferAttachmentKind, isPreviewableImage } from '../application/attachmentKind'

const FILE_INPUT_ACCEPT =
  'image/*,audio/*,.pdf,application/pdf,.txt,text/plain,.md,text/markdown,.csv,text/csv,.json,application/json,.doc,.docx,.xls,.xlsx,.ppt,.pptx'

type MessageViewMode = 'rendered' | 'source'

export interface AiChatBodyProps {
  messages: ChatMessageView[]
  activeDisplayAssistantId?: string | null
  historyIdentity?: string
  loading: boolean
  error: { message: string } | null
  input: string
  onInputChange: (value: string) => void
  onManualInputChange?: () => void
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
  onSaveToNotes?: (content: string) => void | Promise<void>
  onStop: () => void
  resetError: () => void
  roles?: { id: string; name: string }[]
  activeRoleId?: string
  onChangeRole?: (roleId: string) => void
  models?: { id: string; providerName: string; visionMode?: VisionMode }[]
  activeModelId?: string | null
  onChangeModel?: (modelId: string) => void
  agents?: { id: string; name: string }[]
  activeAgentId?: string | null
  onChangeAgent?: (agentId: string) => void
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
  /** Optional placeholder text for the input textarea */
  inputPlaceholder?: string
  isResizing?: boolean
  /** Full-page mode: centered input when empty, messages above input when not */
  fullPage?: boolean
}

const INITIAL_HISTORY_RENDER_COUNT = 5
const HISTORY_RENDER_INCREMENT = 10

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
  const showStreamingIndicator =
    msg.role === 'assistant' && msg.streaming && displayContent.trim().length === 0
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
          <button
            type="button"
            className="icon-button ai-chat-icon-button"
            title={copyMarkdownLabel}
            aria-label={copyMarkdownLabel}
            onClick={() => void onCopy(msg.content)}
          >
            <span className="ai-chat-icon ai-chat-icon-copy" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button ai-chat-icon-button"
            title={insertIntoEditorLabel}
            aria-label={insertIntoEditorLabel}
            onClick={() => void onInsert(msg.content)}
          >
            <span className="ai-chat-icon ai-chat-icon-insert" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button ai-chat-icon-button"
            title={replaceSelectionLabel}
            aria-label={replaceSelectionLabel}
            onClick={() => void onReplace(msg.content)}
          >
            <span className="ai-chat-icon ai-chat-icon-replace" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button ai-chat-icon-button"
            title={saveAsNewDocumentLabel}
            aria-label={saveAsNewDocumentLabel}
            onClick={() => void onSave(msg.content)}
          >
            <span className="ai-chat-icon ai-chat-icon-save" aria-hidden="true" />
          </button>
          {onSaveToNotes && (
            <button
              type="button"
              className="icon-button ai-chat-icon-button"
              title={saveToNotesLabel}
              aria-label={saveToNotesLabel}
              onClick={() => void onSaveToNotes(msg.content)}
            >
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

export const AiChatBody: FC<AiChatBodyProps> = ({
  messages,
  activeDisplayAssistantId,
  historyIdentity,
  loading,
  error,
  input,
  onInputChange,
  onManualInputChange,
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
  onSaveToNotes,
  onStop,
  resetError,
  roles,
  activeRoleId,
  onChangeRole,
  models,
  activeModelId,
  onChangeModel,
  agents,
  activeAgentId,
  onChangeAgent,
  attachedImageDataUrl,
  onAttachImage,
  onClearImage,
  pendingAttachments,
  onRemoveAttachment,
  isUploading,
  onUploadFiles,
  inputPlaceholder,
  isResizing = false,
  fullPage = false,
}) => {
  const { themeSettings } = useThemeContext()
  const { t } = useI18n()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [messageViewModes, setMessageViewModes] = useState<Record<string, MessageViewMode>>({})
  const [cursorIndex, setCursorIndex] = useState(input.length)
  const [renderCount, setRenderCount] = useState(INITIAL_HISTORY_RENDER_COUNT)
  const pendingPrependDeltaRef = useRef<number | null>(null)
  const aiChatBackground = useMemo(
    () => resolveAiChatEffectiveBackground(themeSettings),
    [themeSettings],
  )
  const visibleMessages = useMemo(
    () =>
      messages.filter((msg) => {
        if (msg.hidden) return false
        if (msg.role !== 'assistant') return true
        if (msg.streaming) return true
        if (msg.content.trim()) return true
        return (msg.toolExecutions?.length ?? 0) > 0
      }),
    [messages],
  )
  const latestDynamicAssistantId = useMemo(() => {
    if (activeDisplayAssistantId) return activeDisplayAssistantId
    return [...visibleMessages]
      .reverse()
      .find((msg) => msg.role === 'assistant' && msg.streaming)?.id ?? null
  }, [activeDisplayAssistantId, visibleMessages])
  const renderedMessages = useMemo(() => {
    if (visibleMessages.length <= renderCount) return visibleMessages
    return visibleMessages.slice(-renderCount)
  }, [visibleMessages, renderCount])
  const renderedStaticMessages = useMemo(
    () => renderedMessages.filter((msg) => msg.id !== latestDynamicAssistantId),
    [renderedMessages, latestDynamicAssistantId],
  )
  const renderedDynamicMessage = useMemo(
    () => renderedMessages.find((msg) => msg.id === latestDynamicAssistantId) ?? null,
    [renderedMessages, latestDynamicAssistantId],
  )

  useEffect(() => {
    setRenderCount(INITIAL_HISTORY_RENDER_COUNT)
    pendingPrependDeltaRef.current = null
  }, [historyIdentity])

  useEffect(() => {
    const el = messagesContainerRef.current
    if (!el) return

    const handleScroll = () => {
      if (el.scrollTop > 80) return
      if (visibleMessages.length <= renderCount) return
      pendingPrependDeltaRef.current = el.scrollHeight
      setRenderCount((prev) => Math.min(visibleMessages.length, prev + HISTORY_RENDER_INCREMENT))
    }

    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', handleScroll)
    }
  }, [messagesContainerRef, renderCount, visibleMessages.length])

  useLayoutEffect(() => {
    const previousScrollHeight = pendingPrependDeltaRef.current
    const el = messagesContainerRef.current
    if (!el || previousScrollHeight == null) return
    const delta = el.scrollHeight - previousScrollHeight
    el.scrollTop += delta
    pendingPrependDeltaRef.current = null
  }, [renderCount, messagesContainerRef])

  const aiChatBackgroundUrl = useMemo(() => {
    if (!aiChatBackground?.enabled || !aiChatBackground.path) return null
    return resolveManagedBackgroundImageUrl(aiChatBackground.path)
  }, [aiChatBackground])

  const aiChatBackgroundStyle = useMemo(() => {
    if (!aiChatBackground?.enabled || !aiChatBackground.path) return undefined
    return {
      '--ai-chat-bg-opacity': `${Math.min(Math.max(aiChatBackground.opacity, 0), 0.4)}`,
      '--ai-chat-bg-overlay-opacity': `${Math.min(Math.max(aiChatBackground.overlayOpacity ?? 0, 0), 1)}`,
      '--ai-chat-bg-blur': `${Math.min(Math.max(aiChatBackground.blurPx, 0), 24)}px`,
      '--ai-chat-bg-brightness': `${Math.min(Math.max(aiChatBackground.brightness, 0), 200)}%`,
      '--ai-chat-bg-position-x': `${Math.min(Math.max(aiChatBackground.positionX, 0), 100)}%`,
      '--ai-chat-bg-position-y': `${Math.min(Math.max(aiChatBackground.positionY, 0), 100)}%`,
    } as CSSProperties
  }, [aiChatBackground])

  const updateCursorIndex = (el: HTMLTextAreaElement) => {
    setCursorIndex(el.selectionStart ?? el.value.length)
  }

  const slashHints = useAiSlashCommandHints({ input, cursorIndex })

  // 提取模型显示名称（去掉 provider 前缀）
  const getModelDisplayName = (modelId: string) => {
    // 处理形如 "provider/model" 或 "provider/model:version" 的格式
    const shortName = modelId.split('/').pop() || modelId
    return shortName
  }

  const modelGroups: BadgeSelectGroup[] = useMemo(() => {
    const grouped = new Map<string, { id: string; label: string; options: { value: string; label: string }[] }>()
    for (const model of models ?? []) {
      const group = grouped.get(model.providerName) ?? {
        id: model.providerName,
        label: model.providerName,
        options: [],
      }
      group.options.push({
        value: model.id,
        label: `${getModelDisplayName(model.id)}${model.visionMode === 'enabled' ? '  👁' : ''}`,
      })
      grouped.set(model.providerName, group)
    }
    return Array.from(grouped.values())
  }, [models])
  const modelSelectDisabled = !!activeAgentId

  // 默认视觉提示词（用于图片-only场景）
  const DEFAULT_VISION_PROMPT = '请详细识别并描述这张图片中的内容。如果图片中包含文字、公式、表格、题目或文档，请先完整提取关键信息，再直接回答。若图片信息不足，请明确说明。'

  // 获取用户消息的显示内容（过滤掉默认提示词 & selection/file 上下文）
  const getUserDisplayContent = (content: string) => {
    const trimmed = content.trim()

    // 如果是默认视觉提示词，返回空字符串（只显示图片）
    if (trimmed === DEFAULT_VISION_PROMPT) {
      return ''
    }

    // 对于 selection/file 模式，首条 user 消息是：
    //   选中内容 + "\n\n根据以上问题回答：\n\n" + 用户真实问题
    // 这里只在展示层裁掉前面的上下文，只保留“根据以上问题回答：”之后的部分。
    const marker = '根据以上问题回答：'
    const idx = trimmed.indexOf(marker)
    if (idx !== -1) {
      const after = trimmed.slice(idx + marker.length).trim()
      if (after) {
        return after
      }
      // 如果确实没有额外问题（只发了选区作为上下文），那就不显示任何 user 文本。
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

    // 如果提供了批量上传回调，优先使用（Dify 方案）
    if (onUploadFiles) {
      const supportedFiles = files.filter((file) => inferAttachmentKind(file))
      if (supportedFiles.length === 0) {
        console.warn('[AiChatBody] No supported files selected')
        e.target.value = ''
        return
      }
      console.warn('[AiChatBody] Using onUploadFiles (Dify path)')
      onUploadFiles(supportedFiles)
      e.target.value = ''
      return
    }

    console.warn('[AiChatBody] Fast-track to onAttachImage (Legacy path)')
    // 传统方案：仅取第一张
    const file = files.find((candidate) => isPreviewableImage(candidate))
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

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    // AI Chat 输入框统一走 Tauri 原生粘贴桥：
    // - 文本：AiChatPane 中的 onNativePaste 负责写回受控 state
    // - 图片：AiChatPane 中的 onNativePasteImage 负责附加/上传
    // 这里必须阻止浏览器默认 paste，否则会和 native://paste 双写。
    e.preventDefault()
  }

  const handleTextareaKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // 处于 IME 合成阶段时不做任何特殊处理，交给浏览器/上层逻辑
    if ((e as any).nativeEvent?.isComposing) {
      return
    }

    // 当 slash 提示面板打开时，优先处理 Enter/Tab 作为“补全命令”而不是发送
    if (slashHints.isOpen && (e.key === 'Enter' || e.key === 'Tab')) {
      e.preventDefault()
      const replacement = slashHints.getReplacement()
      if (replacement && inputRef?.current) {
        const { start, end, text } = replacement
        const el = inputRef.current
        const value = el.value
        const next = value.slice(0, start) + text + value.slice(end)
        const caret = start + text.length
        onInputChange(next)
        setCursorIndex(caret)
        // 将光标移动到补全文本之后
        window.requestAnimationFrame(() => {
          inputRef.current?.setSelectionRange(caret, caret)
        })
      }
      slashHints.close()
      return
    }

    // 其次交给 slash 提示处理方向键 / Esc 等导航
    if (slashHints.handleKeyDown(e)) {
      return
    }

    // 剩余情况保持原有行为（历史导航、回车发送等）
    onInputKeyDown(e)
  }

  const hasMessages = visibleMessages.length > 0 || loading
  const fullPageClass = fullPage ? (hasMessages ? 'ai-chat-body-fullpage has-messages' : 'ai-chat-body-fullpage') : ''

  return (
    <div className={`modal-content ai-chat-body ${fullPageClass}`.trim()}>
      <div
        className={`ai-chat-messages ${aiChatBackgroundUrl ? 'has-ai-chat-background' : ''} ${isResizing ? 'is-ai-chat-resizing' : ''} ai-chat-bg-fit-${aiChatBackground?.size ?? 'cover'}`}
        style={aiChatBackgroundStyle}
      >
        {aiChatBackgroundUrl ? (
          <>
            <img
              className="ai-chat-messages-background"
              src={aiChatBackgroundUrl}
              alt=""
              aria-hidden="true"
            />
            <div className="ai-chat-messages-background-overlay" aria-hidden="true" />
          </>
        ) : null}
        <div className="ai-chat-messages-scroll" ref={messagesContainerRef}>
          <div className="ai-chat-messages-content">
            {visibleMessages.length === 0 && !loading && (
              <div className="ai-chat-empty muted small"></div>
            )}
            {renderedStaticMessages.map((msg) => {
              const viewMode: MessageViewMode = messageViewModes[msg.id] ?? 'rendered'
              const displayContent =
                msg.role === 'assistant'
                  ? msg.content
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
                  toolExecutionDetailsLabel={t('ai.toolExecutionDetails')}
                  copyMarkdownLabel={t('ai.copyMarkdown')}
                  insertIntoEditorLabel={t('ai.insertIntoEditor')}
                  replaceSelectionLabel={t('ai.replaceSelection')}
                  saveAsNewDocumentLabel={t('ai.saveAsNewDocument')}
                  saveToNotesLabel={t('notes.saveToNotes')}
                  showRenderedMarkdownLabel={t('ai.showRenderedMarkdown')}
                  viewMarkdownSourceLabel={t('ai.viewMarkdownSource')}
                  summaryPreservedUserInputLabel={t('ai.summaryPreservedUserInput')}
                />
              )
            })}
            {renderedDynamicMessage && (() => {
              const msg = renderedDynamicMessage
              const viewMode: MessageViewMode = messageViewModes[msg.id] ?? 'rendered'
              const displayContent =
                msg.role === 'assistant'
                  ? (viewMode === 'source'
                    ? msg.content
                    : getDisplayContent(msg.id, msg.content, msg.streaming))
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
                  toolExecutionDetailsLabel={t('ai.toolExecutionDetails')}
                  copyMarkdownLabel={t('ai.copyMarkdown')}
                  insertIntoEditorLabel={t('ai.insertIntoEditor')}
                  replaceSelectionLabel={t('ai.replaceSelection')}
                  saveAsNewDocumentLabel={t('ai.saveAsNewDocument')}
                  saveToNotesLabel={t('notes.saveToNotes')}
                  showRenderedMarkdownLabel={t('ai.showRenderedMarkdown')}
                  viewMarkdownSourceLabel={t('ai.viewMarkdownSource')}
                  summaryPreservedUserInputLabel={t('ai.summaryPreservedUserInput')}
                />
              )
            })()}
          </div>
        </div>
      </div>

      <form className="ai-chat-input" onSubmit={loading ? (e) => e.preventDefault() : onSubmit}>
        <div className="ai-chat-input-container">
          {slashHints.isOpen && (
            <AiSlashCommandHintPanel
              items={slashHints.items}
              activeIndex={slashHints.activeIndex}
              onItemClick={(idx) => {
                const replacement = slashHints.getReplacement(idx)
                if (!replacement || !inputRef?.current) return
                const { start, end, text } = replacement
                const el = inputRef.current
                const value = el.value
                const next = value.slice(0, start) + text + value.slice(end)
                onInputChange(next)
                window.requestAnimationFrame(() => {
                  const caret = start + text.length
                  inputRef.current?.setSelectionRange(caret, caret)
                })
                slashHints.close()
              }}
            />
          )}
          {((pendingAttachments && pendingAttachments.length > 0) || attachedImageDataUrl || isUploading) && (
            <div className="ai-chat-attachment-preview-bar">
              {pendingAttachments && pendingAttachments.map((att) => (
                <div key={att.id} className="ai-chat-attachment-item" title={att.name}>
                  {att.sourceUrl && att.kind === 'image' && (
                    <img src={att.sourceUrl} alt={att.name} className="ai-chat-attachment-thumb" />
                  )}
                  {att.kind !== 'image' && (
                    <div className="ai-chat-attachment-thumb ai-chat-attachment-file-badge">
                      <span>{att.name.split('.').pop()?.toUpperCase() ?? 'FILE'}</span>
                    </div>
                  )}
                  <button
                    type="button"
                    className="ai-chat-attachment-remove"
                    onClick={() => onRemoveAttachment?.(att.id)}
                    title={t('ai.removeImage')}
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
                    title={t('ai.removeImage')}
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
              updateCursorIndex(e.target)
              onManualInputChange?.()
              onInputChange(e.target.value)
            }}
            onClick={(e) => {
              updateCursorIndex(e.currentTarget)
            }}
            onKeyUp={(e) => {
              updateCursorIndex(e.currentTarget)
            }}
            onKeyDown={handleTextareaKeyDown}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={onCompositionEnd}
            onPaste={handlePaste}
            placeholder={inputPlaceholder ?? t('ai.askAnything')}
          />
          <div className="ai-chat-input-footer">
            <div className="ai-chat-input-tools-left">
              <input
                type="file"
                accept={FILE_INPUT_ACCEPT}
                style={{ display: 'none' }}
                ref={fileInputRef}
                onChange={handleFileChange}
              />
              <button
                type="button"
                className="ai-chat-tool-btn"
                title={t('ai.uploadImage')}
                onClick={handleToolClick}
              >
                <span className="ai-chat-icon-plus" aria-hidden="true" />
              </button>
              <BadgeSelect
                options={(models ?? []).map((m) => ({
                  value: m.id,
                  label: `${getModelDisplayName(m.id)} (${m.providerName})${m.visionMode === 'enabled' ? '  👁' : ''}`,
                }))}
                groups={modelGroups}
                value={activeModelId ?? ''}
                disabled={modelSelectDisabled}
                title={modelSelectDisabled ? '已选择 Agent，当前请求不使用模型多轮链路' : undefined}
                onChange={(v) => onChangeModel?.(v)}
              />
              <BadgeSelect
                options={(roles ?? []).map((role) => ({
                  value: role.id,
                  label: role.name,
                }))}
                value={activeRoleId ?? ''}
                onChange={(v) => onChangeRole?.(v)}
              />
              {!!agents?.length && (
                <BadgeSelect
                  options={agents.map((agent) => ({
                    value: agent.id,
                    label: agent.name,
                  }))}
                  value={activeAgentId ?? ''}
                  onChange={(v) => onChangeAgent?.(v)}
                />
              )}
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
                title={loading ? t('ai.stopGenerating') : t('ai.send')}
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
