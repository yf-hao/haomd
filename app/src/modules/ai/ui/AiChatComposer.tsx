import type {
  ChangeEvent,
  ClipboardEvent,
  FormEvent,
  KeyboardEvent,
  Ref,
  RefObject,
} from 'react'
import { memo, useCallback, useDeferredValue, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AiSlashCommandHintPanel } from './AiSlashCommandHintPanel'
import { BadgeSelect, type BadgeSelectGroup } from './BadgeSelect'
import { useAiSlashCommandHints } from './hooks/useAiSlashCommandHints'
import type { AiChatAgentMode } from './imageGenerationEphemeral'
import type { UploadedFileRef, VisionMode } from '../domain/types'
import { useI18n } from '../../i18n/I18nContext'
import { inferAttachmentKind, isPreviewableImage } from '../application/attachmentKind'

const FILE_INPUT_ACCEPT =
  'image/*,audio/*,.pdf,application/pdf,.txt,text/plain,.md,text/markdown,.csv,text/csv,.json,application/json,.doc,.docx,.xls,.xlsx,.ppt,.pptx'
const ENABLE_INPUT_LATENCY_DEBUG = true

function resolveSlashCursorIndex(value: string, selectionStart: number | null | undefined): number | null {
  if (!value) return null
  const safeCursor = Math.max(0, Math.min(selectionStart ?? value.length, value.length))
  const lastNewline = value.lastIndexOf('\n', safeCursor - 1)
  const lineStart = lastNewline === -1 ? 0 : lastNewline + 1
  const prefix = value.slice(lineStart, safeCursor)
  return /^\/\S*$/.test(prefix) ? safeCursor : null
}

export interface AiChatComposerHandle {
  getDraft: () => string
  setDraft: (value: string, caret?: number | null) => void
  clearDraft: () => void
  focus: () => void
}

export interface AiChatComposerProps {
  historyIdentity?: string
  loading: boolean
  agentMode?: AiChatAgentMode
  onSubmit: (e: FormEvent<HTMLFormElement>) => void
  onInputKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  onInputFocusChange?: (focused: boolean) => void
  onCompositionStart?: () => void
  onCompositionEnd?: () => void
  inputRef?: RefObject<HTMLTextAreaElement | null>
  composerHandleRef?: Ref<AiChatComposerHandle>
  onDraftChange?: () => void
  inputPlaceholder?: string
  onChangeRole?: (roleId: string) => void
  onChangeModel?: (modelId: string) => void
  onChangeAgent?: (agentId: string) => void
  roles?: { id: string; name: string }[]
  activeRoleId?: string
  models?: { id: string; providerName: string; visionMode?: VisionMode }[]
  activeModelId?: string | null
  agents?: { id: string; name: string }[]
  agentGroups?: BadgeSelectGroup[]
  activeAgentId?: string | null
  attachedImageDataUrl?: string | null
  pendingAttachmentsLength: number
  onAttachImage?: (dataUrl: string) => void
  onClearImage?: () => void
  pendingAttachments?: UploadedFileRef[]
  onRemoveAttachment?: (id: string) => void
  isUploading?: boolean
  onUploadFiles?: (files: File[]) => void
  imageGenerationRunning?: boolean
  onStop: () => void
  onCopyImageUrl?: never
  onCopyImageMarkdown?: never
  onSaveGeneratedImage?: never
  onInsertGeneratedImage?: never
  onSaveGeneratedImageToNotes?: never
  fullPage?: boolean
  isResizing?: boolean
}

type ComposerState = {
  draft: string
  cursorIndex: number | null
}

