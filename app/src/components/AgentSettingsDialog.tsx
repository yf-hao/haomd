import type { ChangeEvent, FC, FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useEffect, useMemo, useState } from 'react'
import './AgentSettingsDialog.css'
import { useAgentSettingsPersistence } from '../hooks/useAgentSettingsPersistence'
import {
  type AgentKind,
  type AgentPlatform,
  type AgentProvider,
  emptyAgentSettings,
} from '../modules/ai/domain/types'
import { FieldGroup } from './FieldGroup'
import { Button } from './Button'
import { useI18n } from '../modules/i18n/I18nContext'
import { useDesktopTextEditingBridge } from '../hooks/useDesktopTextEditingBridge'

export type AgentSettingsDialogProps = {
  open: boolean
  onClose: () => void
  onOpenImageGeneration?: (agentId?: string | null) => void
}

type AgentTab = AgentKind

type AgentDraft = {
  name: string
  baseUrl: string
  apiKey: string
  kind: AgentKind
  platform: AgentPlatform
  modelId: string
  defaultAspectRatio: string
}

type AspectRatioOption = {
  value: string
  label: string
  disabled?: boolean
}

const emptyChatDraft: AgentDraft = {
  name: '',
  baseUrl: '',
  apiKey: '',
  kind: 'chat',
  platform: 'dify',
  modelId: '',
  defaultAspectRatio: '',
}

const emptyImageGenerationDraft: AgentDraft = {
  name: '',
  baseUrl: '',
  apiKey: '',
  kind: 'image_generation',
  platform: 'modelscope_image',
  modelId: '',
  defaultAspectRatio: '',
}

function createEmptyDraft(kind: AgentKind): AgentDraft {
  return kind === 'image_generation'
    ? { ...emptyImageGenerationDraft }
    : { ...emptyChatDraft }
}

