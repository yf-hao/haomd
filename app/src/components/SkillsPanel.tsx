import { memo, useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { SidebarBackgroundShell } from './SidebarBackgroundShell'
import { useI18n } from '../modules/i18n/I18nContext'
import type { SkillDocument } from '../modules/skills/domain/types'
import { createDefaultScript, createDefaultSkill, normalizeSkillBeforeSave } from '../modules/skills/application/skillsService'
import { deleteSkill, listSkills, readSkill, saveSkill } from '../modules/skills/storage/skillsRepo'
import { runSkillScript } from '../modules/skills/application/skillsRuntimeService'

export type SkillsPanelProps = {
  panelWidth?: number
}

export const SkillsPanel = memo(function SkillsPanel({ panelWidth }: SkillsPanelProps) {
  const { t } = useI18n()
  const [skills, setSkills] = useState<Awaited<ReturnType<typeof listSkills>>>([])
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null)
  const [draft, setDraft] = useState<SkillDocument | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [runArgsByScriptId, setRunArgsByScriptId] = useState<Record<string, string>>({})
  const [runResultByScriptId, setRunResultByScriptId] = useState<Record<string, string>>({})
  const [runningScriptId, setRunningScriptId] = useState<string | null>(null)

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
      return
    }
    let disposed = false
    void (async () => {
      try {
        const skill = await readSkill(selectedSkillId)
        if (!disposed) {
          setDraft(skill)
          setEditorOpen(!!skill)
          setRunArgsByScriptId({})
          setRunResultByScriptId({})
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
      const normalized = normalizeSkillBeforeSave(draft)
      await saveSkill(normalized)
      await refreshSkills(normalized.id, true)
      setDraft(normalized)
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }, [draft, refreshSkills])

  const handleDelete = useCallback(async () => {
    if (!draft) return
    const ok = window.confirm(t('skills.deleteConfirm', { name: draft.name }))
    if (!ok) return
    try {
      await deleteSkill(draft.id)
      setDraft(null)
      await refreshSkills(null, false)
    } catch (e) {
      setError(String(e))
    }
  }, [draft, refreshSkills, t])

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

  const handleRunArgsChange = useCallback((scriptId: string, value: string) => {
    setRunArgsByScriptId((prev) => ({ ...prev, [scriptId]: value }))
  }, [])

  const handleRunScript = useCallback(
    async (scriptId: string) => {
      if (!draft) return
      const raw = (runArgsByScriptId[scriptId] ?? '').trim()
      let parsedArgs: unknown = {}
      if (raw) {
        try {
          parsedArgs = JSON.parse(raw)
        } catch {
          setRunResultByScriptId((prev) => ({
            ...prev,
            [scriptId]: t('skills.invalidTestArgs'),
          }))
          return
        }
      }
      setRunningScriptId(scriptId)
      try {
        const result = await runSkillScript(draft.id, scriptId, parsedArgs)
        setRunResultByScriptId((prev) => ({
          ...prev,
          [scriptId]: JSON.stringify(result, null, 2),
        }))
      } catch (e) {
        setRunResultByScriptId((prev) => ({
          ...prev,
          [scriptId]: String(e),
        }))
      } finally {
        setRunningScriptId((prev) => (prev === scriptId ? null : prev))
      }
    },
    [draft, runArgsByScriptId, t],
  )

  return (
    <>
      <SidebarBackgroundShell className="skills-panel" style={style}>
        <div className="skills-panel-header">
          <span>{t('skills.title')}</span>
          <button type="button" className="notes-action-btn" onClick={handleNewSkill} title={t('skills.newSkill')}>
            +
          </button>
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
          <div className="modal skills-editor-modal">
            <div className="modal-title">{draft.name || t('skills.title')}</div>
            <div className="modal-content skills-editor-modal-content">
              <div className="skills-editor">
                <div className="skills-editor-topbar">
                  <div className="skills-editor-id">{draft.id}</div>
                  <div className="skills-editor-actions">
                    <button
                      type="button"
                      className="ghost tiny primary"
                      onClick={handleSave}
                      disabled={saving}
                    >
                      {saving ? t('common.saving') : t('common.save')}
                    </button>
                    <button type="button" className="ghost tiny danger" onClick={handleDelete}>
                      {t('skills.deleteSkill')}
                    </button>
                  </div>
                </div>

                <label className="field-label">{t('skills.name')}</label>
                <input
                  className="field-input"
                  value={draft.name}
                  onChange={(e) => updateDraft({ name: e.target.value })}
                />

                <label className="field-label">{t('skills.description')}</label>
                <input
                  className="field-input"
                  value={draft.description ?? ''}
                  onChange={(e) => updateDraft({ description: e.target.value })}
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

                <label className="field-label">{t('skills.markdown')}</label>
                <textarea
                  className="field-textarea skills-markdown-input"
                  value={draft.markdown}
                  onChange={(e) => updateDraft({ markdown: e.target.value })}
                />

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
                          <input className="field-input" value={script.id} onChange={(e) => handleScriptChange(script.id, 'id', e.target.value)} placeholder={t('skills.scriptId')} />
                          <input className="field-input" value={script.label} onChange={(e) => handleScriptChange(script.id, 'label', e.target.value)} placeholder={t('skills.scriptLabel')} />
                          <input className="field-input" value={script.runtime} onChange={(e) => handleScriptChange(script.id, 'runtime', e.target.value)} placeholder={t('skills.runtime')} />
                          <input className="field-input" value={script.entry} onChange={(e) => handleScriptChange(script.id, 'entry', e.target.value)} placeholder={t('skills.entry')} />
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
                        />
                        <label className="field-label">{t('skills.scriptContent')}</label>
                        <textarea
                          className="field-textarea skills-script-content"
                          value={script.content}
                          onChange={(e) => handleScriptChange(script.id, 'content', e.target.value)}
                        />
                        <div className="skills-section-header">
                          <span>{t('skills.testRun')}</span>
                          <button
                            type="button"
                            className="ghost tiny primary"
                            onClick={() => void handleRunScript(script.id)}
                            disabled={runningScriptId === script.id}
                          >
                            {runningScriptId === script.id ? t('skills.running') : t('skills.runScript')}
                          </button>
                        </div>
                        <textarea
                          className="field-textarea skills-script-schema"
                          value={runArgsByScriptId[script.id] ?? ''}
                          onChange={(e) => handleRunArgsChange(script.id, e.target.value)}
                          placeholder={t('skills.testArgsPlaceholder')}
                        />
                        <textarea
                          className="field-textarea skills-script-schema"
                          value={runResultByScriptId[script.id] ?? ''}
                          readOnly
                          placeholder={t('skills.runResultPlaceholder')}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {error && <div className="form-error">{error}</div>}
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={() => setEditorOpen(false)}>
                {t('skills.closeEditor')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
})
