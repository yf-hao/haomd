import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../modules/i18n/I18nContext'
import {
  acceptSkillBuild,
  continueSkillBuildRefinement,
  startCreateSkillBuild,
  startReviseSkillBuild,
} from '../modules/skills/authoring/skillAuthoringService'
import {
  clearPersistedSkillAuthoringState,
  loadPersistedSkillAuthoringState,
  savePersistedSkillAuthoringState,
} from '../modules/skills/authoring/skillAuthoringSessionRepo'
import type { SkillBuildSession } from '../modules/skills/authoring/types'

export type SkillGenerateDialogProps = {
  open: boolean
  mode: 'create' | 'revise'
  skillId?: string
  onClose: () => void
  onAccepted?: (skillId: string) => void
}

function extractSkillIdFromSession(session: SkillBuildSession): string | null {
  if (!session.currentDraft) return null
  try {
    const parsed = JSON.parse(session.currentDraft.skillJson) as { id?: string }
    return parsed.id?.trim() || null
  } catch {
    return null
  }
}

export function SkillGenerateDialog({
  open,
  mode,
  skillId,
  onClose,
  onAccepted,
}: SkillGenerateDialogProps) {
  const { t } = useI18n()
  const [request, setRequest] = useState('')
  const [session, setSession] = useState<SkillBuildSession | null>(null)
  const [running, setRunning] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState('')
  const requestFieldId = 'skill-authoring-request'

  useEffect(() => {
    if (!open) return
    const persisted = loadPersistedSkillAuthoringState(mode, skillId)
    if (!persisted) {
      setRequest('')
      setSession(null)
      setError('')
      return
    }
    setRequest(persisted.request)
    setSession(persisted.session)
    setError('')
  }, [mode, open, skillId])

  useEffect(() => {
    if (!open) return
    savePersistedSkillAuthoringState({
      mode,
      skillId,
      request,
      session,
    })
  }, [mode, open, request, session, skillId])

  const title = mode === 'create' ? t('skillsAuthoring.generateTitle') : t('skillsAuthoring.reviseTitle')

  const statusLabel = useMemo(() => {
    if (!session) return t('skillsAuthoring.status.idle')
    return t(`skillsAuthoring.status.${session.status}` as never)
  }, [session, t])

  if (!open || typeof document === 'undefined') return null

  async function handleRun() {
    const trimmed = request.trim()
    if (!trimmed) {
      setError(t('skillsAuthoring.requestRequired'))
      return
    }

    setRunning(true)
    setError('')
    try {
      const nextSession =
        mode === 'create'
          ? await startCreateSkillBuild(trimmed)
          : await startReviseSkillBuild(skillId ?? '', trimmed)
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
      setError(t('skillsAuthoring.requestRequired'))
      return
    }

    setRunning(true)
    setError('')
    try {
      const nextSession = await continueSkillBuildRefinement(session, trimmed)
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
      const accepted = await acceptSkillBuild(session)
      setSession(accepted)
      const nextSkillId = extractSkillIdFromSession(accepted)
      clearPersistedSkillAuthoringState(mode, skillId)
      if (nextSkillId) {
        onAccepted?.(nextSkillId)
      }
      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setAccepting(false)
    }
  }

  return createPortal(
    <div className="modal-backdrop">
      <div className="modal modal-prompt-settings modal-skill-authoring">
        <div className="modal-title">{title}</div>
        <div className="modal-content skill-authoring-body">
          <div className="skill-authoring-request">
            <label className="field-label" htmlFor={requestFieldId}>
              {t('skillsAuthoring.request')}
            </label>
            <textarea
              id={requestFieldId}
              className="field-textarea skill-authoring-request-input"
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              placeholder={t('skillsAuthoring.requestPlaceholder')}
            />
            <div className="field-helper">
              {mode === 'create' ? t('skillsAuthoring.createHint') : t('skillsAuthoring.reviseHint')}
            </div>
          </div>

          <div className="skill-authoring-preview">
            <div className="skill-authoring-status-row">
              <span className="field-label">{t('skillsAuthoring.currentStatus')}</span>
              <span className="skills-badge enabled">{statusLabel}</span>
            </div>

            {session?.validationErrors?.length ? (
              <div className="skill-authoring-errors">
                <div className="field-label">{t('skillsAuthoring.validationErrors')}</div>
                <pre className="skill-authoring-code">
                  {JSON.stringify(session.validationErrors, null, 2)}
                </pre>
              </div>
            ) : null}

            {session?.currentDraft ? (
              <div className="skill-authoring-preview-sections">
                <div>
                  <label className="field-label">skill.json</label>
                  <textarea className="field-textarea skill-authoring-codearea" readOnly value={session.currentDraft.skillJson} />
                </div>
                <div>
                  <label className="field-label">SKILL.md</label>
                  <textarea className="field-textarea skill-authoring-codearea" readOnly value={session.currentDraft.skillMarkdown} />
                </div>
                <div>
                  <label className="field-label">scripts</label>
                  <textarea
                    className="field-textarea skill-authoring-codearea"
                    readOnly
                    value={session.currentDraft.scripts.map((script) => `# ${script.path}\n${script.content}`).join('\n\n')}
                  />
                </div>
              </div>
            ) : (
              <div className="skills-empty-inline">{t('skillsAuthoring.noDraft')}</div>
            )}

            {error && <div className="form-error">{error}</div>}
          </div>
        </div>
        <div className="modal-actions">
          {session?.status === 'validated' ? (
            <>
              <button type="button" className="ghost" onClick={handleContinueRefine} disabled={running || accepting}>
                {t('skillsAuthoring.continueRefine')}
              </button>
              <button type="button" className="ghost primary" onClick={handleAccept} disabled={running || accepting}>
                {accepting ? t('common.saving') : t('skillsAuthoring.acceptAndSave')}
              </button>
            </>
          ) : (
            <button type="button" className="ghost primary" onClick={handleRun} disabled={running || accepting}>
              {running ? t('skillsAuthoring.running') : t('skillsAuthoring.run')}
            </button>
          )}
          <button type="button" className="ghost" onClick={onClose} disabled={running || accepting}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