export const AgentSettingsDialog: FC<AgentSettingsDialogProps> = ({ open, onClose, onOpenImageGeneration }) => {
  const { t } = useI18n()
  const { load, save } = useAgentSettingsPersistence()
  const [settings, setSettings] = useState(emptyAgentSettings)
  const [draft, setDraft] = useState<AgentDraft>(createEmptyDraft('chat'))
  const [activeTab, setActiveTab] = useState<AgentTab>('chat')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [initialSnapshot, setInitialSnapshot] = useState(emptyAgentSettings)
  const [platformOpen, setPlatformOpen] = useState(false)

  const platformOptionsByKind: Record<AgentKind, { value: AgentPlatform; label: string }[]> = {
    chat: [
      { value: 'dify', label: t('agent.platformDify') },
      { value: 'coze', label: t('agent.platformCoze') },
      { value: 'other', label: t('agent.platformOther') },
    ],
    image_generation: [
      { value: 'modelscope_image', label: t('agent.platformModelscopeImage') },
      { value: 'other', label: t('agent.platformOther') },
    ],
  }

  const platformOptions = platformOptionsByKind[draft.kind]
  const imageAspectRatioOptions: AspectRatioOption[] = [
    { value: '', label: t('agent.aspectRatioDisabled') },
    { value: '1:1', label: '1:1' },
    { value: '4:3', label: '4:3' },
    { value: '3:4', label: '3:4' },
    { value: '16:9', label: '16:9' },
    { value: '9:16', label: '9:16' },
  ]
  const selectedPlatformLabel =
    platformOptions.find((option) => option.value === draft.platform)?.label
    ?? platformOptions[0]?.label
    ?? draft.platform

  const visibleProviders = useMemo(
    () => settings.providers.filter((provider) => provider.kind === activeTab),
    [activeTab, settings.providers],
  )

  useEffect(() => {
    if (!open) return

    let disposed = false
    const doLoad = async () => {
      const state = await load()
      if (disposed) return
      setSettings(state)
      setInitialSnapshot(state)
      setActiveTab('chat')
      setDraft(createEmptyDraft('chat'))
      setEditingId(null)
      setError(null)
      setPlatformOpen(false)
    }

    void doLoad()

    return () => {
      disposed = true
    }
  }, [open, load])

  useEffect(() => {
    if (!open || !platformOpen) return
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target?.closest('.agent-platform-select')) {
        setPlatformOpen(false)
      }
    }
    const handleEsc = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPlatformOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [open, platformOpen])

  useEffect(() => {
    if (!open) return
    setPlatformOpen(false)
  }, [open, editingId, draft.platform, draft.kind, activeTab])

  const handleSelectPlatform = (value: AgentPlatform) => {
    setDraft((prev) => ({ ...prev, platform: value }))
    setPlatformOpen(false)
  }

  const handleTogglePlatform = () => {
    setPlatformOpen((prev) => !prev)
  }

  const handleKeyDownPlatform = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleTogglePlatform()
      return
    }
    if (event.key === 'Escape') {
      setPlatformOpen(false)
    }
  }

  const handleOptionKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, value: AgentPlatform) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleSelectPlatform(value)
    }
  }

  const getPlatformLabel = (value: AgentPlatform) => {
    return platformOptionsByKind.chat
      .concat(platformOptionsByKind.image_generation)
      .find((option) => option.value === value)?.label ?? value
  }

  const renderPlatformOption = (value: AgentPlatform) => (
    <button
      key={value}
      type="button"
      className={`agent-platform-option${draft.platform === value ? ' is-active' : ''}`}
      onClick={(event) => {
        event.preventDefault()
        handleSelectPlatform(value)
      }}
      onKeyDown={(event) => handleOptionKeyDown(event, value)}
    >
      <span className="agent-platform-option-label">{getPlatformLabel(value)}</span>
    </button>
  )

  const renderPlatformSelect = () => (
    <div className="agent-platform-select">
      <button
        type="button"
        className={`agent-platform-toggle${platformOpen ? ' is-open' : ''}`}
        onClick={handleTogglePlatform}
        onKeyDown={handleKeyDownPlatform}
        aria-expanded={platformOpen}
        aria-haspopup="listbox"
      >
        <span className="agent-platform-toggle-value">{selectedPlatformLabel}</span>
        <span className="agent-platform-toggle-chevron" aria-hidden="true">▾</span>
      </button>
      {platformOpen && (
        <div className="agent-platform-menu" role="listbox">
          {platformOptions.map((option) => renderPlatformOption(option.value))}
        </div>
      )}
    </div>
  )

  const handleTabChange = (nextTab: AgentTab) => {
    setActiveTab(nextTab)
    setEditingId(null)
    setPlatformOpen(false)
    setError(null)
    setDraft(createEmptyDraft(nextTab))
  }

  const handleResetDraft = () => {
    setDraft(createEmptyDraft(activeTab))
    setEditingId(null)
    setPlatformOpen(false)
  }

  const { handleKeyDownCapture } = useDesktopTextEditingBridge({
    enabled: open,
    onPasteError: (message) => {
      console.warn('[AgentSettingsDialog] native paste error:', message)
    },
  })

  const handleDraftChange = (field: keyof AgentDraft) => (
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    setDraft((prev) => ({
      ...prev,
      [field]: e.target.value,
    }))
  }

  const applyDraftToProvider = (): AgentProvider | null => {
    const name = draft.name.trim()
    const baseUrl = draft.baseUrl.trim()
    const apiKey = draft.apiKey.trim()
    const modelId = draft.modelId.trim()
    if (!name || !baseUrl || !apiKey) {
      setError(t('agent.fillRequired'))
      return null
    }
    if (draft.kind === 'image_generation' && !modelId) {
      setError(t('agent.fillModelId'))
      return null
    }

    return {
      id: editingId ?? `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      baseUrl,
      apiKey,
      kind: draft.kind,
      platform: draft.platform,
      modelId: modelId || undefined,
      defaultAspectRatio:
        draft.kind === 'image_generation'
          ? (draft.defaultAspectRatio.trim() || undefined)
          : undefined,
    }
  }

  const handleAddOrUpdate = (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    const provider = applyDraftToProvider()
    if (!provider) return

    setSettings((prev) => {
      const existingIndex = prev.providers.findIndex((p) => p.id === provider.id)
      const nextProviders = [...prev.providers]
      if (existingIndex >= 0) {
        nextProviders[existingIndex] = provider
      } else {
        nextProviders.push(provider)
      }

      return {
        providers: nextProviders,
        defaultProviderId: prev.defaultProviderId,
      }
    })

    handleResetDraft()
  }

  const handleEdit = (provider: AgentProvider) => {
    setEditingId(provider.id)
    setActiveTab(provider.kind)
    setDraft({
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      kind: provider.kind,
      platform: provider.platform,
      modelId: provider.modelId ?? '',
      defaultAspectRatio: provider.defaultAspectRatio ?? '',
    })
    setPlatformOpen(false)
  }

  const handleDelete = (id: string) => {
    setSettings((prev) => {
      const nextProviders = prev.providers.filter((p) => p.id !== id)
      const nextDefault = prev.defaultProviderId === id ? nextProviders[0]?.id : prev.defaultProviderId
      return {
        providers: nextProviders,
        defaultProviderId: nextDefault,
      }
    })

    if (editingId === id) {
      handleResetDraft()
    }
  }

  const handleSetDefault = (id: string) => {
    setSettings((prev) => ({
      ...prev,
      defaultProviderId: id,
    }))
  }

  const handleCancel = () => {
    setSettings(initialSnapshot)
    setDraft(createEmptyDraft(activeTab))
    setEditingId(null)
    setError(null)
    onClose()
  }

  const handleCancelWithReset = () => {
    setPlatformOpen(false)
    handleCancel()
  }

  useEffect(() => {
    if (!open) return
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleCancelWithReset()
      }
    }
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('keydown', handleEsc)
    }
  }, [open, activeTab, initialSnapshot])

  const handleSave = async () => {
    const hasDraft =
      draft.name.trim()
      || draft.baseUrl.trim()
      || draft.apiKey.trim()
      || draft.modelId.trim()
      || draft.defaultAspectRatio.trim()

    if (hasDraft) {
      const provider = applyDraftToProvider()
      if (!provider) return

      const nextProviders = [...settings.providers]
      const existingIndex = nextProviders.findIndex((p) => p.id === provider.id)
      if (existingIndex >= 0) {
        nextProviders[existingIndex] = provider
      } else {
        nextProviders.push(provider)
      }

      const nextSettings = {
        providers: nextProviders,
        defaultProviderId: settings.defaultProviderId,
      }

      const ok = await save(nextSettings)
      if (!ok) {
        setError(t('agent.saveFailed'))
        return
      }

      setSettings(nextSettings)
      setInitialSnapshot(nextSettings)
      handleResetDraft()
      setError(null)
      onClose()
      return
    }

    if (!settings.providers.length) {
      setError(t('agent.needAtLeastOne'))
      return
    }

    const ok = await save(settings)
    if (!ok) {
      setError(t('agent.saveFailed'))
      return
    }

    setInitialSnapshot(settings)
    setError(null)
    onClose()
  }

  const defaultProvider = settings.providers.find((p) => p.id === settings.defaultProviderId)
  const currentTabDefaultProvider = defaultProvider?.kind === activeTab ? defaultProvider : null
  const preferredImageGenerationProvider =
    activeTab === 'image_generation'
      ? settings.providers.find((provider) => provider.id === editingId && provider.kind === 'image_generation')
        ?? currentTabDefaultProvider
        ?? visibleProviders[0]
        ?? null
      : null

  if (!open) return null

  return (
    <div className="modal-backdrop">
      <div className="modal modal-agent-settings" onKeyDownCapture={handleKeyDownCapture}>
        <div className="modal-title">{t('agent.title')}</div>
        <div className="agent-settings-tabs" role="tablist" aria-label={t('agent.title')}>
          <button
            type="button"
            className={`agent-settings-tab${activeTab === 'chat' ? ' is-active' : ''}`}
            onClick={() => handleTabChange('chat')}
          >
            {t('agent.chatTab')}
          </button>
          <button
            type="button"
            className={`agent-settings-tab${activeTab === 'image_generation' ? ' is-active' : ''}`}
            onClick={() => handleTabChange('image_generation')}
          >
            {t('agent.imageGenerationTab')}
          </button>
        </div>
        <div className="modal-content agent-settings-body">
          <div className="agent-settings-column-left">
            <form onSubmit={handleAddOrUpdate} className="agent-settings-form">
              <FieldGroup label={t('agent.name')}>
                <input
                  className="field-input"
                  type="text"
                  data-agent-field="name"
                  value={draft.name}
                  onChange={handleDraftChange('name')}
                />
              </FieldGroup>
              <FieldGroup label={t('agent.baseUrl')}>
                <input
                  className="field-input"
                  type="text"
                  data-agent-field="baseUrl"
                  value={draft.baseUrl}
                  onChange={handleDraftChange('baseUrl')}
                />
              </FieldGroup>
              <FieldGroup label={t('agent.apiKey')}>
                <input
                  className="field-input"
                  type="password"
                  data-agent-field="apiKey"
                  value={draft.apiKey}
                  onChange={handleDraftChange('apiKey')}
                />
              </FieldGroup>
              <FieldGroup label={t('agent.platform')}>
                <div data-agent-field="platform">{renderPlatformSelect()}</div>
              </FieldGroup>
              {draft.kind === 'image_generation' && (
                <>
                  <FieldGroup label={t('agent.modelId')}>
                    <input
                      className="field-input"
                      type="text"
                      data-agent-field="modelId"
                      value={draft.modelId}
                      onChange={handleDraftChange('modelId')}
                    />
                  </FieldGroup>
                  <FieldGroup label={t('agent.defaultAspectRatio')}>
                    <select
                      className="field-select"
                      value={draft.defaultAspectRatio}
                      onChange={(event) => {
                        setDraft((prev) => ({ ...prev, defaultAspectRatio: event.target.value }))
                      }}
                    >
                      {imageAspectRatioOptions.map((option) => (
                        <option key={option.value} value={option.value} disabled={option.disabled}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </FieldGroup>
                </>
              )}

              <div className="agent-settings-actions">
                <Button variant="tertiary" type="button" onClick={handleResetDraft}>
                  {t('agent.resetDraft')}
                </Button>
                <Button type="submit">{editingId ? t('agent.update') : t('agent.add')}</Button>
              </div>
            </form>
          </div>

          <div className="agent-settings-column-right">
            <div className="agent-provider-list">
              {visibleProviders.length === 0 && (
                <div className="agent-meta">{t('agent.noProvider')}</div>
              )}
              {visibleProviders.map((provider) => {
                const isDefault = provider.id === settings.defaultProviderId
                const isEditing = provider.id === editingId
                return (
                  <div
                    key={provider.id}
                    className={`agent-provider-card${isEditing ? ' is-active' : ''}`}
                  >
                    <div className="agent-provider-header">
                      <div className="agent-provider-name">{provider.name}</div>
                      {isDefault && <div className="agent-provider-default">{t('agent.defaultBadge')}</div>}
                    </div>
                    <div className="agent-provider-meta">
                      <div>{t('agent.baseUrlLabel', { url: provider.baseUrl })}</div>
                      <div>{t('agent.platformLabel', { platform: getPlatformLabel(provider.platform) })}</div>
                      {provider.kind === 'image_generation' && provider.modelId && (
                        <div>{t('agent.modelIdLabel', { model: provider.modelId })}</div>
                      )}
                      {provider.kind === 'image_generation' && provider.defaultAspectRatio && (
                        <div>{t('agent.defaultAspectRatioLabel', { ratio: provider.defaultAspectRatio })}</div>
                      )}
                    </div>
                    <div className="agent-provider-actions">
                      <Button variant="tertiary" onClick={() => handleEdit(provider)}>
                        {t('agent.edit')}
                      </Button>
                      <Button variant="tertiary" onClick={() => handleSetDefault(provider.id)}>
                        {t('agent.setDefault')}
                      </Button>
                      <Button variant="tertiary" onClick={() => handleDelete(provider.id)}>
                        {t('agent.delete')}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
            {currentTabDefaultProvider && (
              <div className="agent-subtle">
                {t('agent.defaultProvider', { name: currentTabDefaultProvider.name })}
              </div>
            )}
            {activeTab === 'image_generation' && (
              <div className="agent-settings-actions">
                <Button
                  variant="tertiary"
                  type="button"
                  disabled={!preferredImageGenerationProvider}
                  onClick={() => onOpenImageGeneration?.(preferredImageGenerationProvider?.id ?? null)}
                >
                  {t('agent.openImageGeneration')}
                </Button>
              </div>
            )}
          </div>
        </div>
        <div className="agent-settings-footer">
          {error && <div className="form-error">{error}</div>}
          <div className="agent-settings-actions">
            <Button variant="tertiary" type="button" onClick={handleCancelWithReset}>
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={handleSave}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
