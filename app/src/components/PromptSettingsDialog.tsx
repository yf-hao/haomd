import type { FC, ChangeEvent, FormEvent } from 'react'
import { useEffect } from 'react'
import './PromptSettingsDialog.css'
import { emptyPromptSettings, type PromptRole } from '../modules/ai/promptSettings'
import { usePromptSettingsPersistence } from '../hooks/usePromptSettingsPersistence'
import { usePromptSettingsState, type PromptRoleDraft } from '../hooks/usePromptSettingsState'

export type PromptSettingsDialogProps = {
  open: boolean
  onClose: () => void
}

export const PromptSettingsDialog: FC<PromptSettingsDialogProps> = ({ open, onClose }) => {
  const { load, save } = usePromptSettingsPersistence()
  const {
    settings,
    setSettings,
    draft,
    setDraft,
    expandedId,
    setExpandedId,
    error,
    setError,
    initialSnapshot,
    setInitialSnapshot,
    defaultRole,
    updateDraftField,
    resetDraft,
    addOrUpdateRoleFromDraft,
    deleteRole,
    setDefaultRole,
    editRoleIntoDraft,
    applyInitialSnapshot,
    updateInitialSnapshot,
  } = usePromptSettingsState(emptyPromptSettings)

  useEffect(() => {
    if (!open) return

    let disposed = false

    const doLoad = async () => {
      const state = await load()
      if (disposed) return
      setSettings(state)
      setInitialSnapshot(state)
    }

    void doLoad()

    return () => {
      disposed = true
    }
  }, [open, load, setSettings, setInitialSnapshot])

  if (!open) return null

  const handleDraftChange = (field: keyof PromptRoleDraft) => (
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const value = e.target.value
    updateDraftField(field, value)
  }

  const handleResetDraft = () => {
    resetDraft()
  }

  const handleAddRole = (e: FormEvent) => {
    e.preventDefault()
    void addOrUpdateRoleFromDraft()
    // 添加后立即重置展开状态，确保新角色不展开
    setExpandedId(null)
  }

  const handleEditRole = (role: PromptRole) => {
    editRoleIntoDraft(role)
  }

  const handleDeleteRole = (id: string) => {
    deleteRole(id)
    if (expandedId === id) {
      resetDraft()
    }
  }

  const handleSetDefaultRole = (id: string) => {
    setDefaultRole(id)
  }

  const handleCancel = () => {
    applyInitialSnapshot()
    onClose()
  }

  const handleSave = async () => {
    const stateToSave = settings

    const ok = await save(stateToSave)
    if (!ok) {
      setError('Failed to save prompt settings. Please try again.')
      return
    }

    setSettings(stateToSave)
    updateInitialSnapshot(stateToSave)
    resetDraft()
    setError(null)
    onClose()
  }

  return (
    <div className="modal-backdrop">
      <div className="modal modal-prompt-settings">
        <div className="modal-title">Prompt Settings</div>
        <div className="modal-content prompt-settings-body">
          <div className="prompt-settings-column-left">
            <form onSubmit={handleAddRole} className="prompt-settings-form">
              <div className="field-group">
                <label className="field-label">Role Name</label>
                <input
                  className="field-input"
                  type="text"
                  value={draft.name}
                  onChange={handleDraftChange('name')}
                  placeholder="e.g. Expert Markdown Editor"
                />
              </div>

              <div className="field-group">
                <label className="field-label">Description (optional)</label>
                <input
                  className="field-input"
                  type="text"
                  value={draft.description}
                  onChange={handleDraftChange('description')}
                  placeholder="Short description shown in the list"
                />
              </div>

              <div className="field-group">
                <label className="field-label">Prompt</label>
                <textarea
                  className="field-textarea"
                  rows={6}
                  value={draft.prompt}
                  onChange={handleDraftChange('prompt')}
                  placeholder="You are an expert Markdown editor..."
                />
              </div>

              {error && <div className="form-error">{error}</div>}

              <div className="prompt-settings-form-actions">
                <button type="button" className="ghost" onClick={handleResetDraft}>
                  Reset Draft
                </button>
                <button type="submit" className="ghost primary">
                  Add 
                </button>
              </div>
            </form>
          </div>

          <div className="prompt-settings-column-right">
            <div className="providers-header">Saved Roles</div>
            {settings.roles.length === 0 ? (
              <div className="providers-empty">No roles configured yet.</div>
            ) : (
              <div className="providers-list">
                {settings.roles.map((r) => {
                  const isExpanded = expandedId === r.id
                  const isDefault = settings.defaultRoleId === r.id
                  return (
                    <div key={r.id} className="provider-item">
                      <div
                        className="provider-row"
                        onClick={() => setExpandedId(isExpanded ? null : r.id)}
                      >
                        <button
                          type="button"
                          className="provider-default-dot"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleSetDefaultRole(r.id)
                          }}
                          aria-pressed={isDefault}
                        >
                          {isDefault ? '●' : '○'}
                        </button>
                        <div className="provider-main">
                          <div className="provider-name">{r.name}</div>
                          {r.description && (
                            <div className="provider-sub">{r.description}</div>
                          )}
                        </div>
                        <button
                          type="button"
                          className="provider-toggle"
                          aria-label={isExpanded ? 'Collapse' : 'Expand'}
                        >
                          {isExpanded ? '▼' : '▶'}
                        </button>
                      </div>

{isExpanded && (
                <div className="provider-details">
                  <div className="provider-detail-row">Prompt Preview:</div>
                  <div className="prompt-preview">
                    {(() => {
                      const lines = r.prompt.split(/\r?\n/)
                      const previewLines = lines.slice(0, 5)
                      let previewText = previewLines.join('\n')
                      
                      // 如果内容超过5行或者总字符数超过300，添加省略号
                      if (lines.length > 5 || previewText.length > 150) {
                        // 确保最后显示省略号
if (previewText.length > 150) {
                        previewText = previewText.substring(0, 147) + '...'
                      } else {
                        previewText += '...'
                      }
                      }
                      
                      return previewText
                    })()}
                  </div>
                  <div className="provider-actions">
                    <button type="button" className="ghost" onClick={() => handleEditRole(r)}>
                      Edit Role
                    </button>
                    <button
                      type="button"
                      className="ghost danger"
                      onClick={() => handleDeleteRole(r.id)}
                    >
                      Delete Role
                    </button>
                  </div>
                </div>
              )}
                    </div>
                  )
                })}
              </div>
            )}

            {defaultRole && (
              <div className="default-summary">
                Default prompt role: {defaultRole.name}
              </div>
            )}
          </div>
        </div>

        <div className="modal-actions">
          <button className="ghost" type="button" onClick={handleCancel}>
            Cancel
          </button>
          <button className="ghost primary" type="button" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
