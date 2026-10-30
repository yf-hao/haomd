import { getPerformanceSettings } from '../../settings/editorSettings'
import { subscribePerformanceSettingsChanged } from '../../settings/performanceRuntime'
import { chatScrollController } from './chatScrollController'
import { chatScrollDebug } from './chatScrollDebug'
import type {
  FC,
  FormEvent,
  KeyboardEvent,
  ProfilerOnRenderCallback,
  RefObject,
  CSSProperties,
} from 'react'
import { Profiler, startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import { AI_CHAT_VIRTUALIZATION_THRESHOLD } from './AiChatVirtualMessageList'

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
  inputRef?: RefObject<HTMLTextAreaElement | null>
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

const INITIAL_VISIBLE_HISTORY_COUNT = 10
const HISTORY_PRELOAD_COUNT = 20
const HISTORY_RENDER_INCREMENT = 20
const INITIAL_HISTORY_RENDER_COUNT = INITIAL_VISIBLE_HISTORY_COUNT + HISTORY_PRELOAD_COUNT

type ChatReadingAnchor = {
  id: string
  top: number
  rowTop: number
  element: HTMLElement
}

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
  const [virtualizationEnabled, setVirtualizationEnabled] = useState(false)
  const modeRef = useRef(false)
  const [switchAnchor, setSwitchAnchor] = useState<{ id: string; top: number } | null>(null)
  const pendingModeRestore = useRef(false)
  const pendingPrependDeltaRef = useRef<ChatReadingAnchor | null>(null)
  const readingAnchorRef = useRef<ChatReadingAnchor | null>(null)
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
  const visibleRef = useRef(visibleMessages)
  visibleRef.current = visibleMessages
  const virtualized = virtualizationEnabled && visibleMessages.length > AI_CHAT_VIRTUALIZATION_THRESHOLD
  useEffect(() => {
    let active = true
    let changed = false
    const apply = (enabled: boolean) => {
      if (!active || modeRef.current === enabled) return
      const container = messagesContainerRef.current
      let anchor: { id: string; top: number } | null = null
      if (container) {
        const controller = chatScrollController(container)
        controller.cancel()
        if (!controller.follow.current) {
          const rect = container.getBoundingClientRect()
          const row = Array.from(container.querySelectorAll<HTMLElement>('[data-chat-message-id]'))
            .find(element => element.getBoundingClientRect().bottom > rect.top)
          if (row) anchor = { id: row.dataset.chatMessageId!, top: row.getBoundingClientRect().top - rect.top }
        }
      }
      if (anchor && !enabled) {
        const index = visibleRef.current.findIndex(message => message.id === anchor!.id)
        if (index >= 0) setRenderCount(count => Math.max(count, visibleRef.current.length - index + 1))
      }
      setSwitchAnchor(anchor)
      pendingModeRestore.current = true
      modeRef.current = enabled
      setVirtualizationEnabled(enabled)
    }
    const unsubscribe = subscribePerformanceSettingsChanged(settings => {
      changed = true
      apply(settings.aiChatVirtualization === true)
    })
    void getPerformanceSettings().then(settings => { if (!changed) apply(settings.aiChatVirtualization === true) })
    return () => { active = false; unsubscribe() }
  }, [messagesContainerRef])

  useLayoutEffect(() => {
    if (!pendingModeRestore.current) return
    pendingModeRestore.current = false
    const container = messagesContainerRef.current
    if (!container) return
    const controller = chatScrollController(container)
    if (controller.follow.current) { controller.scheduleBottom(); return }
    if (!virtualized && switchAnchor) {
      const row = Array.from(container.querySelectorAll<HTMLElement>('[data-chat-message-id]'))
        .find(element => element.dataset.chatMessageId === switchAnchor.id)
      if (row) controller.write(container.scrollTop + row.getBoundingClientRect().top - container.getBoundingClientRect().top - switchAnchor.top)
    }
  }, [virtualizationEnabled, virtualized, switchAnchor, messagesContainerRef])

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
    chatScrollDebug('history rows committed', messagesContainerRef.current, {
      historyIdentity,
      visibleCount: visibleMessages.length,
      renderCount,
      renderedCount: renderedMessages.length,
      firstRenderedId: renderedMessages[0]?.id,
      lastRenderedId: renderedMessages.at(-1)?.id,
      virtualized,
    })
  }, [historyIdentity, messagesContainerRef, renderCount, renderedMessages, virtualized, visibleMessages.length])

  const captureReadingAnchor = useCallback((container: HTMLElement) => {
    const bounds = container.getBoundingClientRect()
    const row = Array.from(container.querySelectorAll<HTMLElement>('[data-chat-message-id]'))
      .find(element => {
        const rect = element.getBoundingClientRect()
        return rect.bottom > bounds.top && rect.top < bounds.bottom
      })
    if (!row) return null
    const rowBounds = row.getBoundingClientRect()
    const probeY = Math.min(bounds.bottom - 1, Math.max(bounds.top + 1, rowBounds.top + 1))
    const hit = document.elementFromPoint(bounds.left + bounds.width / 2, probeY)
    const visibleBlock = hit instanceof HTMLElement && row.contains(hit)
      ? hit.closest<HTMLElement>('pre, p, li, img, table, blockquote, h1, h2, h3, h4, h5, h6')
      : null
    const element = visibleBlock ?? row
    const anchor = {
      id: row.dataset.chatMessageId!,
      top: element.getBoundingClientRect().top - bounds.top,
      rowTop: row.getBoundingClientRect().top - bounds.top,
      element,
    }
    readingAnchorRef.current = anchor
    return anchor
  }, [])

  // Keep the reader's visible message fixed while Markdown, code blocks, or images
  // finish changing the heights of messages above it.
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container || typeof ResizeObserver === 'undefined') return
    let frame: number | null = null
    const observed = new WeakSet<Element>()
    const resize = new ResizeObserver(entries => {
      const anchor = readingAnchorRef.current
      chatScrollDebug('message rows resized', container, {
        rows: entries.map(entry => ({
          id: (entry.target as HTMLElement).dataset.chatMessageId,
          height: Math.round(entry.contentRect.height * 10) / 10,
        })),
        anchorId: anchor?.id,
        anchorElement: anchor?.element.tagName.toLowerCase(),
      })
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        const anchor = readingAnchorRef.current
        const controller = chatScrollController(container)
        if (!anchor || controller.follow.current) return
        const row = Array.from(container.querySelectorAll<HTMLElement>('[data-chat-message-id]'))
          .find(element => element.dataset.chatMessageId === anchor.id)
        if (!row) return
        const hasAnchorElement = anchor.element.isConnected && row.contains(anchor.element)
        const element = hasAnchorElement ? anchor.element : row
        const top = element.getBoundingClientRect().top - container.getBoundingClientRect().top
        const expectedTop = hasAnchorElement ? anchor.top : anchor.rowTop
        const delta = top - expectedTop
        if (Math.abs(delta) >= 0.5) {
          chatScrollDebug('message resize anchor compensation', container, { id: anchor.id, anchorElement: `${element.tagName.toLowerCase()}${element.className && typeof element.className === 'string' ? `.${element.className.trim().replace(/\s+/g, '.')}` : ''}`, previousTop: anchor.top, currentTop: top, delta, follow: controller.follow.current })
          controller.write(container.scrollTop + delta, 'AiChatBody.ResizeObserver')
        }
        readingAnchorRef.current = {
          id: anchor.id,
          top: element.getBoundingClientRect().top - container.getBoundingClientRect().top,
          rowTop: row.getBoundingClientRect().top - container.getBoundingClientRect().top,
          element,
        }
      })
    })
    const observeRows = () => {
      for (const row of container.querySelectorAll('[data-chat-message-id]')) {
        if (observed.has(row)) continue
        observed.add(row)
        resize.observe(row)
      }
    }
    observeRows()
    const mutations = new MutationObserver(observeRows)
    mutations.observe(container, { childList: true, subtree: true })
    return () => {
      mutations.disconnect()
      resize.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [messagesContainerRef])

  useEffect(() => {
    setRenderCount(INITIAL_HISTORY_RENDER_COUNT)
    pendingPrependDeltaRef.current = null
    readingAnchorRef.current = null
    setSwitchAnchor(null)
  }, [historyIdentity])

  const loadEarlier = useCallback(() => {
    const el = messagesContainerRef.current
    if (!el || virtualized || visibleMessages.length <= renderCount || pendingPrependDeltaRef.current) return
    const anchor = captureReadingAnchor(el)
    chatScrollDebug('load earlier batch', el, { renderCount, nextRenderCount: Math.min(visibleMessages.length, renderCount + HISTORY_RENDER_INCREMENT), visibleCount: visibleMessages.length, anchor })
    if (anchor) pendingPrependDeltaRef.current = anchor
    chatScrollController(el).pause()
    // Rendering a batch of Markdown messages can block wheel events. Let React
    // yield to scrolling while it prepares the older rows.
    startTransition(() => {
      setRenderCount(prev => Math.min(visibleMessages.length, prev + HISTORY_RENDER_INCREMENT))
    })
  }, [captureReadingAnchor, messagesContainerRef, renderCount, visibleMessages.length, virtualized])

  useEffect(() => {
    const el = messagesContainerRef.current
    if (!el) return
    const scroll = () => {
      const anchor = captureReadingAnchor(el)
      if (anchor) readingAnchorRef.current = anchor
      if (virtualized || chatScrollController(el).follow.current || visibleMessages.length <= renderCount) return
      const preloadedRows = Array.from(el.querySelectorAll<HTMLElement>('[data-chat-message-id]'))
        .slice(0, HISTORY_PRELOAD_COUNT)
      const preloadHeight = preloadedRows.reduce((height, row) => height + row.getBoundingClientRect().height, 0)
      if (preloadedRows.length > 0 && el.scrollTop <= preloadHeight) loadEarlier()
    }
    el.addEventListener('scroll', scroll, { passive: true })
    return () => el.removeEventListener('scroll', scroll)
  }, [captureReadingAnchor, messagesContainerRef, loadEarlier])

  useLayoutEffect(() => {
    const capturedAnchor = pendingPrependDeltaRef.current
    const el = messagesContainerRef.current
    if (!el || !capturedAnchor) return
    // Scrolling can continue while a concurrent render is in progress. Restore
    // the latest reader anchor instead of the position captured at batch start.
    const anchor = readingAnchorRef.current ?? capturedAnchor
    const row = Array.from(el.querySelectorAll<HTMLElement>('[data-chat-message-id]'))
      .find(element => element.dataset.chatMessageId === anchor.id)
    if (row) {
      const hasAnchorElement = anchor.element.isConnected && row.contains(anchor.element)
      const element = hasAnchorElement ? anchor.element : row
      const actualTop = element.getBoundingClientRect().top - el.getBoundingClientRect().top
      const delta = actualTop - (hasAnchorElement ? anchor.top : anchor.rowTop)
      chatScrollDebug('prepend anchor compensation', el, { id: anchor.id, capturedId: capturedAnchor.id, capturedTop: capturedAnchor.top, expectedTop: anchor.top, actualTop, delta, renderCount })
      chatScrollController(el).write(el.scrollTop + delta, 'AiChatBody.prependRestore')
    }
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
  const onMessagesProfilerRender = useCallback<ProfilerOnRenderCallback>((id, phase, actualDuration, baseDuration) => {
    if (!import.meta.env.DEV || actualDuration < 8) return
    console.debug('[AiChatPerf]', {
      id,
      phase,
      actualDuration: Number(actualDuration.toFixed(2)),
      baseDuration: Number(baseDuration.toFixed(2)),
      messageCount: visibleMessages.length,
    })
  }, [visibleMessages.length])

  return (
    <div className={`modal-content ai-chat-body ${fullPageClass}`.trim()}>
      <Profiler id="ai-chat-messages" onRender={onMessagesProfilerRender}>
        <AiChatMessagesPane
          visibleMessages={visibleMessages}
          renderedMessages={renderedMessages}
          ephemeralMessages={ephemeralMessages}
          onLoadEarlier={!virtualized && renderCount < visibleMessages.length ? loadEarlier : undefined}
          loadEarlierLabel={t('ai.loadEarlier')}
          virtualized={virtualized}
          initialAnchor={switchAnchor}
          initialScrollKey={historyIdentity}
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
      </Profiler>

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
