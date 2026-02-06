import type { FC, MouseEventHandler, ChangeEvent, FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import './AiSettingsDialog.css'
import { onNativePaste, onNativePasteError } from '../modules/platform/clipboardEvents'

export type AiSettingsDialogProps = {
  open: boolean
  onClose: () => void
}

type UiProviderModel = {
  id: string
}

type UiProvider = {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  models: UiProviderModel[]
  defaultModelId?: string
  description?: string
}

type AiSettingsState = {
  providers: UiProvider[]
  defaultProviderId?: string
}

type ProviderDraft = {
  name: string
  baseUrl: string
  apiKey: string
  modelsInput: string
  description: string
}

const emptyDraft: ProviderDraft = {
  name: '',
  baseUrl: '',
  apiKey: '',
  modelsInput: '',
  description: '',
}

const emptySettings: AiSettingsState = {
  providers: [],
  defaultProviderId: undefined,
}

// 后端配置类型（与 Rust 侧 AiSettingsCfg 对应）
type AiProviderModelCfg = {
  id: string
}

type AiProviderCfg = {
  id: string
  name: string
  base_url: string
  api_key: string
  models: AiProviderModelCfg[]
  default_model_id?: string | null
  description?: string | null
}

type AiSettingsCfg = {
  providers: AiProviderCfg[]
  default_provider_id?: string | null
}

type BackendCode =
  | 'OK'
  | 'CANCELLED'
  | 'IoError'
  | 'NotFound'
  | 'TooLarge'
  | 'CONFLICT'
  | 'InvalidPath'
  | 'UNSUPPORTED'
  | 'UNKNOWN'

type BackendError = { code: BackendCode; message: string; trace_id?: string }

type BackendOk<T> = { data: T; trace_id?: string }

type BackendResult<T> = { Ok: BackendOk<T> } | { Err: { error: BackendError } }

function normalizeProviderName(name: string): string {
  return name.trim().toLocaleLowerCase('en-US')
}

function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim()
  // 去掉末尾多余的 '/'
  return trimmed.replace(/\/+$/, '')
}

function parseModelsInput(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  )
}

function fromCfg(cfg: AiSettingsCfg | null | undefined): AiSettingsState {
  if (!cfg) return emptySettings

  return {
    providers: (cfg.providers ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      baseUrl: p.base_url,
      apiKey: p.api_key,
      models: (p.models ?? []).map((m) => ({ id: m.id })),
      defaultModelId: p.default_model_id ?? undefined,
      description: p.description ?? undefined,
    })),
    defaultProviderId: cfg.default_provider_id ?? undefined,
  }
}

function toCfg(state: AiSettingsState): AiSettingsCfg {
  return {
    providers: state.providers.map((p) => ({
      id: p.id,
      name: p.name,
      base_url: p.baseUrl,
      api_key: p.apiKey,
      models: p.models.map((m) => ({ id: m.id })),
      default_model_id: p.defaultModelId ?? null,
      description: p.description ?? null,
    })),
    default_provider_id: state.defaultProviderId ?? null,
  }
}

