import type { FC, ChangeEvent, FormEvent } from 'react'
import { useEffect, useState } from 'react'
import './AiSettingsDialog.css'
import { onNativePaste, onNativePasteError } from '../modules/platform/clipboardEvents'
import { emptySettings, type UiProvider } from '../modules/ai/settings'
import { useAiSettingsPersistence } from '../hooks/useAiSettingsPersistence'
import { useAiSettingsState, type ProviderDraft, parseModelsInput } from '../hooks/useAiSettingsState'

export type AiSettingsDialogProps = {
  open: boolean
  onClose: () => void
}

export const AiSettingsDialog: FC<AiSettingsDialogProps> = ({ open, onClose }) => {
  const [activeField, setActiveField] = useState<keyof ProviderDraft | null>(null)
  const { load, save } = useAiSettingsPersistence()
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
    defaultProvider,
    updateDraftField,
    resetDraft,
    addOrMergeProviderFromDraft,
    deleteProvider,
    removeModel,
    setDefaultModel,
    setDefaultProvider,
    editProviderIntoDraft,
    applyInitialSnapshot,
    updateInitialSnapshot,
  } = useAiSettingsState(emptySettings)

  // 打开对话框时，从后端加载配置
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

  // 监听原生粘贴事件，将内容插入当前激活的输入字段
  useEffect(() => {
    if (!open) return

    const unPaste = onNativePaste((text) => {
      if (!text || !activeField) return

      setDraft((prev) => {
        const key = activeField
        const current = prev[key] ?? ''

        let start = current.length
        let end = current.length

        if (typeof document !== 'undefined') {
          const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
          if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
            if (typeof el.selectionStart === 'number') start = el.selectionStart
            if (typeof el.selectionEnd === 'number') end = el.selectionEnd ?? start
          }
        }

        const before = current.slice(0, start)
        const after = current.slice(end)

        return {
          ...prev,
          [key]: before + text + after,
        }
      })
    })

    const unError = onNativePasteError((message) => {
      // 先仅记录日志，如有需要可接入表单错误区域
      console.warn('[AiSettingsDialog] native paste error:', message)
    })

    return () => {
      unPaste()
      unError()
    }
  }, [open, activeField])

  if (!open) return null

  const handleDraftChange = (field: keyof ProviderDraft) => (
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const value = e.target.value
    updateDraftField(field, value)
  }

  const handleResetDraft = () => {
    resetDraft()
  }

  const handleTestAndAdd = (e: FormEvent) => {
    e.preventDefault()
    void addOrMergeProviderFromDraft()
  }

  const handleDeleteProvider = (id: string) => {
    deleteProvider(id)
    // 如果当前展开/正在编辑的正是这个 Provider，同时清空左侧表单，避免 Save 时被“复活”
    if (expandedId === id) {
      resetDraft()
      setActiveField(null)
    }
  }

  const handleRemoveModel = (providerId: string, modelId: string) => {
    removeModel(providerId, modelId)
  }

  const handleChangeDefaultModel = (providerId: string, modelId: string) => {
    setDefaultModel(providerId, modelId)
  }

  const handleChangeDefaultProvider = (providerId: string) => {
    setDefaultProvider(providerId)
  }

  const handleEditProvider = (provider: UiProvider) => {
    editProviderIntoDraft(provider)
  }

  const handleCancel = () => {
    applyInitialSnapshot()
    onClose()
  }

  const handleSave = async () => {
    let stateToSave = settings

    const hasDraft =
      draft.name.trim() ||
      draft.baseUrl.trim() ||
      draft.apiKey.trim() ||
      draft.modelsInput.trim() ||
      draft.description.trim()

    // 如果当前还没有任何 Provider，但左侧表单里已经填写了内容，
    // 在 Save 的时候自动把草稿作为首个 Provider 一并保存（不依赖异步 setState）
    if (!settings.providers.length && hasDraft) {
      const models = parseModelsInput(draft.modelsInput)
      if (!draft.name.trim() || !draft.baseUrl.trim() || !draft.apiKey.trim()) {
        setError('请填写 Provider Name / Base URL / API Key，或先点击 “Test & Add Provider”')
        return
      }
      if (models.length === 0) {
        setError('请至少填写一个 ModelID，或先点击 “Test & Add Provider”')
        return
      }

      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const provider: UiProvider = {
        id,
        name: draft.name.trim(),
        baseUrl: draft.baseUrl.trim(),
        apiKey: draft.apiKey.trim(),
        models: models.map((m) => ({ id: m })),
        defaultModelId: models[0],
        description: draft.description.trim() || undefined,
      }

      stateToSave = {
        providers: [...settings.providers, provider],
        defaultProviderId: settings.defaultProviderId ?? id,
      }
    }

    const ok = await save(stateToSave)
    if (!ok) {
      setError('保存失败：请稍后重试')
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
      <div className="modal modal-ai-settings">
        <div className="modal-title">Provider Settings</div>
        <div className="modal-content ai-settings-body">
          <div className="ai-settings-column-left">
            <form onSubmit={handleTestAndAdd} className="ai-settings-form">
              <div className="field-group">
                <label className="field-label">Provider Name</label>
                <input
                  className="field-input"
                  type="text"
                  value={draft.name}
                  onChange={handleDraftChange('name')}
                  onFocus={() => setActiveField('name')}
                />
              </div>

              <div className="field-group">
                <label className="field-label">Base URL</label>
                <input
                  className="field-input"
                  type="text"
                  value={draft.baseUrl}
                  onChange={handleDraftChange('baseUrl')}
                  onFocus={() => setActiveField('baseUrl')}
                />
              </div>

              <div className="field-group">
                <label className="field-label">API Key</label>
                <input
                  className="field-input"
                  type="password"
                  value={draft.apiKey}
                  onChange={handleDraftChange('apiKey')}
                  onFocus={() => setActiveField('apiKey')}
                />
              </div>

              <div className="field-group">
                <label className="field-label">Models</label>
                <input
                  className="field-input"
                  type="text"
                  placeholder="gpt-4.1, gpt-4o-mini"
                  value={draft.modelsInput}
                  onChange={handleDraftChange('modelsInput')}
                  onFocus={() => setActiveField('modelsInput')}
                />
              </div>

              <div className="field-group">
                <label className="field-label">Description</label>
                <textarea
                  className="field-textarea"
                  rows={3}
                  value={draft.description}
                  onChange={handleDraftChange('description')}
                  onFocus={() => setActiveField('description')}
                />
              </div>

              {error && <div className="form-error">{error}</div>}

              <div className="ai-settings-form-actions">
                <button type="button" className="ghost" onClick={handleResetDraft}>
                  Reset Form
                </button>
                <button type="button" className="ghost" onClick={() => {
                  // 测试连接
                  const testEvent = new CustomEvent('testConnection', { detail: { draft } })
                  document.dispatchEvent(testEvent)
                }}>
                  Test
                </button>
                <button type="submit" className="ghost primary">
                  Add 
                </button>
              </div>
            </form>
          </div>

          <div className="ai-settings-column-right">
            <div className="providers-header">Configured Providers</div>
            {settings.providers.length === 0 ? (
              <div className="providers-empty">No Provider</div>
            ) : (
              <div className="providers-list">
                {settings.providers.map((p) => {
                  const isExpanded = expandedId === p.id
                  const isDefault = settings.defaultProviderId === p.id
                  return (
                    <div key={p.id} className="provider-item">
                      <div className="provider-row" onClick={() => setExpandedId(isExpanded ? null : p.id)}>
                        <button
                          type="button"
                          className="provider-default-dot"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleChangeDefaultProvider(p.id)
                          }}
                          aria-pressed={isDefault}
                        >
                          {isDefault ? '●' : '○'}
                        </button>
                        <div className="provider-main">
                          <div className="provider-name">{p.name}</div>
                          <div className="provider-sub">
                            {p.defaultModelId ? `Default Model: ${p.defaultModelId}` : 'No default model'}
                          </div>
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
                          <div className="provider-detail-row">Base URL: {p.baseUrl}</div>
                          <div className="provider-detail-row">Models:</div>
                          <ul className="provider-models">
                            {p.models.map((m) => (
                              <li key={m.id} className="provider-model-row">
                                <span className="provider-model-id">{m.id}</span>
                                <button
                                  type="button"
                                  className="link-button"
                                  onClick={() => handleRemoveModel(p.id, m.id)}
                                >
                                  Remove
                                </button>
                              </li>
                            ))}
                          </ul>

                          <div className="field-group inline">
                            <label className="field-label">Default Model</label>
                            <select
                              className="field-select"
                              value={p.defaultModelId ?? ''}
                              onChange={(e) => handleChangeDefaultModel(p.id, e.target.value)}
                            >
                              {p.models.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.id}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="provider-actions">
                            <button type="button" className="ghost" onClick={() => handleEditProvider(p)}>
                              Edit Provider
                            </button>
                            <button
                              type="button"
                              className="ghost danger"
                              onClick={() => handleDeleteProvider(p.id)}
                            >
                              Delete Provider
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {defaultProvider && (
              <div className="default-summary">
                Default chat model: {defaultProvider.name}
                {defaultProvider.defaultModelId ? ` / ${defaultProvider.defaultModelId}` : ''}
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
