import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button'
import { useI18n } from '../modules/i18n/I18nContext'
import {
  acceptWordTemplateBuild,
  cancelWordTemplateBuild,
  continueWordTemplateBuildRefinement,
  startCreateWordTemplateBuild,
  startReviseWordTemplateBuild,
} from '../modules/wordTemplateAuthoring/templateAuthoringService'
import { loadWordTemplateDraft, saveWordTemplateDraft } from '../modules/wordTemplateAuthoring/templateArtifactSaveService'
import type { WordTemplateBuildSession } from '../modules/wordTemplateAuthoring/types'
import { useDesktopTextEditingBridge } from '../hooks/useDesktopTextEditingBridge'

export type WordTemplateGenerateDialogProps = {
  open: boolean
  mode: 'create' | 'revise'
  templateId?: string
  onClose: () => void
  onAccepted?: (templateId: string) => void
}

export function WordTemplateGenerateDialog({
  open,
  mode,
  templateId,
  onClose,
  onAccepted,
}: WordTemplateGenerateDialogProps) {
  const { t } = useI18n()
  const [request, setRequest] = useState('')
  const [session, setSession] = useState<WordTemplateBuildSession | null>(null)
  const [running, setRunning] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState('')
  const requestFieldId = 'word-template-authoring-request'
  const { handleKeyDownCapture } = useDesktopTextEditingBridge({
    enabled: open,
    onPasteError: (message) => {
      console.warn('[WordTemplateGenerateDialog] native paste error:', message)
    },
  })

  const title =
    mode === 'create'
      ? t('wordTemplateAuthoring.generateTitle')
      : t('wordTemplateAuthoring.reviseTitle')
  const placeholderSeparator = '\n\n----------------\n\n'
  const requestPlaceholder =
    mode === 'create'
      ? [
          t('wordTemplateAuthoring.requestPlaceholder'),
          t('wordTemplateAuthoring.createExample'),
          [
            t('wordTemplateAuthoring.frontMatterHint'),
            t('wordTemplateAuthoring.textHint'),
            t('wordTemplateAuthoring.richTextHint'),
          ].join('\n\n'),
        ].join(placeholderSeparator)
      : t('wordTemplateAuthoring.requestPlaceholder')

  const statusLabel = useMemo(() => {
    if (!session) return t('wordTemplateAuthoring.status.idle')
    return t(`wordTemplateAuthoring.status.${session.status}` as never)
  }, [session, t])

  useEffect(() => {
    if (!open) return

    let cancelled = false

    setRequest('')
    setSession(null)
    setError('')
    setRunning(false)
    setAccepting(false)

    if (mode !== 'revise' || !templateId) {
      return () => {
        cancelled = true
      }
    }

    void loadWordTemplateDraft(templateId)
      .then((draft) => {
        if (cancelled) return
        setRequest(draft.templateRequest)
        setSession({
          id: `word-template-draft-${templateId}`,
          mode: 'revise',
          baseTemplateId: draft.templateId,
          userRequest: '',
          currentDraft: draft,
          status: 'idle',
          repairCount: 0,
          maxRepairRounds: 3,
          validationErrors: [],
        })
      })
      .catch((e) => {
        if (cancelled) return
        setError(String(e))
      })

    return () => {
      cancelled = true
    }
  }, [mode, open, templateId])

  if (!open || typeof document === 'undefined') return null

  async function handleRun() {
    const trimmed = request.trim()
    if (!trimmed) {
      setError(t('wordTemplateAuthoring.requestRequired'))
      return
    }

    setRunning(true)
    setError('')
    try {
      const nextSession =
        mode === 'create'
          ? await startCreateWordTemplateBuild(trimmed)
          : await startReviseWordTemplateBuild(await loadWordTemplateDraft(templateId ?? ''), trimmed)
      setSession(nextSession)
    } catch (e) {
      setError(String(e))
    } finally {
      setRunning(false)
    }
  }

  async function handleContinueRefine() {
    if (!session) return
    const trimmed = request.trim()
    if (!trimmed) {
      setError(t('wordTemplateAuthoring.requestRequired'))
      return
    }

    setRunning(true)
    setError('')
    try {
      const nextSession = await continueWordTemplateBuildRefinement(session, trimmed)
      setSession(nextSession)
    } catch (e) {
      setError(String(e))
    } finally {
      setRunning(false)
    }
  }

  async function handleAccept() {
    if (!session) return
    setAccepting(true)
    setError('')
    try {
      const accepted = await acceptWordTemplateBuild(session, (draft) =>
        saveWordTemplateDraft({
          ...draft,
          templateRequest: session.userRequest,
        }),
      )
      setSession(accepted)
      if (accepted.currentDraft) {
        onAccepted?.(accepted.currentDraft.templateId)
      }
      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setAccepting(false)
    }
  }

  function handleClose() {
    if (session) {
      setSession(cancelWordTemplateBuild(session))
    }
    onClose()
  }

  return createPortal(
    <div className="modal-backdrop">
      <div className="modal modal-prompt-settings modal-skill-authoring" onKeyDownCapture={handleKeyDownCapture}>
        <div className="modal-title">{title}</div>
        <div className="modal-content skill-authoring-body">
          <div className="skill-authoring-request">
            <label className="field-label" htmlFor={requestFieldId}>
              {t('wordTemplateAuthoring.request')}
            </label>
            <textarea
              id={requestFieldId}
              className="field-textarea skill-authoring-request-input"
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              placeholder={requestPlaceholder}
            />
            <div className="field-helper">
              {mode === 'create'
                ? t('wordTemplateAuthoring.createHint')
                : t('wordTemplateAuthoring.reviseHint')}
            </div>
          </div>

          <div className="skill-authoring-preview">
            <div className="skill-authoring-status-row">
              <span className="field-label">{t('wordTemplateAuthoring.currentStatus')}</span>
              <span className="skills-badge enabled">{statusLabel}</span>
            </div>

            {session?.validationErrors?.length ? (
              <div className="skill-authoring-errors">
                <div className="field-label">{t('wordTemplateAuthoring.validationErrors')}</div>
                <pre className="skill-authoring-code">
                  {JSON.stringify(session.validationErrors, null, 2)}
                </pre>
              </div>
            ) : null}

            {session?.currentDraft ? (
              <div className="skill-authoring-preview-sections">
                <div className="word-template-preview-section">
                  <label className="field-label">template.json</label>
                  <textarea
                    className="field-textarea skill-authoring-codearea"
                    readOnly
                    value={JSON.stringify(session.currentDraft.templateJson, null, 2)}
                  />
                </div>
                <div className="word-template-preview-section">
                  <label className="field-label">{t('wordTemplateAuthoring.usageMarkdown')}</label>
                  <textarea
                    className="field-textarea skill-authoring-codearea"
                    readOnly
                    value={session.currentDraft.usageMarkdown}
                  />
                </div>
                <div className="word-template-preview-section">
                  <label className="field-label">{t('wordTemplateAuthoring.sampleMarkdown')}</label>
                  <textarea
                    className="field-textarea skill-authoring-codearea"
                    readOnly
                    value={session.currentDraft.sampleMarkdown}
                  />
                </div>
              </div>
            ) : (
              <div className="skills-empty-inline">{t('wordTemplateAuthoring.noDraft')}</div>
            )}

            {error && <div className="form-error">{error}</div>}
          </div>
        </div>
        <div className="modal-actions">
          {session?.status === 'validated' ? (
            <>
              <Button variant="tertiary" type="button" onClick={handleContinueRefine} disabled={running || accepting}>
                {t('wordTemplateAuthoring.continueRefine')}
              </Button>
              <Button variant="primary" type="button" onClick={handleAccept} disabled={running || accepting} loading={accepting}>
                {accepting ? t('common.saving') : t('wordTemplateAuthoring.acceptAndSave')}
              </Button>
            </>
          ) : (
            <Button variant="primary" type="button" onClick={handleRun} disabled={running || accepting} loading={running}>
              {running ? t('wordTemplateAuthoring.running') : t('wordTemplateAuthoring.run')}
            </Button>
          )}
          <Button variant="secondary" type="button" onClick={handleClose} disabled={running || accepting}>
            {t('common.close')}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
