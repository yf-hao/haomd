import type { FC, ChangeEvent, FormEvent } from 'react'
import { useEffect, useState } from 'react'
import './AiSettingsDialog.css'
import { onNativePaste, onNativePasteError } from '../modules/platform/clipboardEvents'
import { emptySettings, type UiProvider, type ProviderType } from '../modules/ai/settings'
import { useAiSettingsPersistence } from '../hooks/useAiSettingsPersistence'
import { useAiSettingsState, type ProviderDraft, parseModelsInput } from '../hooks/useAiSettingsState'
import { testProviderConnection } from '../modules/ai/testConnection'
import { useI18n } from '../modules/i18n/I18nContext'
import { FieldGroup } from './FieldGroup'
import { Button } from './Button'

export type AiSettingsDialogProps = {
  open: boolean
  onClose: () => void
}

export const AiSettingsDialog: FC<AiSettingsDialogProps> = ({ open, onClose }) => {
  const { t } = useI18n()
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
    setInitialSnapshot,
    defaultProvider,
    updateDraftField,
    resetDraft,
    addOrMergeProviderFromDraft,
    updateProviderFromDraft,
    deleteProvider,
    removeModel,
    setDefaultModel,
    setDefaultProvider,
    editProviderIntoDraft,
    applyInitialSnapshot,
    updateInitialSnapshot,
    updateModelMaxTokens,
    updateModelVisionMode,
  } = useAiSettingsState(emptySettings)

  const AI_FORM_FIELDS: { key: keyof ProviderDraft; label: string; type: 'text' | 'password' | 'textarea'; placeholder?: string }[] = [
    { key: 'name', label: t('provider.providerName'), type: 'text' },
    { key: 'baseUrl', label: t('provider.baseUrl'), type: 'text' },
    { key: 'apiKey', label: t('provider.apiKey'), type: 'password' },
    { key: 'modelsInput', label: t('provider.models'), type: 'text', placeholder: t('provider.modelsPlaceholder') },
    { key: 'description', label: t('provider.parameters'), type: 'textarea' },
  ]

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
  }, [open, activeField, setDraft])

  if (!open) return null

  const editingProvider =
    editingProviderId != null
      ? settings.providers.find((provider) => provider.id === editingProviderId) ?? null
      : null
  const isEditingProvider = !!editingProvider

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
      setError(t('provider.fillBaseUrlApiKey'))
      setTestResult(null)
      return
    }
    if (models.length === 0) {
      setError(t('provider.fillAtLeastOneModel'))
      setTestResult(null)
      return
    }

    // 清理之前的状态，展示测试中提示
    setError(null)
    setTestResult(t('provider.testingConnection'))

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

      const total = models.length
      const failedCount = failed.length
      const successCount = total - failedCount

      if (failedCount === 0) {
        // 全部通过
        setTestResult(t('provider.testSuccess', { count: total }))
      } else {
        // 部分或全部失败：提示成功数量 + 失败详情
        setTestResult(null)
        setError(t('provider.testSummary', {
          total,
          success: successCount,
          details: failed.join('\n'),
        }))
      }
    } catch (e) {
      const err = e as Error
      setTestResult(null)
      setError(t('provider.testException', { message: err.message || 'Unknown error' }))
    }
  }

  const handleSubmitDraft = (e: FormEvent) => {
    e.preventDefault()
    if (editingProviderId) {
      const updated = updateProviderFromDraft(editingProviderId)
      if (updated) {
        setTestResult(null)
      }
      return
    }
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

  const handleChangeModelVisionMode = (
    providerId: string,
    modelId: string,
    value: 'disabled' | 'enabled',
  ) => {
    updateModelVisionMode(providerId, modelId, value)
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
        setError(t('provider.fillRequiredBeforeSave'))
        return
      }
      if (models.length === 0) {
        setError(t('provider.fillModelBeforeSave'))
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
        providerType: (draft.providerType || 'dify') as ProviderType,
        visionMode: draft.visionMode || undefined,
      }

      stateToSave = {
        providers: [...settings.providers, provider],
        defaultProviderId: settings.defaultProviderId ?? id,
      }
    }

    if (settings.providers.length && editingProviderId) {
      const updated = updateProviderFromDraft(editingProviderId)
      if (!updated) {
        return
      }
      const models = parseModelsInput(draft.modelsInput)
      const currentProvider = stateToSave.providers.find((p) => p.id === editingProviderId)
      if (currentProvider) {
        const existingModelsById = new Map(currentProvider.models.map((m) => [m.id, m]))
        const nextModels = models.map((id) => {
          const existingModel = existingModelsById.get(id)
          if (existingModel) return existingModel
          return {
            id,
            visionMode: draft.visionMode || 'disabled',
          }
        })

        stateToSave = {
          ...stateToSave,
          providers: stateToSave.providers.map((p) =>
            p.id !== editingProviderId
              ? p
              : {
                  ...p,
                  name: draft.name.trim(),
                  baseUrl: draft.baseUrl.trim(),
                  apiKey: draft.apiKey.trim(),
                  description: draft.description.trim() || undefined,
                  providerType: (draft.providerType || 'dify') as ProviderType,
                  visionMode: draft.visionMode || 'disabled',
                  models: nextModels,
                  defaultModelId:
                    p.defaultModelId && nextModels.some((m) => m.id === p.defaultModelId)
                      ? p.defaultModelId
                      : nextModels[0]?.id,
                },
          ),
        }
      }
    }

    const ok = await save(stateToSave)
    if (!ok) {
      setError(t('provider.saveFailed'))
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
        <div className="modal-title">{t('provider.title')}</div>
        <div className="modal-content ai-settings-body">
          <div className="ai-settings-column-left">
            <form onSubmit={handleSubmitDraft} className="ai-settings-form">
              <div className="providers-header">
                {isEditingProvider
                  ? t('provider.editingProvider', { name: editingProvider?.name ?? '' })
                  : t('provider.newProviderDraft')}
              </div>
              {AI_FORM_FIELDS.map((field) => (
                <FieldGroup key={field.key} label={field.label}>
                  {field.type === 'textarea' ? (
                    <textarea
                      className="field-textarea"
                      rows={1}
                      value={draft[field.key]}
                      onChange={handleDraftChange(field.key)}
                      onFocus={() => setActiveField(field.key)}
                    />
                  ) : (
                    <input
                      className="field-input"
                      type={field.type}
                      placeholder={field.placeholder}
                      value={draft[field.key]}
                      onChange={handleDraftChange(field.key)}
                      onFocus={() => setActiveField(field.key)}
                    />
                  )}
                </FieldGroup>
              ))}

              <FieldGroup label={t('provider.type')}>
                <select
                  className="field-select"
                  value={draft.providerType || 'openai'}
                  onChange={(e) => updateDraftField('providerType', e.target.value)}
                  onFocus={() => setActiveField('providerType')}
                >
                  <option value="dify">{t('provider.dify')}</option>
                  <option value="openai">{t('provider.openaiCompatible')}</option>
                </select>
              </FieldGroup>

              <FieldGroup label={t('provider.visionMode')}>
                <select
                  className="field-select"
                  value={draft.visionMode || 'disabled'}
                  onChange={(e) => updateDraftField('visionMode', e.target.value)}
                  onFocus={() => setActiveField('visionMode')}
                >
                  <option value="disabled">{t('provider.disabled')}</option>
                  <option value="enabled">{t('provider.enabled')}</option>
                </select>
              </FieldGroup>

              {error && <div className="form-error">{error}</div>}
              {testResult && !error && <div className="form-success">{testResult}</div>}

              <div className="ai-settings-form-actions">
                <Button type="button" variant="tertiary" onClick={handleResetDraft}>
                  {isEditingProvider ? t('common.cancel') : t('provider.resetForm')}
                </Button>
                <Button type="button" variant="secondary" onClick={handleTestConnection}>
                  {t('provider.test')}
                </Button>
                <Button type="submit" variant="primary">
                  {isEditingProvider ? t('provider.update') : t('provider.add')}
                </Button>
              </div>
            </form>
          </div>

          <div className="ai-settings-column-right">
            <div className="providers-header">{t('provider.configuredProviders')}</div>
            {settings.providers.length === 0 ? (
              <div className="providers-empty">{t('provider.noProvider')}</div>
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
                          <div className="provider-name-row">
                            <div className="provider-name">{p.name}</div>
                            <div className="provider-default-model">
                              {p.defaultModelId ? t('provider.defaultLabel', { model: p.defaultModelId }) : ''}
                            </div>
                          </div>
                          <div className="provider-sub">
                            {t('provider.baseUrlLabel', { url: p.baseUrl })}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="provider-toggle"
                          aria-label={isExpanded ? t('provider.collapse') : t('provider.expand')}
                        >
                          {isExpanded ? '▼' : '▶'}
                        </button>
                      </div>

                      {isExpanded && (
                        <div className="provider-details">
                          <div className="provider-detail-row">{t('provider.modelsTitle')}</div>
                          <ul className="provider-models">
                            {p.models.map((m) => (
                              <li key={m.id} className="provider-model-row">
                                <span className="provider-model-id">{m.id}</span>
                                <input
                                  className="field-input provider-model-max-tokens-input"
                                  type="number"
                                  min={1}
                                  placeholder={t('provider.maxTokensPlaceholder')}
                                  value={m.maxTokens ?? ''}
                                  onChange={(e) =>
                                    handleChangeModelMaxTokens(p.id, m.id, e.target.value)
                                  }
                                />
                                <select
                                  className="field-select provider-model-vision-select"
                                  value={m.visionMode || 'disabled'}
                                  onChange={(e) =>
                                    handleChangeModelVisionMode(
                                      p.id,
                                      m.id,
                                      e.target.value as 'disabled' | 'enabled',
                                    )
                                  }
                                >
                                  <option value="disabled">{t('provider.visionDisabled')}</option>
                                  <option value="enabled">{t('provider.visionEnabled')}</option>
                                </select>
                                <button
                                  type="button"
                                  className="ghost tiny ghost-subtle"
                                  onClick={() => handleRemoveModel(p.id, m.id)}
                                >
                                  {t('provider.remove')}
                                </button>
                              </li>
                            ))}
                          </ul>

                          <div className="provider-detail-row default-model-row">
                            <select
                              className="field-select provider-model-select"
                              value={p.defaultModelId ?? ''}
                              onChange={(e) => handleChangeDefaultModel(p.id, e.target.value)}
                            >
                              {p.models.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {t('provider.defaultModel', { model: m.id })}
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
                              {t('provider.editProvider')}
                            </button>
                            <button
                              type="button"
                              className="ghost danger"
                              onClick={() => handleDeleteProvider(p.id)}
                            >
                              {t('provider.deleteProvider')}
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
                {t('provider.defaultChatModel', {
                  provider: defaultProvider.name,
                  modelSuffix: defaultProvider.defaultModelId ? ` / ${defaultProvider.defaultModelId}` : '',
                })}
              </div>
            )}
          </div>
        </div>

        <div className="modal-actions">
          <Button variant="tertiary" type="button" onClick={handleCancel}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" type="button" onClick={handleSave}>
            {t('common.save')}
          </Button>
        </div>

        {showKeyOnlyModal && (
          <div className="ai-settings-submodal-backdrop">
            <div className="ai-settings-submodal">
              <div className="submodal-title">{t('provider.keyOnlyTitle')}</div>
              <div className="submodal-body">
                {t('provider.keyOnlyBodyLine1')}
                <br />
                {t('provider.keyOnlyBodyLine2')}
              </div>
              <div className="submodal-actions">
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => setShowKeyOnlyModal(false)}
                >
                  {t('provider.gotIt')}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
