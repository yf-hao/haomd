import { memo, useCallback, useEffect, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { SidebarBackgroundShell } from './SidebarBackgroundShell'
import { SkillGenerateDialog } from './SkillGenerateDialog'
import { useI18n } from '../modules/i18n/I18nContext'
import type { SkillDocument } from '../modules/skills/domain/types'
import { createDefaultScript, createDefaultSkill, normalizeSkillBeforeSave } from '../modules/skills/application/skillsService'
import { deleteSkill, listSkills, readSkill, saveSkill } from '../modules/skills/storage/skillsRepo'
import { onNativePaste, onNativePasteError } from '../modules/platform/clipboardEvents'

export type SkillsPanelProps = {
  panelWidth?: number
}

type ActiveSkillField =
  | { kind: 'id' }
  | { kind: 'name' }
  | { kind: 'description' }
  | { kind: 'markdown' }
  | { kind: 'script'; scriptId: string; field: 'id' | 'label' | 'runtime' | 'entry' | 'argsSchema' | 'content' }

export const SkillsPanel = memo(function SkillsPanel({ panelWidth }: SkillsPanelProps) {
  const { t } = useI18n()
  const [skills, setSkills] = useState<Awaited<ReturnType<typeof listSkills>>>([])
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null)
  const [draft, setDraft] = useState<SkillDocument | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [activeField, setActiveField] = useState<ActiveSkillField | null>(null)
  const [authoringMode, setAuthoringMode] = useState<'create' | 'revise' | null>(null)

  const style = panelWidth ? { width: panelWidth } : undefined

  const refreshSkills = useCallback(async (
    preferredSkillId?: string | null,
    preserveCurrentSelection = true,
  ) => {
    setLoading(true)
    setError('')
    try {
      const next = await listSkills()
      setSkills(next)
      setSelectedSkillId((prev) => {
        if (preferredSkillId !== undefined) {
          return preferredSkillId
        }
        if (!preserveCurrentSelection || !prev) {
          return null
        }
        return next.some((skill) => skill.id === prev) ? prev : null
      })
    } catch (e) {
      setError(String(e))
      setSkills([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshSkills(undefined, false)
  }, [refreshSkills])

  useEffect(() => {
    if (!selectedSkillId) {
      setDraft(null)
      setActiveField(null)
      return
    }
    let disposed = false
    void (async () => {
      try {
        const skill = await readSkill(selectedSkillId)
        if (!disposed) {
          setDraft(skill)
          setEditorOpen(!!skill)
        }
      } catch (e) {
        if (!disposed) {
          setError(String(e))
          setDraft(null)
        }
      }
    })()
    return () => {
      disposed = true
    }
  }, [selectedSkillId])

  useEffect(() => {
    if (!editorOpen) {
      setActiveField(null)
    }
  }, [editorOpen])

  useEffect(() => {
    if (!editorOpen) return

    const unPaste = onNativePaste((text) => {
      if (!text || !activeField) return

      if (typeof document !== 'undefined') {
        const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
        const isEditableInput =
          !!active &&
          (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')

        if (isEditableInput && typeof active.setRangeText === 'function') {
          const start = active.selectionStart ?? active.value.length
          const end = active.selectionEnd ?? start
          active.focus()
          active.setRangeText(text, start, end, 'end')
          active.dispatchEvent(new Event('input', { bubbles: true }))
          return
        }
      }

      if (activeField.kind === 'name') {
        setDraft((prev) => (prev ? { ...prev, name: `${prev.name ?? ''}${text}` } : prev))
        return
      }

      if (activeField.kind === 'id') {
        setDraft((prev) => (prev ? { ...prev, id: `${prev.id ?? ''}${text}` } : prev))
        return
      }

      if (activeField.kind === 'description') {
        setDraft((prev) => (prev ? { ...prev, description: `${prev.description ?? ''}${text}` } : prev))
        return
      }

      if (activeField.kind === 'markdown') {
        setDraft((prev) => (prev ? { ...prev, markdown: `${prev.markdown ?? ''}${text}` } : prev))
        return
      }

      if (activeField.kind === 'script') {
        setDraft((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            scripts: prev.scripts.map((script) =>
              script.id !== activeField.scriptId
                ? script
                : { ...script, [activeField.field]: `${String(script[activeField.field] ?? '')}${text}` },
            ),
          }
        })
        return
      }
    })

    const unError = onNativePasteError((message) => {
      console.warn('[SkillsPanel] native paste error:', message)
    })

    return () => {
      unPaste()
      unError()
    }
  }, [activeField, editorOpen])

  const updateDraft = useCallback((patch: Partial<SkillDocument>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev))
  }, [])

  const handleNewSkill = useCallback(() => {
    const skill = createDefaultSkill()
    setSelectedSkillId(null)
    setDraft(skill)
    setEditorOpen(true)
    setError('')
  }, [])

  const handleOpenGenerate = useCallback(() => {
    setAuthoringMode('create')
    setError('')
  }, [])

  const handleOpenRevise = useCallback(() => {
    if (!draft?.id) return
    setAuthoringMode('revise')
    setError('')
  }, [draft?.id])

  const handleSelectSkill = useCallback((skillId: string) => {
    setError('')
    if (selectedSkillId === skillId) {
      setEditorOpen(true)
      return
    }
    setSelectedSkillId(skillId)
  }, [selectedSkillId])

  const handleSave = useCallback(async () => {
    if (!draft) return
    setSaving(true)
    setError('')
    try {
      const previousSkillId = selectedSkillId
      const normalized = normalizeSkillBeforeSave(draft)
      await saveSkill(normalized)
      if (previousSkillId && previousSkillId !== normalized.id) {
        await deleteSkill(previousSkillId)
      }
      await refreshSkills(normalized.id, true)
      setDraft(normalized)
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }, [draft, refreshSkills, selectedSkillId])

  const handleDelete = useCallback(async () => {
    if (!draft) return
    try {
      await deleteSkill(draft.id)
      setDraft(null)
      setEditorOpen(false)
      setSelectedSkillId(null)
      await refreshSkills(null, false)
    } catch (e) {
      setError(String(e))
    }
  }, [draft, refreshSkills])

  const handleAddScript = useCallback(() => {
    setDraft((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        scripts: [...prev.scripts, createDefaultScript(prev.scripts.length + 1)],
      }
    })
  }, [])

  const handleRemoveScript = useCallback((scriptId: string) => {
    setDraft((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        scripts: prev.scripts.filter((script) => script.id !== scriptId),
      }
    })
  }, [])

  const handleScriptChange = useCallback(
    (scriptId: string, field: 'id' | 'label' | 'runtime' | 'entry' | 'approvalPolicy' | 'argsSchema' | 'content', value: string) => {
      setDraft((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          scripts: prev.scripts.map((script) =>
            script.id !== scriptId ? script : { ...script, [field]: value },
          ),
        }
      })
    },
    [],
  )

  const handleEditorKeyDownCapture = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const isMeta = event.metaKey || event.ctrlKey
    if (!isMeta) return
    const key = event.key.toLowerCase()
    if (key === 'c' || key === 'v' || key === 'x' || key === 'z' || key === 'y') {
      event.stopPropagation()
    }
  }, [])

  return (
    <>
      <SidebarBackgroundShell className="skills-panel" style={style}>
        <div className="skills-panel-header">
          <span>{t('skills.title')}</span>
          <div className="skills-header-actions">
            <button type="button" className="notes-action-btn" onClick={handleOpenGenerate} title={t('skillsAuthoring.generateSkill')}>
              AI
            </button>
            <button type="button" className="notes-action-btn" onClick={handleNewSkill} title={t('skills.newSkill')}>
              +
            </button>
          </div>
        </div>

        <div className="skills-panel-body">
          <div className="skills-list-pane skills-list-pane-full">
            {loading ? (
              <div className="skills-empty">{t('skills.loading')}</div>
            ) : skills.length === 0 ? (
              <div className="skills-empty">{t('skills.empty')}</div>
            ) : (
              <ul className="skills-list">
                {skills.map((skill) => (
                <li
                  key={skill.id}
                  className={`skills-item ${selectedSkillId === skill.id ? 'active' : ''}`}
                  onClick={() => handleSelectSkill(skill.id)}
                >
                    <div className="skills-item-title-row">
                      <span className="skills-item-title">{skill.name}</span>
                      <span className={`skills-badge ${skill.enabled ? 'enabled' : 'disabled'}`}>
                        {skill.enabled ? t('skills.enabled') : t('skills.disabled')}
                      </span>
                    </div>
                    <div className="skills-item-meta">
                      {skill.description || skill.id}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </SidebarBackgroundShell>

      {editorOpen && draft && typeof document !== 'undefined' && createPortal(
        <div className="modal-backdrop">
          <div
            className="modal modal-prompt-settings modal-skills-settings skills-editor-modal"
            onKeyDownCapture={handleEditorKeyDownCapture}
          >
            <div className="skills-editor-modal-header">
              <div className="modal-title">{draft.name || t('skills.title')}</div>
              <button
                type="button"
                className="skills-editor-close-btn"
                onClick={() => setEditorOpen(false)}
                aria-label={t('common.close')}
              >
                ×
              </button>
            </div>
            <div className="modal-content skills-editor-modal-content">
              <div className="skills-editor">
                <div className="skills-editor-layout">
                  <div className="skills-editor-main">
                    <label className="field-label">{t('skills.skillId')}</label>
                    <input
                      className="field-input"
                      value={draft.id}
                      onChange={(e) => updateDraft({ id: e.target.value })}
                      onFocus={() => setActiveField({ kind: 'id' })}
                    />

                    <label className="field-label">{t('skills.name')}</label>
                    <input
                      className="field-input"
                      value={draft.name}
                      onChange={(e) => updateDraft({ name: e.target.value })}
                      onFocus={() => setActiveField({ kind: 'name' })}
                    />

                    <label className="field-label">{t('skills.description')}</label>
                    <input
                      className="field-input"
                      value={draft.description ?? ''}
                      onChange={(e) => updateDraft({ description: e.target.value })}
                      onFocus={() => setActiveField({ kind: 'description' })}
                    />

                    <div className="skills-row-grid">
                      <label className="skills-checkbox">
                        <input
                          type="checkbox"
                          checked={draft.enabled}
                          onChange={(e) => updateDraft({ enabled: e.target.checked })}
                        />
                        <span>{t('skills.enable')}</span>
                      </label>
                      <label className="skills-checkbox">
                        <input
                          type="checkbox"
                          checked={draft.trusted}
                          onChange={(e) => updateDraft({ trusted: e.target.checked })}
                        />
                        <span>{t('skills.trusted')}</span>
                      </label>
                    </div>

                    <div className="skills-markdown-section">
                      <label className="field-label">{t('skills.markdown')}</label>
                      <textarea
                        className="field-textarea skills-markdown-input"
                        value={draft.markdown}
                        onChange={(e) => updateDraft({ markdown: e.target.value })}
                        onFocus={() => setActiveField({ kind: 'markdown' })}
                      />
                    </div>
                  </div>

                  <div className="skills-editor-side">
                    <div className="skills-section-header">
                      <span>{t('skills.scripts')}</span>
                      <button type="button" className="ghost tiny primary" onClick={handleAddScript}>
                        {t('skills.addScript')}
                      </button>
                    </div>

                    {draft.scripts.length === 0 ? (
                      <div className="skills-empty-inline">{t('skills.noScripts')}</div>
                    ) : (
                      <div className="skills-scripts">
                        {draft.scripts.map((script) => (
                          <div key={script.id} className="skills-script-card">
                            <div className="skills-script-header">
                              <strong>{script.label || script.id}</strong>
                              <button
                                type="button"
                                className="ghost tiny ghost-subtle"
                                onClick={() => handleRemoveScript(script.id)}
                              >
                                {t('skills.removeScript')}
                              </button>
                            </div>
                            <div className="skills-script-grid">
                              <input className="field-input" value={script.id} onChange={(e) => handleScriptChange(script.id, 'id', e.target.value)} onFocus={() => setActiveField({ kind: 'script', scriptId: script.id, field: 'id' })} placeholder={t('skills.scriptId')} />
                              <input className="field-input" value={script.label} onChange={(e) => handleScriptChange(script.id, 'label', e.target.value)} onFocus={() => setActiveField({ kind: 'script', scriptId: script.id, field: 'label' })} placeholder={t('skills.scriptLabel')} />
                              <input className="field-input" value={script.runtime} onChange={(e) => handleScriptChange(script.id, 'runtime', e.target.value)} onFocus={() => setActiveField({ kind: 'script', scriptId: script.id, field: 'runtime' })} placeholder={t('skills.runtime')} />
                              <input className="field-input" value={script.entry} onChange={(e) => handleScriptChange(script.id, 'entry', e.target.value)} onFocus={() => setActiveField({ kind: 'script', scriptId: script.id, field: 'entry' })} placeholder={t('skills.entry')} />
                              <select className="field-select" value={script.approvalPolicy} onChange={(e) => handleScriptChange(script.id, 'approvalPolicy', e.target.value)}>
                                <option value="ask">{t('skills.approvalAsk')}</option>
                                <option value="always_allow">{t('skills.approvalAlwaysAllow')}</option>
                                <option value="manual_only">{t('skills.approvalManualOnly')}</option>
                              </select>
                            </div>
                            <label className="field-label">{t('skills.argsSchema')}</label>
                            <textarea
                              className="field-textarea skills-script-schema"
                              value={script.argsSchema ?? ''}
                              onChange={(e) => handleScriptChange(script.id, 'argsSchema', e.target.value)}
                              onFocus={() => setActiveField({ kind: 'script', scriptId: script.id, field: 'argsSchema' })}
                            />
                            <label className="field-label">{t('skills.scriptContent')}</label>
                            <textarea
                              className="field-textarea skills-script-content"
                              value={script.content}
                              onChange={(e) => handleScriptChange(script.id, 'content', e.target.value)}
                              onFocus={() => setActiveField({ kind: 'script', scriptId: script.id, field: 'content' })}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {error && <div className="form-error">{error}</div>}
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={handleOpenRevise} disabled={!draft?.id}>
                {t('skillsAuthoring.reviseSkill')}
              </button>
              <button type="button" className="ghost danger" onClick={handleDelete}>
                {t('skills.deleteSkill')}
              </button>
              <button
                type="button"
                className="ghost primary"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? t('common.saving') : t('common.save')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      <SkillGenerateDialog
        open={authoringMode !== null}
        mode={authoringMode ?? 'create'}
        skillId={authoringMode === 'revise' ? draft?.id ?? selectedSkillId ?? undefined : undefined}
        onClose={() => setAuthoringMode(null)}
        onAccepted={() => {
          setAuthoringMode(null)
          setEditorOpen(false)
          setDraft(null)
          void refreshSkills(null, false)
        }}
      />
    </>
  )
})
