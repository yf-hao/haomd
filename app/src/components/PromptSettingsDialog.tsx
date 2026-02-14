import type { FC, ChangeEvent, FormEvent, MouseEvent as ReactMouseEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import './PromptSettingsDialog.css'
import { emptyPromptSettings, type PromptRole } from '../modules/ai/promptSettings'
import { usePromptSettingsPersistence } from '../hooks/usePromptSettingsPersistence'
import { usePromptSettingsState, type PromptRoleDraft } from '../hooks/usePromptSettingsState'
import { onNativePaste } from '../modules/platform/clipboardEvents'
import { FieldGroup } from './FieldGroup'

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
    expandedId,
    setExpandedId,
    error,
    setError,
    setInitialSnapshot,
    defaultRole,
    updateDraftField,
    resetDraft,
    addOrUpdateRoleFromDraft,
    deleteRole,
    moveRole,
    setDefaultRole,
    editRoleIntoDraft,
    applyInitialSnapshot,
    updateInitialSnapshot,
  } = usePromptSettingsState(emptyPromptSettings)

  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const descInputRef = useRef<HTMLInputElement | null>(null)
  const promptTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [draggingRoleId, setDraggingRoleId] = useState<string | null>(null)
  const [previewTargetId, setPreviewTargetId] = useState<string | null>(null)
  const rolesListRef = useRef<HTMLDivElement | null>(null)

  // 拖拽排序时容器上下的安全范围（像素），用于允许在列表附近一点的位置松手
  const DRAG_SAFE_MARGIN = 48

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

  // 支持在 Prompt Settings 窗口输入框中使用 Cmd/Ctrl+V 粘贴
  useEffect(() => {
    if (!open) return

    const unPaste = onNativePaste((text) => {
      if (!text) return
      if (typeof document === 'undefined') return

      const active = document.activeElement as HTMLElement | null
      if (!active) return

      let el: HTMLInputElement | HTMLTextAreaElement | null = null
      let field: keyof PromptRoleDraft | null = null

      if (active === nameInputRef.current) {
        el = active as HTMLInputElement
        field = 'name'
      } else if (active === descInputRef.current) {
        el = active as HTMLInputElement
        field = 'description'
      } else if (active === promptTextareaRef.current) {
        el = active as HTMLTextAreaElement
        field = 'prompt'
      } else {
        return
      }

      const start = el.selectionStart ?? el.value.length
      const end = el.selectionEnd ?? el.value.length
      const value = el.value
      const next = value.slice(0, start) + text + value.slice(end)

      el.value = next
      if (field) {
        updateDraftField(field, next)
      }

      const pos = start + text.length
      el.setSelectionRange(pos, pos)
    })

    return () => {
      unPaste()
    }
  }, [open, updateDraftField])

  const handleRoleMouseDown = (roleId: string) => (e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()

    setDraggingRoleId(roleId)

    const container = rolesListRef.current
    if (!container) return

    const items = Array.from(container.querySelectorAll<HTMLDivElement>('.prompt-role-item'))
    if (!items.length) return

    const handleMouseMove = (moveEvent: MouseEvent) => {
      moveEvent.preventDefault()

      const mouseY = moveEvent.clientY
      const containerRect = container.getBoundingClientRect()

      const insideExtendedContainer =
        mouseY >= containerRect.top - DRAG_SAFE_MARGIN &&
        mouseY <= containerRect.bottom + DRAG_SAFE_MARGIN

      if (!insideExtendedContainer) {
        setPreviewTargetId(null)
        return
      }

      let nearestIndex = 0
      let nearestDistance = Number.POSITIVE_INFINITY

      items.forEach((el, index) => {
        const rect = el.getBoundingClientRect()
        const centerY = (rect.top + rect.bottom) / 2
        const dist = Math.abs(centerY - mouseY)
        if (dist < nearestDistance) {
          nearestDistance = dist
          nearestIndex = index
        }
      })

      const roles = settings.roles
      const targetRole = roles[nearestIndex]
      setPreviewTargetId(targetRole?.id ?? null)
    }

    const handleMouseUp = (upEvent: MouseEvent) => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)

      const sourceId = roleId
      const containerRect = container.getBoundingClientRect()
      const mouseY = upEvent.clientY

      const insideExtendedContainer =
        mouseY >= containerRect.top - DRAG_SAFE_MARGIN &&
        mouseY <= containerRect.bottom + DRAG_SAFE_MARGIN

      setDraggingRoleId(null)
      setPreviewTargetId(null)

      if (!sourceId || !insideExtendedContainer) {
        return
      }

      let nearestIndex = 0
      let nearestDistance = Number.POSITIVE_INFINITY

      items.forEach((el, index) => {
        const rect = el.getBoundingClientRect()
        const centerY = (rect.top + rect.bottom) / 2
        const dist = Math.abs(centerY - mouseY)
        if (dist < nearestDistance) {
          nearestDistance = dist
          nearestIndex = index
        }
      })

      const roles = settings.roles
      const fromIndex = roles.findIndex((r) => r.id === sourceId)
      const targetRole = roles[nearestIndex]

      if (!targetRole || fromIndex === -1 || targetRole.id === sourceId) {
        return
      }

      moveRole(sourceId, targetRole.id)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

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

  const ROLE_FORM_FIELDS: { key: keyof PromptRoleDraft; label: string; type: 'text' | 'textarea'; placeholder: string; ref: any }[] = [
    { key: 'name', label: 'Role Name', type: 'text', placeholder: 'e.g. Expert Markdown Editor', ref: nameInputRef },
    { key: 'description', label: 'Paramters (optional)', type: 'text', placeholder: 'Short description shown in the list', ref: descInputRef },
    { key: 'prompt', label: 'Prompt', type: 'textarea', placeholder: 'You are an expert Markdown editor...', ref: promptTextareaRef },
  ]

  return (
    <div className="modal-backdrop">
      <div className="modal modal-prompt-settings">
        <div className="modal-title">Prompt Settings</div>
        <div className="modal-content prompt-settings-body">
          <div className="prompt-settings-column-left">
            <form onSubmit={handleAddRole} className="prompt-settings-form">
              {ROLE_FORM_FIELDS.map((field) => (
                <FieldGroup key={field.key} label={field.label}>
                  {field.type === 'textarea' ? (
                    <textarea
                      className="field-textarea"
                      rows={1}
                      value={draft[field.key]}
                      onChange={handleDraftChange(field.key)}
                      placeholder={field.placeholder}
                      ref={field.ref}
                    />
                  ) : (
                    <input
                      className="field-input"
                      type="text"
                      value={draft[field.key]}
                      onChange={handleDraftChange(field.key)}
                      placeholder={field.placeholder}
                      ref={field.ref}
                    />
                  )}
                </FieldGroup>
              ))}

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
              <div
                className="providers-list prompt-roles-list"
                ref={rolesListRef}
              >
                {settings.roles.map((r) => {
                  const isExpanded = expandedId === r.id
                  const isDefault = settings.defaultRoleId === r.id
                  const isDragging = draggingRoleId === r.id
                  const isInsertPreview = previewTargetId === r.id
                  const isBuiltin = r.builtin
                  const itemClassName = `provider-item prompt-role-item${isDragging ? ' prompt-role-item-dragging' : ''
                    }${isInsertPreview ? ' prompt-role-item-insert-target' : ''}${isBuiltin ? ' prompt-role-item-builtin' : ''
                    }`

                  return (
                    <div
                      key={r.id}
                      className={itemClassName}
                    >
                      <div
                        className="provider-row"
                        onClick={() => {
                          if (isBuiltin) return
                          setExpandedId(isExpanded ? null : r.id)
                        }}
                      >
                        {!isBuiltin && (
                          <div
                            className="provider-drag-handle"
                            onMouseDown={handleRoleMouseDown(r.id)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label="Drag to reorder"
                            role="button"
                          >
                            ⋮⋮
                          </div>
                        )}
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

                      {isExpanded && !isBuiltin && (
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
                            {!isBuiltin && (
                              <>
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
                              </>
                            )}
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