export const AiSettingsDialog: FC<AiSettingsDialogProps> = ({ open, onClose }) => {
  const [draft, setDraft] = useState<ProviderDraft>(emptyDraft)
  const [settings, setSettings] = useState<AiSettingsState>(emptySettings)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [initialSnapshot, setInitialSnapshot] = useState<AiSettingsState | null>(null)
  const [activeField, setActiveField] = useState<keyof ProviderDraft | null>(null)

  // 打开对话框时，从后端加载配置
  useEffect(() => {
    if (!open) return

    let disposed = false

    const load = async () => {
      try {
        const resp = await invoke<BackendResult<AiSettingsCfg>>('load_ai_settings')
        if (disposed) return

        if ('Ok' in resp) {
          const state = fromCfg(resp.Ok.data)
          setSettings(state)
          setInitialSnapshot(state)
        } else {
          console.error('Failed to load ai_settings (backend error):', resp.Err.error)
        }
      } catch (err) {
        console.error('Failed to load ai_settings:', err)
      }
    }

    void load()

    return () => {
      disposed = true
    }
  }, [open])

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

  const defaultProvider = settings.providers.find((p) => p.id === settings.defaultProviderId) ?? null

  if (!open) return null

  const handleDraftChange = (field: keyof ProviderDraft) => (
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const value = e.target.value
    setDraft((prev) => ({ ...prev, [field]: value }))
  }

  const handleResetDraft = () => {
    setDraft(emptyDraft)
    setError(null)
  }

  const handleTestAndAdd = (e: FormEvent) => {
    e.preventDefault()

    const models = parseModelsInput(draft.modelsInput)
    if (!draft.name.trim() || !draft.baseUrl.trim() || !draft.apiKey.trim()) {
      setError('请填写 Provider Name / Base URL / API Key')
      return
    }
    if (models.length === 0) {
      setError('请至少填写一个 ModelID')
      return
    }

    // 查找是否存在“同名（忽略大小写）且 Base URL 相同”的 Provider
    const targetName = normalizeProviderName(draft.name)
    const targetUrl = normalizeBaseUrl(draft.baseUrl)

    const existing = settings.providers.find(
      (p) =>
        normalizeProviderName(p.name) === targetName &&
        normalizeBaseUrl(p.baseUrl) === targetUrl,
    )

    if (existing) {
      // 追加新模型到已有 Provider，避免重复
      const existingIds = new Set(existing.models.map((m) => m.id))
      const newIds = models.filter((id) => !existingIds.has(id))

      if (newIds.length === 0) {
        setError('该 Provider 已包含这些模型，无需重复添加')
        return
      }

      setSettings((prev) => {
        const providers = prev.providers.map((p) => {
          if (p.id !== existing.id) return p

          const pExistingIds = new Set(p.models.map((m) => m.id))
          const reallyNewIds = models.filter((id) => !pExistingIds.has(id))
          if (reallyNewIds.length === 0) return p

          const newModels = reallyNewIds.map((id) => ({ id }))
          return {
            ...p,
            models: [...p.models, ...newModels],
            defaultModelId: p.defaultModelId ?? reallyNewIds[0],
          }
        })

        return { ...prev, providers }
      })

      setExpandedId(existing.id)
      setDraft(emptyDraft)
      setError(null)
      return
    }

    // 不存在同名且 Base URL 相同的 Provider，正常新增一个
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

    setSettings((prev) => {
      const next: AiSettingsState = {
        providers: [...prev.providers, provider],
        defaultProviderId: prev.defaultProviderId ?? id,
      }
      return next
    })

    setExpandedId(id)
    setDraft(emptyDraft)
    setError(null)
  }

  const handleDeleteProvider = (id: string) => {
    setSettings((prev) => {
      const providers = prev.providers.filter((p) => p.id !== id)
      let defaultProviderId = prev.defaultProviderId
      if (defaultProviderId === id) {
        defaultProviderId = providers[0]?.id
      }
      if (!providers.length) {
        defaultProviderId = undefined
      }
      if (expandedId === id) {
        setExpandedId(null)
      }
      return { providers, defaultProviderId }
    })
  }

  const handleRemoveModel = (providerId: string, modelId: string) => {
    setSettings((prev) => {
      const providers = prev.providers.map((p) => {
        if (p.id !== providerId) return p
        const models = p.models.filter((m) => m.id !== modelId)
        let defaultModelId = p.defaultModelId
        if (defaultModelId === modelId) {
          defaultModelId = models[0]?.id
        }
        return { ...p, models, defaultModelId }
      })
      return { ...prev, providers }
    })
  }

  const handleChangeDefaultModel = (providerId: string, modelId: string) => {
    setSettings((prev) => ({
      ...prev,
      providers: prev.providers.map((p) => (p.id === providerId ? { ...p, defaultModelId: modelId } : p)),
    }))
  }

  const handleChangeDefaultProvider = (providerId: string) => {
    setSettings((prev) => ({ ...prev, defaultProviderId: providerId }))
  }

  const handleEditProvider = (provider: UiProvider) => {
    const modelsInput = provider.models.map((m) => m.id).join(', ')
    setDraft({
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      modelsInput,
      description: provider.description ?? '',
    })
    setExpandedId(provider.id)
  }

  const handleCancel = () => {
    if (initialSnapshot) {
      setSettings(initialSnapshot)
    }
    onClose()
  }

  const handleSave = async () => {
    try {
      let stateToSave = settings

      // 如果当前还没有任何 Provider，但左侧表单里已经填写了内容，
      // 则自动将草稿作为一个新的 Provider 一并保存，避免用户“只点 Save 不点 Test & Add” 时丢配置。
      const hasDraft =
        draft.name.trim() ||
        draft.baseUrl.trim() ||
        draft.apiKey.trim() ||
        draft.modelsInput.trim() ||
        draft.description.trim()

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

      const cfg = toCfg(stateToSave)
      await invoke('save_ai_settings', { cfg })
      setSettings(stateToSave)
      setInitialSnapshot(stateToSave)
      setDraft(emptyDraft)
      setError(null)
      onClose()
    } catch (err) {
      console.error('Failed to save ai_settings:', err)
      setError('保存失败：请稍后重试')
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal modal-ai-settings">
        <div className="modal-title">AI Settings</div>
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
                <button type="submit" className="ghost primary">
                  Test &amp; Add Provider
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
