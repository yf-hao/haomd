import type { FC, ChangeEvent, FormEvent } from 'react'
import { useEffect, useState } from 'react'
import './AiSettingsDialog.css'
import { onNativePaste, onNativePasteError } from '../modules/platform/clipboardEvents'
import { emptySettings, type UiProvider } from '../modules/ai/settings'
import { useAiSettingsPersistence } from '../hooks/useAiSettingsPersistence'
import { useAiSettingsState, type ProviderDraft, parseModelsInput } from '../hooks/useAiSettingsState'
import { testProviderConnection } from '../modules/ai/testConnection'

export type AiSettingsDialogProps = {
  open: boolean
  onClose: () => void
}

export const AiSettingsDialog: FC<AiSettingsDialogProps> = ({ open, onClose }) => {
  const [activeField, setActiveField] = useState<keyof ProviderDraft | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [showKeyOnlyModal, setShowKeyOnlyModal] = useState(false)
  const { load, save } = useAiSettingsPersistence()
  const {
    settings,
    setSettings,
    draft,
    setDraft,
    expandedId,
    setExpandedId,
    editingProviderId,
    setEditingProviderId,
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
    updateModelMaxTokens,
  } = useAiSettingsState(emptySettings)

  // 打开对话框时重置展开状态，确保所有提供商默认不展开
  useEffect(() => {
    if (!open) return
    setExpandedId(null)
  }, [open, setExpandedId])

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
    setTestResult(null)
  }

  const handleTestConnection = async () => {
    const models = parseModelsInput(draft.modelsInput)
    if (!draft.baseUrl.trim() || !draft.apiKey.trim()) {
      setError('请填写 Base URL / API Key')
      setTestResult(null)
      return
    }
    if (models.length === 0) {
      setError('请至少填写一个 ModelID')
      setTestResult(null)
      return
    }

    // 清理之前的状态，展示测试中提示
    setError(null)
    setTestResult('正在测试连接...')

    try {
      const baseUrl = draft.baseUrl.trim()
      const apiKey = draft.apiKey.trim()
      const providerType = draft.providerType || 'dify'
      const failed: string[] = []

      for (const modelId of models) {
        const result = await testProviderConnection({
          baseUrl,
          apiKey,
          modelId,
          providerType,
        })

        if (!result.ok) {
          failed.push(`${modelId}: ${result.message}`)
        }
      }

      if (failed.length === 0) {
        setTestResult(`连接成功：${models.length} 个模型通过测试`)
      } else {
        setTestResult(null)
        setError(`以下模型测试失败：\n${failed.join('\n')}`)
      }
    } catch (e) {
      const err = e as Error
      setTestResult(null)
      setError(`连接测试异常：${err.message || '未知错误'}`)
    }
  }

  const handleTestAndAdd = (e: FormEvent) => {
    e.preventDefault()
    const result = addOrMergeProviderFromDraft()
    if (result === 'key-only') {
      setShowKeyOnlyModal(true)
    }
  }

  const handleDeleteProvider = (id: string) => {
    deleteProvider(id)
    // 如果当前展开/正在编辑的正是这个 Provider，同时清空左侧表单，避免 Save 时被“复活”
    if (expandedId === id) {
      resetDraft()
      setActiveField(null)
      setEditingProviderId(null)
    }
  }

  const handleRemoveModel = (providerId: string, modelId: string) => {
    removeModel(providerId, modelId)
  }

  const handleChangeModelMaxTokens = (providerId: string, modelId: string, value: string) => {
    const trimmed = value.trim()
    if (!trimmed) {
      updateModelMaxTokens(providerId, modelId, undefined)
      return
    }
    const num = Number(trimmed)
    if (!Number.isFinite(num) || num <= 0) {
      return
    }
    updateModelMaxTokens(providerId, modelId, Math.floor(num))
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

    // 情况 1：当前还没有任何 Provider，但左侧表单里已经填写了内容，
    // Save 时自动把草稿作为首个 Provider 一并保存（不依赖异步 setState）
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
        providerType: (draft.providerType || 'dify') as any,
      }

      stateToSave = {
        providers: [...settings.providers, provider],
        defaultProviderId: settings.defaultProviderId ?? id,
      }
    }

    // 情况 2：已有 Provider，支持在 Save 时根据草稿覆盖 API Key
    if (settings.providers.length && editingProviderId && initialSnapshot) {
      const providerIndex = stateToSave.providers.findIndex((p) => p.id === editingProviderId)
      if (providerIndex !== -1) {
        const currentProvider = stateToSave.providers[providerIndex]
        const originalProvider =
          initialSnapshot.providers.find((p) => p.id === editingProviderId) ?? currentProvider
        const oldApiKey = originalProvider.apiKey
        const newApiKeyCandidate = draft.apiKey.trim()

        // 只有当草稿中填写了非空且与旧值不同的 API Key 时才覆盖
        if (newApiKeyCandidate && newApiKeyCandidate !== oldApiKey) {
          const updatedProvider: UiProvider = {
            ...currentProvider,
            apiKey: newApiKeyCandidate,
          }

          const nextProviders = [...stateToSave.providers]
          nextProviders[providerIndex] = updatedProvider
          stateToSave = {
            ...stateToSave,
            providers: nextProviders,
          }
        }
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
              {/* 左侧表单内容保持不变 */}
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
                <label className="field-label">Type</label>
                <select
                  className="field-select"
                  value={draft.providerType || 'openai'}
                  onChange={(e) => updateDraftField('providerType', e.target.value)}
                  onFocus={() => setActiveField('providerType')}
                >
                  <option value="dify">Dify</option>
                  <option value="openai">OpenAI Compatible</option>
                </select>
              </div>

              <div className="field-group">
                <label className="field-label">Description</label>
                <textarea
                  className="field-textarea"
                  rows={1}
                  value={draft.description}
                  onChange={handleDraftChange('description')}
                  onFocus={() => setActiveField('description')}
                />
              </div>

              {error && <div className="form-error">{error}</div>}
              {testResult && !error && <div className="form-success">{testResult}</div>}

              <div className="ai-settings-form-actions">
                <button type="button" className="ghost" onClick={handleResetDraft}>
                  Reset Form
                </button>
                <button type="button" className="ghost primary" onClick={handleTestConnection}>
                  Test
                </button>
                <button type="submit" className="ghost primary">
                  Add
                </button>
              </div>
            </form>
          </div>

          {/* 右侧 Provider 列表保持原有渲染 */}
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
                                <input
                                  className="provider-model-max-tokens-input"
                                  type="number"
                                  min={1}
                                  placeholder="max tokens"
                                  value={m.maxTokens ?? ''}
                                  onChange={(e) =>
                                    handleChangeModelMaxTokens(p.id, m.id, e.target.value)
                                  }
                                />
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
                            <button
                              type="button"
                              className="ghost primary"
                              onClick={() => handleEditProvider(p)}
                            >
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

        {showKeyOnlyModal && (
          <div className="ai-settings-submodal-backdrop">
            <div className="ai-settings-submodal">
              <div className="submodal-title">提示</div>
              <div className="submodal-body">
                检测到当前 Provider 没有新增模型，只修改了 API Key。
                <br />
                如需更新 API Key，请直接点击右下角的 Save 按钮保存配置。
              </div>
              <div className="submodal-actions">
                <button
                  type="button"
                  className="ghost primary"
                  onClick={() => setShowKeyOnlyModal(false)}
                >
                  知道了
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
