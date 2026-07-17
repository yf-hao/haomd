import type {
  FC,
  FormEvent,
  KeyboardEvent,
  RefObject,
  CSSProperties,
} from 'react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChatMessageView } from '../domain/chatSession'
import type { VisionMode, UploadedFileRef } from '../domain/types'
import type {
  AiChatAgentMode,
  EphemeralAiChatMessage,
  EphemeralImageGenerationResultMessage,
} from './imageGenerationEphemeral'
import type { BadgeSelectGroup } from './BadgeSelect'
import { useThemeContext } from '../../theme/ThemeContext'
import {
  resolveAiChatEffectiveBackground,
  resolveManagedBackgroundImageUrl,
} from '../../theme/backgroundImageRuntime'
import { useI18n } from '../../i18n/I18nContext'
import { AiChatComposer } from './AiChatComposer'
import type { AiChatComposerHandle } from './AiChatComposer'
import { AiChatMessagesPane } from './AiChatMessagesPane'
import type { MessageViewMode } from './AiChatMessagesPane'

export interface AiChatBodyProps {
  messages: ChatMessageView[]
  ephemeralMessages?: EphemeralAiChatMessage[]
  agentMode?: AiChatAgentMode
  activeDisplayAssistantId?: string | null
  historyIdentity?: string
  loading: boolean
  error: { message: string } | null
  onDraftChange?: () => void
  onSubmit: (e: FormEvent<HTMLFormElement>) => void
  onInputKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  onInputFocusChange?: (focused: boolean) => void
  onCompositionStart?: () => void
  onCompositionEnd?: () => void
  inputRef?: RefObject<HTMLTextAreaElement>
  composerHandleRef?: import('react').Ref<AiChatComposerHandle>
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
  agentGroups?: BadgeSelectGroup[]
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
  imageGenerationRunning?: boolean
  onCopyImageUrl?: (message: EphemeralImageGenerationResultMessage) => void | Promise<void>
  onCopyImageMarkdown?: (message: EphemeralImageGenerationResultMessage) => void | Promise<void>
  onSaveGeneratedImage?: (message: EphemeralImageGenerationResultMessage) => void | Promise<void>
  onInsertGeneratedImage?: (message: EphemeralImageGenerationResultMessage) => void | Promise<void>
  onSaveGeneratedImageToNotes?: (message: EphemeralImageGenerationResultMessage) => void | Promise<void>
  isResizing?: boolean
  /** Full-page mode: centered input when empty, messages above input when not */
  fullPage?: boolean
}

const INITIAL_HISTORY_RENDER_COUNT = 5
const HISTORY_RENDER_INCREMENT = 10

