import { memo, useCallback, useEffect, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { SidebarBackgroundShell } from './SidebarBackgroundShell'
import { useI18n } from '../modules/i18n/I18nContext'
import type { WorkflowDocument, WorkflowRunResult } from '../modules/workflows/domain/types'
import { createDefaultWorkflow, createDefaultWorkflowStep, createWorkflowRunInputTemplate, normalizeWorkflowBeforeSave } from '../modules/workflows/application/workflowsService'
import { deleteWorkflow, listWorkflows, readWorkflow, saveWorkflow } from '../modules/workflows/storage/workflowsRepo'
import { runWorkflow } from '../modules/workflows/application/workflowRuntimeService'
import { onNativePaste, onNativePasteError } from '../modules/platform/clipboardEvents'

export type WorkflowsPanelProps = {
  panelWidth?: number
}

type ActiveWorkflowField =
  | { kind: 'id' }
  | { kind: 'name' }
  | { kind: 'description' }
  | { kind: 'inputSchema' }
  | { kind: 'outputFrom' }
  | { kind: 'markdown' }
  | { kind: 'runInput' }
  | { kind: 'step'; stepId: string; field: 'id' | 'skillId' | 'scriptId' | 'inputTemplate' }

export const WorkflowsPanel = memo(function WorkflowsPanel({ panelWidth }: WorkflowsPanelProps) {
  const { t } = useI18n()
  const [workflows, setWorkflows] = useState<Awaited<ReturnType<typeof listWorkflows>>>([])
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null)
  const [draft, setDraft] = useState<WorkflowDocument | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [activeField, setActiveField] = useState<ActiveWorkflowField | null>(null)
  const [runInput, setRunInput] = useState('{}')
  const [runResult, setRunResult] = useState<WorkflowRunResult | null>(null)

  const style = panelWidth ? { width: panelWidth } : undefined

  const refreshWorkflows = useCallback(async (
    preferredWorkflowId?: string | null,
    preserveCurrentSelection = true,
  ) => {
    setLoading(true)
    setError('')
    try {
      const next = await listWorkflows()
      setWorkflows(next)
      setSelectedWorkflowId((prev) => {
        if (preferredWorkflowId !== undefined) return preferredWorkflowId
        if (!preserveCurrentSelection || !prev) return null
        return next.some((workflow) => workflow.id === prev) ? prev : null
      })
    } catch (e) {
      setError(String(e))
      setWorkflows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshWorkflows(undefined, false)
  }, [refreshWorkflows])

  useEffect(() => {
    if (!selectedWorkflowId) {
      setDraft(null)
      setActiveField(null)
      setRunResult(null)
      return
    }
    let disposed = false
    void (async () => {
      try {
        const workflow = await readWorkflow(selectedWorkflowId)
        if (!disposed) {
          setDraft(workflow)
          setEditorOpen(!!workflow)
          setRunInput(workflow ? createWorkflowRunInputTemplate(workflow.inputSchema) : '{}')
          setRunResult(null)
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
  }, [selectedWorkflowId])

  useEffect(() => {
    if (!editorOpen) setActiveField(null)
  }, [editorOpen])

  useEffect(() => {
    if (!editorOpen) return
    const unPaste = onNativePaste((text) => {
      if (!text || !activeField) return

      if (typeof document !== 'undefined') {
        const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
        const isEditableInput = !!active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')
        if (isEditableInput && typeof active.setRangeText === 'function') {
          const start = active.selectionStart ?? active.value.length
          const end = active.selectionEnd ?? start
          active.focus()
          active.setRangeText(text, start, end, 'end')
          active.dispatchEvent(new Event('input', { bubbles: true }))
          return
        }
      }

      if (activeField.kind === 'runInput') {
        setRunInput((prevInput) => `${prevInput}${text}`)
        return
      }

      setDraft((prev) => {
        if (!prev) return prev
        if (activeField.kind === 'id') return { ...prev, id: `${prev.id ?? ''}${text}` }
        if (activeField.kind === 'name') return { ...prev, name: `${prev.name ?? ''}${text}` }
        if (activeField.kind === 'description') return { ...prev, description: `${prev.description ?? ''}${text}` }
        if (activeField.kind === 'inputSchema') return { ...prev, inputSchema: `${prev.inputSchema ?? ''}${text}` }
        if (activeField.kind === 'outputFrom') return { ...prev, outputFrom: `${prev.outputFrom ?? ''}${text}` }
        if (activeField.kind === 'markdown') return { ...prev, markdown: `${prev.markdown ?? ''}${text}` }
        return {
          ...prev,
          steps: prev.steps.map((step) =>
            step.id !== activeField.stepId
              ? step
              : { ...step, [activeField.field]: `${String(step[activeField.field] ?? '')}${text}` },
          ),
        }
      })
    })
    const unError = onNativePasteError((message) => {
      console.warn('[WorkflowsPanel] native paste error:', message)
    })
    return () => {
      unPaste()
      unError()
    }
  }, [activeField, editorOpen])

  const updateDraft = useCallback((patch: Partial<WorkflowDocument>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev))
  }, [])

  const handleNewWorkflow = useCallback(() => {
    const workflow = createDefaultWorkflow()
    setSelectedWorkflowId(null)
    setDraft(workflow)
    setEditorOpen(true)
    setError('')
    setRunInput(createWorkflowRunInputTemplate(workflow.inputSchema))
    setRunResult(null)
  }, [])

  const handleSelectWorkflow = useCallback((workflowId: string) => {
    setError('')
    if (selectedWorkflowId === workflowId) {
      setEditorOpen(true)
      return
    }
    setSelectedWorkflowId(workflowId)
  }, [selectedWorkflowId])

  const handleSave = useCallback(async () => {
    if (!draft) return
    setSaving(true)
    setError('')
    try {
      const previousWorkflowId = selectedWorkflowId
      const normalized = normalizeWorkflowBeforeSave(draft)
      await saveWorkflow(normalized)
      if (previousWorkflowId && previousWorkflowId !== normalized.id) {
        await deleteWorkflow(previousWorkflowId)
      }
      await refreshWorkflows(normalized.id, true)
      setDraft(normalized)
      setRunInput((prev) => (prev.trim() ? prev : createWorkflowRunInputTemplate(normalized.inputSchema)))
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }, [draft, refreshWorkflows, selectedWorkflowId])

  const handleDelete = useCallback(async () => {
    if (!draft) return
    try {
      await deleteWorkflow(draft.id)
      setDraft(null)
      setEditorOpen(false)
      setSelectedWorkflowId(null)
      setRunResult(null)
      await refreshWorkflows(null, false)
    } catch (e) {
      setError(String(e))
    }
  }, [draft, refreshWorkflows])

  const handleAddStep = useCallback(() => {
    setDraft((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        steps: [...prev.steps, createDefaultWorkflowStep(prev.steps.length + 1)],
      }
    })
  }, [])

  const handleRemoveStep = useCallback((stepId: string) => {
    setDraft((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        steps: prev.steps.filter((step) => step.id !== stepId),
      }
    })
  }, [])

  const handleStepChange = useCallback((stepId: string, field: 'id' | 'skillId' | 'scriptId' | 'inputTemplate', value: string) => {
    setDraft((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        steps: prev.steps.map((step) => (step.id !== stepId ? step : { ...step, [field]: value })),
      }
    })
  }, [])

  const handleEditorKeyDownCapture = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const isMeta = event.metaKey || event.ctrlKey
    if (!isMeta) return
    const key = event.key.toLowerCase()
    if (key === 'c' || key === 'v' || key === 'x' || key === 'z' || key === 'y') {
      event.stopPropagation()
    }
  }, [])

  const handleRunWorkflow = useCallback(async () => {
    if (!draft) return
    setRunning(true)
    setError('')
    try {
      const input = JSON.parse(runInput)
      const result = await runWorkflow(normalizeWorkflowBeforeSave(draft), input)
      setRunResult(result)
    } catch (e) {
      setError(String(e))
      setRunResult(null)
    } finally {
      setRunning(false)
    }
  }, [draft, runInput])

  return (
    <>
      <SidebarBackgroundShell className="skills-panel workflows-panel" style={style}>
        <div className="skills-panel-header">
          <span>{t('workflows.title')}</span>
          <button type="button" className="notes-action-btn" onClick={handleNewWorkflow} title={t('workflows.newWorkflow')}>
            +
          </button>
        </div>

        <div className="skills-panel-body">
          <div className="skills-list-pane skills-list-pane-full">
            {loading ? (
              <div className="skills-empty">{t('workflows.loading')}</div>
            ) : workflows.length === 0 ? (
              <div className="skills-empty">{t('workflows.empty')}</div>
            ) : (
              <ul className="skills-list">
                {workflows.map((workflow) => (
                  <li
                    key={workflow.id}
                    className={`skills-item ${selectedWorkflowId === workflow.id ? 'active' : ''}`}
                    onClick={() => handleSelectWorkflow(workflow.id)}
                  >
                    <div className="skills-item-title-row">
                      <span className="skills-item-title">{workflow.name}</span>
                      <span className={`skills-badge ${workflow.enabled ? 'enabled' : 'disabled'}`}>
                        {workflow.enabled ? t('workflows.enabled') : t('workflows.disabled')}
                      </span>
                    </div>
                    <div className="skills-item-meta">{workflow.description || workflow.id}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </SidebarBackgroundShell>

      {editorOpen && draft && typeof document !== 'undefined' && createPortal(
        <div className="modal-backdrop">
          <div className="modal modal-prompt-settings modal-skills-settings workflows-editor-modal" onKeyDownCapture={handleEditorKeyDownCapture}>
            <div className="modal-title">{draft.name || t('workflows.title')}</div>
            <div className="modal-content skills-editor-modal-content">
              <div className="skills-editor">
                <div className="skills-editor-layout">
                  <div className="skills-editor-main">
                    <label className="field-label">{t('workflows.workflowId')}</label>
                    <input className="field-input" value={draft.id} onChange={(e) => updateDraft({ id: e.target.value })} onFocus={() => setActiveField({ kind: 'id' })} />

                    <label className="field-label">{t('workflows.name')}</label>
                    <input className="field-input" value={draft.name} onChange={(e) => updateDraft({ name: e.target.value })} onFocus={() => setActiveField({ kind: 'name' })} />

                    <label className="field-label">{t('workflows.description')}</label>
                    <input className="field-input" value={draft.description ?? ''} onChange={(e) => updateDraft({ description: e.target.value })} onFocus={() => setActiveField({ kind: 'description' })} />

                    <div className="skills-row-grid">
                      <label className="skills-checkbox">
                        <input type="checkbox" checked={draft.enabled} onChange={(e) => updateDraft({ enabled: e.target.checked })} />
                        <span>{t('workflows.enable')}</span>
                      </label>
                    </div>

                    <label className="field-label">{t('workflows.approvalPolicy')}</label>
                    <select className="field-select" value={draft.approvalPolicy} onChange={(e) => updateDraft({ approvalPolicy: e.target.value as WorkflowDocument['approvalPolicy'] })}>
                      <option value="ask">{t('workflows.approvalAsk')}</option>
                      <option value="always_allow">{t('workflows.approvalAlwaysAllow')}</option>
                      <option value="manual_only">{t('workflows.approvalManualOnly')}</option>
                    </select>

                    <label className="field-label">{t('workflows.failurePolicy')}</label>
                    <select className="field-select" value={draft.failurePolicy} onChange={(e) => updateDraft({ failurePolicy: e.target.value as WorkflowDocument['failurePolicy'] })}>
                      <option value="fail_fast">{t('workflows.failureFailFast')}</option>
                      <option value="continue">{t('workflows.failureContinue')}</option>
                    </select>

                    <label className="field-label">{t('workflows.inputSchema')}</label>
                    <textarea className="field-textarea skills-script-schema" value={draft.inputSchema} onChange={(e) => updateDraft({ inputSchema: e.target.value })} onFocus={() => setActiveField({ kind: 'inputSchema' })} />

                    <label className="field-label">{t('workflows.outputFrom')}</label>
                    <input className="field-input" value={draft.outputFrom} onChange={(e) => updateDraft({ outputFrom: e.target.value })} onFocus={() => setActiveField({ kind: 'outputFrom' })} />

                    <label className="field-label">{t('workflows.markdown')}</label>
                    <textarea className="field-textarea skills-markdown-input" value={draft.markdown} onChange={(e) => updateDraft({ markdown: e.target.value })} onFocus={() => setActiveField({ kind: 'markdown' })} />
                  </div>

                  <div className="skills-editor-side">
                    <div className="skills-section-header">
                      <span>{t('workflows.steps')}</span>
                      <button type="button" className="ghost tiny primary" onClick={handleAddStep}>
                        {t('workflows.addStep')}
                      </button>
                    </div>

                    {draft.steps.length === 0 ? (
                      <div className="skills-empty-inline">{t('workflows.noSteps')}</div>
                    ) : (
                      <div className="skills-scripts">
                        {draft.steps.map((step) => (
                          <div key={step.id} className="skills-script-card">
                            <div className="skills-script-header">
                              <strong>{step.id}</strong>
                              <button type="button" className="ghost tiny ghost-subtle" onClick={() => handleRemoveStep(step.id)}>
                                {t('workflows.removeStep')}
                              </button>
                            </div>
                            <div className="skills-script-grid">
                              <input className="field-input" value={step.id} onChange={(e) => handleStepChange(step.id, 'id', e.target.value)} onFocus={() => setActiveField({ kind: 'step', stepId: step.id, field: 'id' })} placeholder={t('workflows.stepId')} />
                              <input className="field-input" value={step.type} readOnly />
                              <input className="field-input" value={step.skillId} onChange={(e) => handleStepChange(step.id, 'skillId', e.target.value)} onFocus={() => setActiveField({ kind: 'step', stepId: step.id, field: 'skillId' })} placeholder={t('workflows.skillId')} />
                              <input className="field-input" value={step.scriptId} onChange={(e) => handleStepChange(step.id, 'scriptId', e.target.value)} onFocus={() => setActiveField({ kind: 'step', stepId: step.id, field: 'scriptId' })} placeholder={t('workflows.scriptId')} />
                            </div>
                            <label className="field-label">{t('workflows.inputTemplate')}</label>
                            <textarea className="field-textarea skills-script-schema" value={step.inputTemplate} onChange={(e) => handleStepChange(step.id, 'inputTemplate', e.target.value)} onFocus={() => setActiveField({ kind: 'step', stepId: step.id, field: 'inputTemplate' })} />
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="skills-section-header">
                      <span>{t('workflows.runWorkflow')}</span>
                    </div>
                    <label className="field-label">{t('workflows.runInput')}</label>
                    <textarea
                      className="field-textarea skills-script-schema"
                      value={runInput}
                      onChange={(e) => setRunInput(e.target.value)}
                      onFocus={() => setActiveField({ kind: 'runInput' })}
                    />
                    <button type="button" className="ghost primary" onClick={handleRunWorkflow} disabled={running}>
                      {running ? t('workflows.running') : t('workflows.runWorkflow')}
                    </button>
                    <label className="field-label">{t('workflows.runResult')}</label>
                    <textarea
                      className="field-textarea skills-script-content workflows-run-result"
                      value={runResult ? JSON.stringify(runResult, null, 2) : ''}
                      readOnly
                    />
                  </div>
                </div>

                {error && <div className="form-error">{error}</div>}
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="ghost danger" onClick={handleDelete}>
                {t('workflows.deleteWorkflow')}
              </button>
              <button type="button" className="ghost primary" onClick={handleSave} disabled={saving}>
                {saving ? t('common.saving') : t('common.save')}
              </button>
              <button type="button" className="ghost" onClick={() => setEditorOpen(false)}>
                {t('workflows.closeEditor')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
})
