import type { ChangeEvent, FC, FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useEffect, useState } from 'react'
import { onNativePaste, onNativePasteError } from '../modules/platform/clipboardEvents'
import './AgentSettingsDialog.css'
import { useAgentSettingsPersistence } from '../hooks/useAgentSettingsPersistence'
import { type AgentPlatform, type AgentProvider, emptyAgentSettings } from '../modules/ai/domain/types'
import { FieldGroup } from './FieldGroup'
import { Button } from './Button'
import { useI18n } from '../modules/i18n/I18nContext'

export type AgentSettingsDialogProps = {
  open: boolean
  onClose: () => void
}

type AgentDraft = {
  name: string
  baseUrl: string
  apiKey: string
  platform: AgentPlatform
}

const emptyDraft: AgentDraft = {
  name: '',
  baseUrl: '',
  apiKey: '',
  platform: 'dify',
}

export const AgentSettingsDialog: FC<AgentSettingsDialogProps> = ({ open, onClose }) => {
  const { t } = useI18n()
  const { load, save } = useAgentSettingsPersistence()
  const [settings, setSettings] = useState(emptyAgentSettings)
  const [draft, setDraft] = useState<AgentDraft>(emptyDraft)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [initialSnapshot, setInitialSnapshot] = useState(emptyAgentSettings)
  const [platformOpen, setPlatformOpen] = useState(false)

  const platformOptions: { value: AgentPlatform; label: string }[] = [
    { value: 'dify', label: t('agent.platformDify') },
    { value: 'coze', label: t('agent.platformCoze') },
    { value: 'other', label: t('agent.platformOther') },
  ]
  const selectedPlatformLabel =
    platformOptions.find((option) => option.value === draft.platform)?.label ?? t('agent.platformDify')

  useEffect(() => {
    if (!open) return

    let disposed = false
    const doLoad = async () => {
      const state = await load()
      if (disposed) return
      setSettings(state)
      setInitialSnapshot(state)
      setDraft(emptyDraft)
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
  }, [open, editingId, draft.platform])

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
    return platformOptions.find((option) => option.value === value)?.label ?? value
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

  const handleResetDraft = () => {
    resetDraft()
    setPlatformOpen(false)
  }

  const handleCancelWithReset = () => {
    setPlatformOpen(false)
    handleCancel()
  }

  useEffect(() => {
    if (!open) return

    const unPaste = onNativePaste((text) => {
      if (!text) return

      setDraft((prev) => {
        if (typeof document === 'undefined') return prev
        const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
        if (!active || (active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA')) return prev

        const field = (active.getAttribute('data-agent-field') as keyof AgentDraft | null) ?? null
        if (!field) return prev

        const current = prev[field] ?? ''
        const start = active.selectionStart ?? current.length
        const end = active.selectionEnd ?? current.length
        const nextValue = current.slice(0, start) + text + current.slice(end)

        active.value = nextValue
        const pos = start + text.length
        active.setSelectionRange(pos, pos)

        return {
          ...prev,
          [field]: nextValue,
        }
      })
    })

    const unError = onNativePasteError((message) => {
      console.warn('[AgentSettingsDialog] native paste error:', message)
    })

    return () => {
      unPaste()
      unError()
    }
  }, [open])

  const handleDraftChange = (field: keyof AgentDraft) => (
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    setDraft((prev) => ({
      ...prev,
      [field]: e.target.value,
    }))
  }

  const resetDraft = () => {
    setDraft(emptyDraft)
    setEditingId(null)
  }

  const applyDraftToProvider = (): AgentProvider | null => {
    const name = draft.name.trim()
    const baseUrl = draft.baseUrl.trim()
    const apiKey = draft.apiKey.trim()
    if (!name || !baseUrl || !apiKey) {
      setError(t('agent.fillRequired'))
      return null
    }

    return {
      id: editingId ?? `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      baseUrl,
      apiKey,
      platform: draft.platform,
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

    resetDraft()
  }

  const handleEdit = (provider: AgentProvider) => {
    setEditingId(provider.id)
    setDraft({
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      platform: provider.platform ?? 'dify',
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
      resetDraft()
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
    resetDraft()
    setError(null)
    onClose()
  }

  const handleSave = async () => {
    const hasDraft = draft.name.trim() || draft.baseUrl.trim() || draft.apiKey.trim()

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
      resetDraft()
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

  if (!open) return null

  return (
    <div className="modal-backdrop">
      <div className="modal modal-agent-settings">
        <div className="modal-title">{t('agent.title')}</div>
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

              <div className="agent-settings-actions">
                <Button type="submit">{editingId ? t('agent.update') : t('agent.add')}</Button>
                <Button variant="tertiary" type="button" onClick={handleResetDraft}>
                  {t('agent.resetDraft')}
                </Button>
              </div>
            </form>
          </div>

          <div className="agent-settings-column-right">
            <div className="agent-provider-list">
              {settings.providers.length === 0 && (
                <div className="agent-meta">{t('agent.noProvider')}</div>
              )}
              {settings.providers.map((provider) => {
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
            {defaultProvider && (
              <div className="agent-subtle">
                {t('agent.defaultProvider', { name: defaultProvider.name })}
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