export const AiChatBody: FC<AiChatBodyProps> = ({
  messages,
  ephemeralMessages = [],
  agentMode = 'chat',
  activeDisplayAssistantId,
  historyIdentity,
  loading,
  error,
  onDraftChange,
  onSubmit,
  onInputKeyDown,
  onInputFocusChange,
  onCompositionStart,
  onCompositionEnd,
  inputRef,
  composerHandleRef,
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
  agentGroups,
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
  imageGenerationRunning = false,
  onCopyImageUrl,
  onCopyImageMarkdown,
  onSaveGeneratedImage,
  onInsertGeneratedImage,
  onSaveGeneratedImageToNotes,
  isResizing = false,
  fullPage = false,
}) => {
  const { themeSettings } = useThemeContext()
  const { t } = useI18n()
  const [messageViewModes, setMessageViewModes] = useState<Record<string, MessageViewMode>>({})
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

  const hasMessages = visibleMessages.length > 0 || loading
  const hasEphemeralMessages = ephemeralMessages.length > 0
  const fullPageClass = fullPage ? ((hasMessages || hasEphemeralMessages) ? 'ai-chat-body-fullpage has-messages' : 'ai-chat-body-fullpage') : ''

  return (
    <div className={`modal-content ai-chat-body ${fullPageClass}`.trim()}>
      <AiChatMessagesPane
        visibleMessages={visibleMessages}
        renderedMessages={renderedMessages}
        ephemeralMessages={ephemeralMessages}
        loading={loading}
        isResizing={isResizing}
        aiChatBackgroundUrl={aiChatBackgroundUrl}
        aiChatBackgroundStyle={aiChatBackgroundStyle}
        aiChatBackgroundSize={aiChatBackground?.size ?? 'cover'}
        messagesContainerRef={messagesContainerRef}
        messageViewModes={messageViewModes}
        latestDynamicAssistantId={latestDynamicAssistantId}
        getDisplayContent={getDisplayContent}
        onCopy={onCopy}
        onInsert={onInsert}
        onReplace={onReplace}
        onSave={onSave}
        onSaveToNotes={onSaveToNotes}
        setMessageViewModes={setMessageViewModes}
        toolExecutionDetailsLabel={t('ai.toolExecutionDetails')}
        copyMarkdownLabel={t('ai.copyMarkdown')}
        insertIntoEditorLabel={t('ai.insertIntoEditor')}
        replaceSelectionLabel={t('ai.replaceSelection')}
        saveAsNewDocumentLabel={t('ai.saveAsNewDocument')}
        saveToNotesLabel={t('notes.saveToNotes')}
        showRenderedMarkdownLabel={t('ai.showRenderedMarkdown')}
        viewMarkdownSourceLabel={t('ai.viewMarkdownSource')}
        summaryPreservedUserInputLabel={t('ai.summaryPreservedUserInput')}
        imageGenerationTemporaryLabel={t('ai.imageGenerationTemporary')}
        imageGenerationRunningLabel={t('imageGeneration.running')}
        imageGenerationFailedLabel={t('ai.imageGenerationFailed')}
        imageGenerationResultAltLabel={t('imageGeneration.resultAlt')}
        imageGenerationCopyUrlLabel={t('imageGeneration.copyUrl')}
        imageGenerationCopyMarkdownLabel={t('imageGeneration.copyMarkdown')}
        imageGenerationSaveLocalLabel={t('imageGeneration.saveLocal')}
        imageGenerationInsertEditorLabel={t('imageGeneration.insertEditor')}
        imageGenerationSaveToNotesLabel={t('imageGeneration.saveToNotes')}
        imageGenerationTaskIdLabelTemplate={t('imageGeneration.taskIdLabel', { taskId: '{taskId}' })}
        onCopyImageUrl={onCopyImageUrl}
        onCopyImageMarkdown={onCopyImageMarkdown}
        onSaveGeneratedImage={onSaveGeneratedImage}
        onInsertGeneratedImage={onInsertGeneratedImage}
        onSaveGeneratedImageToNotes={onSaveGeneratedImageToNotes}
      />

      <AiChatComposer
        historyIdentity={historyIdentity}
        loading={loading}
        agentMode={agentMode}
        onSubmit={onSubmit}
        onInputKeyDown={onInputKeyDown}
        onInputFocusChange={onInputFocusChange}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        inputRef={inputRef}
        composerHandleRef={composerHandleRef}
        onDraftChange={onDraftChange}
        inputPlaceholder={inputPlaceholder}
        roles={roles}
        activeRoleId={activeRoleId}
        onChangeRole={onChangeRole}
        models={models}
        activeModelId={activeModelId}
        onChangeModel={onChangeModel}
        agents={agents}
        agentGroups={agentGroups}
        activeAgentId={activeAgentId}
        onChangeAgent={onChangeAgent}
        attachedImageDataUrl={attachedImageDataUrl}
        pendingAttachmentsLength={pendingAttachments?.length ?? 0}
        onAttachImage={onAttachImage}
        onClearImage={onClearImage}
        pendingAttachments={pendingAttachments}
        onRemoveAttachment={onRemoveAttachment}
        isUploading={isUploading}
        onUploadFiles={onUploadFiles}
        imageGenerationRunning={imageGenerationRunning}
        onStop={onStop}
      />
      {error && (
        <div className="form-error" onClick={resetError}>
          {error.message}
        </div>
      )}
    </div>
  )
}