const AiChatComposerToolbar = memo(({
  loading,
  agentMode,
  onStop,
  onChangeRole,
  onChangeModel,
  onChangeAgent,
  activeRoleId,
  activeModelId,
  agents,
  agentGroups,
  activeAgentId,
  imageGenerationRunning,
  attachedImageDataUrl,
  pendingAttachmentsLength,
  t,
  modelGroups,
  roleOptions,
  agentOptions,
  modelSelectDisabled,
  handleToolClick,
  fileInputRef,
  onFileChange,
}: {
  loading: boolean
  agentMode: AiChatAgentMode
  onStop: () => void
  onChangeRole?: (roleId: string) => void
  onChangeModel?: (modelId: string) => void
  onChangeAgent?: (agentId: string) => void
  activeRoleId?: string
  activeModelId?: string | null
  agents?: { id: string; name: string }[]
  agentGroups?: BadgeSelectGroup[]
  activeAgentId?: string | null
  imageGenerationRunning?: boolean
  attachedImageDataUrl?: string | null
  pendingAttachmentsLength: number
  t: (key: string, params?: Record<string, string | number>) => string
  modelGroups: BadgeSelectGroup[]
  roleOptions: { value: string; label: string }[]
  agentOptions: { value: string; label: string }[]
  modelSelectDisabled: boolean
  handleToolClick: () => void
  fileInputRef: RefObject<HTMLInputElement | null>
  onFileChange: (e: ChangeEvent<HTMLInputElement>) => void
}) => {
  return (
    <div className="ai-chat-input-footer">
      <div className="ai-chat-input-tools-left">
        <input
          type="file"
          accept={FILE_INPUT_ACCEPT}
          style={{ display: 'none' }}
          ref={fileInputRef}
          onChange={onFileChange}
        />
        <button
          type="button"
          className="ai-chat-tool-btn"
          title={t('ai.uploadImage')}
          onClick={handleToolClick}
          disabled={agentMode === 'image_generation'}
        >
          <span className="ai-chat-icon-plus" aria-hidden="true" />
        </button>
        {agentMode === 'chat' && (
          <>
            <BadgeSelect
              options={[]}
              groups={modelGroups}
              value={activeModelId ?? ''}
              disabled={modelSelectDisabled}
              title={modelSelectDisabled ? '已选择 Agent，当前请求不使用模型多轮链路' : undefined}
              onChange={(v) => onChangeModel?.(v)}
            />
            <BadgeSelect
              options={roleOptions}
              value={activeRoleId ?? ''}
              onChange={(v) => onChangeRole?.(v)}
            />
          </>
        )}
        {!!agents?.length && (
          <BadgeSelect
            options={agentOptions}
            groups={agentGroups}
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
            if (loading) onStop()
          }}
          title={loading ? t('ai.stopGenerating') : t('ai.send')}
          disabled={
            imageGenerationRunning
            || (!loading
              && (
                agentMode === 'image_generation'
                  ? false
                  : (!pendingAttachmentsLength && !attachedImageDataUrl)
              ))
          }
        >
          {loading ? (
            <span className="ai-chat-icon-stop" aria-hidden="true" />
          ) : (
            <span className="ai-chat-icon-arrow-right" aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  )
})

export const AiChatComposer = memo(function AiChatComposer({
  historyIdentity,
  loading,
  agentMode = 'chat',
  onSubmit,
  onInputKeyDown,
  onInputFocusChange,
  onCompositionStart,
  onCompositionEnd,
  inputRef,
  composerHandleRef,
  onDraftChange,
  inputPlaceholder,
  onChangeRole,
  onChangeModel,
  onChangeAgent,
  roles,
  activeRoleId,
  models,
  activeModelId,
  agents,
  agentGroups,
  activeAgentId,
  attachedImageDataUrl,
  onAttachImage,
  onClearImage,
  pendingAttachments,
  onRemoveAttachment,
  isUploading,
  onUploadFiles,
  imageGenerationRunning = false,
  onStop,
}: AiChatComposerProps) {
  const { t } = useI18n()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const autoResizeTimerRef = useRef<number | null>(null)
  const autoResizeHeightRef = useRef<number | null>(null)
  const isComposingRef = useRef(false)
  const compositionEndFlushTokenRef = useRef(0)
  const compositionEndCommitPendingRef = useRef(false)
  const draftSelectionRef = useRef<{ start: number; end: number } | null>(null)
  const textareaValueRef = useRef('')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [composerState, setComposerState] = useState<ComposerState>({ draft: '', cursorIndex: null })
  const draft = composerState.draft
  const cursorIndex = composerState.cursorIndex

  const autoResizeInput = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    const maxHeight = 120
    const next = Math.min(maxHeight, el.scrollHeight)
    if (autoResizeHeightRef.current === next) {
      return
    }
    el.style.height = `${next}px`
    autoResizeHeightRef.current = next
  }, [inputRef])

  const scheduleAutoResize = useCallback((force = false) => {
    if (force) {
      if (autoResizeTimerRef.current != null) {
        window.clearTimeout(autoResizeTimerRef.current)
        autoResizeTimerRef.current = null
      }
      autoResizeInput()
      return
    }

    if (autoResizeTimerRef.current != null) {
      return
    }

    autoResizeTimerRef.current = window.setTimeout(() => {
      autoResizeTimerRef.current = null
      autoResizeInput()
    }, 120)
  }, [autoResizeInput])

  useEffect(() => {
    setComposerState({ draft: '', cursorIndex: null })
    draftSelectionRef.current = null
    textareaValueRef.current = ''
    autoResizeHeightRef.current = null
    if (textareaRef.current) {
      textareaRef.current.value = ''
    }
    scheduleAutoResize(true)
  }, [historyIdentity, scheduleAutoResize])

  useImperativeHandle(composerHandleRef, () => ({
    getDraft: () => textareaValueRef.current,
    setDraft: (value: string, caret?: number | null) => {
      textareaValueRef.current = value
      if (textareaRef.current) {
        textareaRef.current.value = value
      }
      setComposerState({ draft: value, cursorIndex: resolveSlashCursorIndex(value, caret ?? value.length) })
      autoResizeHeightRef.current = null
      scheduleAutoResize(true)
      if (caret == null) {
        draftSelectionRef.current = null
        return
      }
      const safeCaret = Math.max(0, Math.min(caret, value.length))
      draftSelectionRef.current = { start: safeCaret, end: safeCaret }
    },
    clearDraft: () => {
      textareaValueRef.current = ''
      if (textareaRef.current) {
        textareaRef.current.value = ''
      }
      autoResizeHeightRef.current = null
      scheduleAutoResize(true)
      setComposerState({ draft: '', cursorIndex: null })
      draftSelectionRef.current = null
    },
    focus: () => {
      textareaRef.current?.focus()
    },
  }), [composerHandleRef])

  useLayoutEffect(() => {
    const pending = draftSelectionRef.current
    if (!pending) return
    const el = textareaRef.current
    if (!el) return
    el.setSelectionRange(pending.start, pending.end)
    draftSelectionRef.current = null
  }, [draft])

  const commitDraftFromInput = useCallback((target: HTMLTextAreaElement, syncState = false) => {
    const nextDraft = target.value
    textareaValueRef.current = nextDraft
    onDraftChange?.()
    if (syncState) {
      const nextCursor = resolveSlashCursorIndex(nextDraft, target.selectionStart)
      setComposerState((prev) => (
        prev.draft === nextDraft && prev.cursorIndex === nextCursor
          ? prev
          : { draft: nextDraft, cursorIndex: nextCursor }
      ))
    }
  }, [onDraftChange])

  const deferredDraft = useDeferredValue(draft)
  const deferredCursorIndex = useDeferredValue(cursorIndex)
  const slashHints = useAiSlashCommandHints({ input: deferredDraft, cursorIndex: deferredCursorIndex })

  const applyComposerState = useCallback((value: string, caret: number | null) => {
    textareaValueRef.current = value
    if (inputRef?.current) {
      inputRef.current.value = value
    }
    autoResizeHeightRef.current = null
    scheduleAutoResize(true)
    if (caret == null) {
      draftSelectionRef.current = null
    } else {
      const safeCaret = Math.max(0, Math.min(caret, value.length))
      draftSelectionRef.current = { start: safeCaret, end: safeCaret }
    }
    setComposerState({
      draft: value,
      cursorIndex: resolveSlashCursorIndex(value, caret == null ? value.length : caret),
    })
  }, [scheduleAutoResize])

  const handleToolClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    if (onUploadFiles) {
      const supportedFiles = files.filter((file) => inferAttachmentKind(file))
      if (supportedFiles.length === 0) {
        e.target.value = ''
        return
      }
      onUploadFiles(supportedFiles)
      e.target.value = ''
      return
    }

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
  }, [onAttachImage, onUploadFiles])

  const handleImagePasteFiles = useCallback((files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'))
    if (imageFiles.length === 0) return false

    if (onUploadFiles) {
      const supportedFiles = imageFiles.filter((file) => inferAttachmentKind(file))
      if (supportedFiles.length === 0) return true
      onUploadFiles(supportedFiles)
      return true
    }

    const file = imageFiles.find((candidate) => isPreviewableImage(candidate))
    if (!file) return true

    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') {
        onAttachImage?.(result)
      }
    }
    reader.readAsDataURL(file)
    return true
  }, [onAttachImage, onUploadFiles])

  const handlePaste = useCallback((e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files || [])
    if (handleImagePasteFiles(files)) {
      e.preventDefault()
      onDraftChange?.()
      return
    }

    const text = e.clipboardData.getData('text/plain') || e.clipboardData.getData('text')
    if (!text) return

    e.preventDefault()

    const el = e.currentTarget
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? start
    const next = el.value.slice(0, start) + text + el.value.slice(end)
    const caret = start + text.length

    applyComposerState(next, caret)
    onDraftChange?.()
    el.setSelectionRange(caret, caret)
  }, [applyComposerState, handleImagePasteFiles, onDraftChange])

  const setTextareaRef = useCallback((node: HTMLTextAreaElement | null) => {
    textareaRef.current = node
    if (inputRef) {
      inputRef.current = node
    }
  }, [inputRef])

  const handleCompositionStart = () => {
    compositionEndFlushTokenRef.current += 1
    compositionEndCommitPendingRef.current = false
    isComposingRef.current = true
    onCompositionStart?.()
  }

  const handleCompositionEnd = () => {
    isComposingRef.current = false
    onCompositionEnd?.()
    const currentValue = inputRef?.current?.value
    if (currentValue != null) {
      textareaValueRef.current = currentValue
    }
    const flushToken = ++compositionEndFlushTokenRef.current
    compositionEndCommitPendingRef.current = true
    queueMicrotask(() => {
      if (flushToken !== compositionEndFlushTokenRef.current) return
      if (!compositionEndCommitPendingRef.current) return
      compositionEndCommitPendingRef.current = false
      const target = inputRef?.current
      if (!target) return
      commitDraftFromInput(target, target.value.startsWith('/') || composerState.draft.startsWith('/'))
      scheduleAutoResize(true)
    })
  }

  const handleTextareaKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e as any).nativeEvent?.isComposing) return
    if (slashHints.isOpen && (e.key === 'Enter' || e.key === 'Tab')) {
      e.preventDefault()
      const replacement = slashHints.getReplacement()
      if (replacement && inputRef?.current) {
        const { start, end, text } = replacement
        const el = inputRef.current
        const value = el.value
        const next = value.slice(0, start) + text + value.slice(end)
        const caret = start + text.length
        applyComposerState(next, caret)
      }
      slashHints.close()
      return
    }
    if (slashHints.handleKeyDown(e)) return
    onInputKeyDown(e)
  }

  const roleOptions = useMemo(
    () => (roles ?? []).map((role) => ({ value: role.id, label: role.name })),
    [roles],
  )
  const agentOptions = useMemo(
    () => (agents ?? []).map((agent) => ({ value: agent.id, label: agent.name })),
    [agents],
  )
  const modelGroups: BadgeSelectGroup[] = useMemo(() => {
    const grouped = new Map<string, { id: string; label: string; options: { value: string; label: string; showEye?: boolean }[] }>()
    for (const model of models ?? []) {
      const group = grouped.get(model.providerName) ?? {
        id: model.providerName,
        label: model.providerName,
        options: [],
      }
      group.options.push({
        value: model.id,
        label: model.id.split('/').pop() || model.id,
        showEye: model.visionMode === 'enabled',
      })
      grouped.set(model.providerName, group)
    }
    return Array.from(grouped.values())
  }, [models])

  const modelSelectDisabled = !!activeAgentId
  return (
    <form
      className="ai-chat-input"
      data-pdf-selection-skip="true"
      onSubmit={loading ? (e) => e.preventDefault() : onSubmit}
    >
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
              const caret = start + text.length
              applyComposerState(next, caret)
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
          ref={setTextareaRef}
          defaultValue={draft}
          onInput={(e) => {
            const debugStart = ENABLE_INPUT_LATENCY_DEBUG ? performance.now() : 0
            const nativeEvent = e.nativeEvent as InputEvent
            const nativeIsComposing = Boolean((e.nativeEvent as unknown as { isComposing?: boolean }).isComposing)
            if (nativeIsComposing || isComposingRef.current) {
              if (ENABLE_INPUT_LATENCY_DEBUG) {
                console.debug('[input-debug][composer] input-skip-composing', {
                  durationMs: Math.round(performance.now() - debugStart),
                  nativeIsComposing,
                  refIsComposing: isComposingRef.current,
                })
              }
              return
            }
            if (e.currentTarget.value === textareaValueRef.current) {
              if (ENABLE_INPUT_LATENCY_DEBUG) {
                console.debug('[input-debug][composer] input-skip-same-value', {
                  durationMs: Math.round(performance.now() - debugStart),
                  length: e.currentTarget.value.length,
                })
              }
              return
            }
            compositionEndCommitPendingRef.current = false
            const nextDraft = e.currentTarget.value
            const shouldTrackSlashHints = nextDraft.startsWith('/') || draft.startsWith('/')
            commitDraftFromInput(e.currentTarget, shouldTrackSlashHints)
            if (shouldTrackSlashHints) {
              const nextCursor = resolveSlashCursorIndex(nextDraft, e.currentTarget.selectionStart)
              setComposerState((prev) => (
                prev.draft === nextDraft && prev.cursorIndex === nextCursor
                  ? prev
                  : { draft: nextDraft, cursorIndex: nextCursor }
              ))
            }
            const isPaste = nativeEvent.inputType === 'insertFromPaste' || nativeEvent.inputType === 'insertFromPasteAsQuotation'
            const isLineBreak = nativeEvent.inputType === 'insertLineBreak' || nativeEvent.inputType === 'insertParagraph' || nextDraft.includes('\n')
            scheduleAutoResize(isPaste || isLineBreak)
            if (ENABLE_INPUT_LATENCY_DEBUG) {
              console.debug('[input-debug][composer] input', {
                durationMs: Math.round(performance.now() - debugStart),
                inputType: nativeEvent.inputType,
                length: nextDraft.length,
                slashHints: shouldTrackSlashHints,
                paste: isPaste,
                lineBreak: isLineBreak,
              })
            }
          }}
          onClick={(e) => {
            const nextDraft = e.currentTarget.value
            if (!nextDraft.startsWith('/') && !draft.startsWith('/')) return
            const nextCursor = resolveSlashCursorIndex(nextDraft, e.currentTarget.selectionStart)
            setComposerState((prev) => (
              prev.draft === nextDraft && prev.cursorIndex === nextCursor
                ? prev
                : { draft: nextDraft, cursorIndex: nextCursor }
            ))
          }}
          onBlur={() => {
            isComposingRef.current = false
            compositionEndFlushTokenRef.current += 1
            compositionEndCommitPendingRef.current = false
            onInputFocusChange?.(false)
          }}
          onFocus={() => {
            onInputFocusChange?.(true)
          }}
          onKeyDown={handleTextareaKeyDown}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onPaste={handlePaste}
          placeholder={inputPlaceholder ?? t('ai.askAnything')}
        />
        <AiChatComposerToolbar
          loading={loading}
          agentMode={agentMode}
          onStop={onStop}
          onChangeRole={onChangeRole}
          onChangeModel={onChangeModel}
          onChangeAgent={onChangeAgent}
          activeRoleId={activeRoleId}
          activeModelId={activeModelId}
          agents={agents}
          agentGroups={agentGroups}
          activeAgentId={activeAgentId}
          imageGenerationRunning={imageGenerationRunning}
          attachedImageDataUrl={attachedImageDataUrl}
          pendingAttachmentsLength={pendingAttachments?.length ?? 0}
          t={t}
          modelGroups={modelGroups}
          roleOptions={roleOptions}
          agentOptions={agentOptions}
          modelSelectDisabled={modelSelectDisabled}
          handleToolClick={handleToolClick}
          fileInputRef={fileInputRef}
          onFileChange={handleFileChange}
        />
      </div>
    </form>
  )
})
