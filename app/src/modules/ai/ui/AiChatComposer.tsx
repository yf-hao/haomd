import type {
  ChangeEvent,
  ClipboardEvent,
  FormEvent,
  KeyboardEvent,
  Ref,
  RefObject,
} from 'react'
import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AiSlashCommandHintPanel } from './AiSlashCommandHintPanel'
import { BadgeSelect, type BadgeSelectGroup } from './BadgeSelect'
import { useAiSlashCommandHints } from './hooks/useAiSlashCommandHints'
import type { AiChatAgentMode } from './imageGenerationEphemeral'
import type { UploadedFileRef, VisionMode } from '../domain/types'
import { useI18n } from '../../i18n/I18nContext'
import { inferAttachmentKind, isPreviewableImage } from '../application/attachmentKind'

const FILE_INPUT_ACCEPT =
  'image/*,audio/*,.pdf,application/pdf,.txt,text/plain,.md,text/markdown,.csv,text/csv,.json,application/json,.doc,.docx,.xls,.xlsx,.ppt,.pptx'

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
  onCompositionStart?: () => void
  onCompositionEnd?: () => void
  inputRef?: RefObject<HTMLTextAreaElement>
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
  const isComposingRef = useRef(false)
  const draftSelectionRef = useRef<{ start: number; end: number } | null>(null)
  const [composerState, setComposerState] = useState<ComposerState>({ draft: '', cursorIndex: null })
  const draft = composerState.draft
  const cursorIndex = composerState.cursorIndex

  const autoResizeInput = () => {
    const el = inputRef?.current
    if (!el) return
    el.style.height = 'auto'
    const maxHeight = 120
    const next = Math.min(maxHeight, el.scrollHeight)
    el.style.height = `${next}px`
  }

  useEffect(() => {
    setComposerState({ draft: '', cursorIndex: null })
    draftSelectionRef.current = null
  }, [historyIdentity])

  useEffect(() => {
    if (autoResizeTimerRef.current != null) {
      window.clearTimeout(autoResizeTimerRef.current)
    }
    autoResizeTimerRef.current = window.setTimeout(() => {
      autoResizeInput()
      autoResizeTimerRef.current = null
    }, 40)
    return () => {
      if (autoResizeTimerRef.current != null) {
        window.clearTimeout(autoResizeTimerRef.current)
        autoResizeTimerRef.current = null
      }
    }
  }, [draft])

  useImperativeHandle(composerHandleRef, () => ({
    getDraft: () => draft,
    setDraft: (value: string, caret?: number | null) => {
      setComposerState({ draft: value, cursorIndex: resolveSlashCursorIndex(value, caret ?? value.length) })
      if (caret == null) {
        draftSelectionRef.current = null
        return
      }
      const safeCaret = Math.max(0, Math.min(caret, value.length))
      draftSelectionRef.current = { start: safeCaret, end: safeCaret }
    },
    clearDraft: () => {
      setComposerState({ draft: '', cursorIndex: null })
      draftSelectionRef.current = null
    },
    focus: () => {
      inputRef?.current?.focus()
    },
  }), [draft, inputRef, composerHandleRef])

  useLayoutEffect(() => {
    const pending = draftSelectionRef.current
    if (!pending) return
    const el = inputRef?.current
    if (!el) return
    el.setSelectionRange(pending.start, pending.end)
    draftSelectionRef.current = null
  }, [draft, inputRef])

  const slashHints = useAiSlashCommandHints({ input: draft, cursorIndex })

  const applyComposerState = useCallback((value: string, caret: number | null) => {
    setComposerState({
      draft: value,
      cursorIndex: resolveSlashCursorIndex(value, caret == null ? value.length : caret),
    })
  }, [])

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

  const handlePaste = useCallback((e: ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault()
  }, [])

  const handleCompositionStart = () => {
    isComposingRef.current = true
    onCompositionStart?.()
  }

  const handleCompositionEnd = () => {
    isComposingRef.current = false
    onCompositionEnd?.()
    window.setTimeout(() => {
      const target = inputRef?.current
      if (!target) return
      const nextValue = target.value
      const nextCursor = resolveSlashCursorIndex(nextValue, target.selectionStart)
      setComposerState((prev) => (
        prev.draft === nextValue && prev.cursorIndex === nextCursor
          ? prev
          : { draft: nextValue, cursorIndex: nextCursor }
      ))
      onDraftChange?.()
    }, 0)
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
        window.requestAnimationFrame(() => {
          inputRef.current?.setSelectionRange(caret, caret)
        })
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
              const caret = start + text.length
              applyComposerState(next, caret)
              window.requestAnimationFrame(() => {
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
          value={draft}
          onChange={(e) => {
            const nativeIsComposing = Boolean((e.nativeEvent as unknown as { isComposing?: boolean }).isComposing)
            const nextDraft = e.target.value
            const nextCursor = nativeIsComposing || isComposingRef.current
              ? null
              : resolveSlashCursorIndex(nextDraft, e.target.selectionStart)
            if (!(nativeIsComposing || isComposingRef.current)) {
              onDraftChange?.()
            }
            setComposerState((prev) => (
              prev.draft === nextDraft && prev.cursorIndex === nextCursor
                ? prev
                : { draft: nextDraft, cursorIndex: nextCursor }
            ))
          }}
          onClick={(e) => {
            const nextCursor = resolveSlashCursorIndex(e.currentTarget.value, e.currentTarget.selectionStart)
            setComposerState((prev) => (prev.cursorIndex === nextCursor ? prev : { ...prev, cursorIndex: nextCursor }))
          }}
          onBlur={() => {
            isComposingRef.current = false
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
