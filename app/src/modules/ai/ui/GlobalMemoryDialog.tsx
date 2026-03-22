import type { FC } from 'react'
import { useEffect, useState } from 'react'
import {
  loadUserProfile,
  loadGlobalMemoryItems,
  loadGlobalMemoryState,
  saveGlobalMemoryItems,
  clearGlobalMemoryState,
} from '../globalMemory/repo'
import { loadGlobalMemorySettings, saveGlobalMemorySettings } from '../globalMemory/settingsRepo'
import { runGlobalMemoryUpdateNow } from '../globalMemory/autoUpdate'
import type { UserProfile, GlobalMemoryItem, GlobalMemorySettings } from '../globalMemory/types'
import { useI18n } from '../../i18n/I18nContext'

export type GlobalMemoryDialogInitialTab = 'persona' | 'manage'

export type GlobalMemoryDialogProps = {
  open: boolean
  initialTab?: GlobalMemoryDialogInitialTab
  onClose: () => void
}

function formatLastUpdated(profile: UserProfile | null): string {
  if (!profile || !profile.updatedAt) return ''
  const d = new Date(profile.updatedAt)
  return d.toLocaleString()
}

function formatGlobalUpdateTime(timestamp: number | null): string {
  if (!timestamp) return ''
  const d = new Date(timestamp)
  return d.toLocaleString()
}

export const GlobalMemoryDialog: FC<GlobalMemoryDialogProps> = ({ open, initialTab = 'persona', onClose }) => {
  const { t } = useI18n()
  const [activeTab, setActiveTab] = useState<GlobalMemoryDialogInitialTab>(initialTab)
  const [profile, setProfile] = useState<UserProfile | null>(() => loadUserProfile())
  const [items, setItems] = useState<GlobalMemoryItem[]>(() => loadGlobalMemoryItems())
  const [settings, setSettings] = useState<GlobalMemorySettings>(() => loadGlobalMemorySettings())
  const [lastGlobalUpdate, setLastGlobalUpdate] = useState<number | null>(() => {
    const state = loadGlobalMemoryState()
    return state.lastGlobalUpdateTime
  })
  const [pendingCount, setPendingCount] = useState<number>(() => {
    const state = loadGlobalMemoryState()
    return state.pendingDigests.length
  })
  const [isUpdating, setIsUpdating] = useState(false)
  const [isClearing, setIsClearing] = useState(false)

  useEffect(() => {
    if (!open) return
    const state = loadGlobalMemoryState()
    setProfile(loadUserProfile())
    setItems(loadGlobalMemoryItems())
    setSettings(loadGlobalMemorySettings())
    setLastGlobalUpdate(state.lastGlobalUpdateTime)
    setPendingCount(state.pendingDigests.length)
    setActiveTab(initialTab)
  }, [open, initialTab])

  if (!open) return null

  const enabledItems = items.filter((m) => !m.disabled)
  const pinnedCount = enabledItems.filter((m) => m.pinned).length

  const personaSummary =
    profile?.summary?.trim() ||
    t('globalMemory.userPersonaNotGenerated')

  const handleToggleEnabled = () => {
    const next: GlobalMemorySettings = {
      ...settings,
      enabled: !settings.enabled,
    }
    setSettings(next)
    saveGlobalMemorySettings(next)
  }

  const handleToggleAutoUpdate = () => {
    const next: GlobalMemorySettings = {
      ...settings,
      autoUpdateEnabled: !settings.autoUpdateEnabled,
    }
    setSettings(next)
    saveGlobalMemorySettings(next)
  }

  const updateItemsAndSave = (updater: (prev: GlobalMemoryItem[]) => GlobalMemoryItem[]) => {
    setItems((prev) => {
      const next = updater(prev)
      saveGlobalMemoryItems(next)
      return next
    })
  }

  const handleTogglePinned = (id: string) => {
    const now = Date.now()
    updateItemsAndSave((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              pinned: !item.pinned,
              updatedAt: now,
            }
          : item,
      ),
    )
  }

  const handleToggleDisabled = (id: string) => {
    const now = Date.now()
    updateItemsAndSave((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              disabled: !item.disabled,
              updatedAt: now,
            }
          : item,
      ),
    )
  }

  const handleEditTags = (item: GlobalMemoryItem) => {
    if (typeof window === 'undefined') return
    const current = (item.tags ?? []).join(', ')
    const next = window.prompt(t('globalMemory.editTagsPrompt'), current)
    if (next == null) return
    const tags = Array.from(new Set(next.split(',').map((t) => t.trim()).filter((t) => t.length > 0)))
    const now = Date.now()
    updateItemsAndSave((prev) =>
      prev.map((m) =>
        m.id === item.id
          ? {
              ...m,
              tags,
              updatedAt: now,
            }
          : m,
      ),
    )
  }

  const handleDeleteItem = (id: string) => {
    if (typeof window !== 'undefined') {
      const ok = window.confirm(t('globalMemory.confirmDeleteMemory'))
      if (!ok) return
    }
    updateItemsAndSave((prev) => prev.filter((item) => item.id !== id))
  }

  const handleClearAll = () => {
    if (isClearing) return
    if (typeof window !== 'undefined') {
      const ok = window.confirm(t('globalMemory.confirmClearAll'))
      if (!ok) return
    }

    setIsClearing(true)
    try {
      clearGlobalMemoryState()
      setProfile(null)
      setItems([])
      setLastGlobalUpdate(null)
      setPendingCount(0)
    } finally {
      setIsClearing(false)
    }
  }

  const handleUpdateNow = async () => {
    if (isUpdating) return
    setIsUpdating(true)
    try {
      await runGlobalMemoryUpdateNow()
      const state = loadGlobalMemoryState()
      setProfile(loadUserProfile())
      setItems(loadGlobalMemoryItems())
      setLastGlobalUpdate(state.lastGlobalUpdateTime)
      setPendingCount(state.pendingDigests.length)
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <div className="modal-backdrop modal-backdrop-plain" onClick={onClose}>
      <div
        className="modal modal-ai-chat modal-ai-global-memory"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-title ai-chat-title">
          <button
            type="button"
            className="ai-chat-close-button"
            aria-label={t('globalMemory.close')}
            onClick={onClose}
          >
            <span className="ai-chat-close-icon" aria-hidden="true" />
          </button>
          <div className="ai-global-memory-tabs">
            <button
              type="button"
              className={activeTab === 'persona' ? 'ai-global-memory-tab active' : 'ai-global-memory-tab'}
              onClick={() => setActiveTab('persona')}
            >
              {t('globalMemory.userPersona')}
            </button>
            <button
              type="button"
              className={activeTab === 'manage' ? 'ai-global-memory-tab active' : 'ai-global-memory-tab'}
              onClick={() => setActiveTab('manage')}
            >
              {t('globalMemory.manageMemory')}
            </button>
          </div>
        </div>

        {activeTab === 'persona' && (
          <div className="ai-global-memory-body ai-global-memory-body-persona">
            <section className="ai-global-memory-section">
              <h2 className="ai-global-memory-section-title">{t('globalMemory.overview')}</h2>
              <p className="ai-global-memory-persona-summary">{personaSummary}</p>
            </section>

            <section className="ai-global-memory-section">
              <h2 className="ai-global-memory-section-title">{t('globalMemory.preferences')}</h2>
              <div className="ai-global-memory-preferences-grid">
                <div className="ai-global-memory-preference-block">
                  <div className="ai-global-memory-preference-label">{t('globalMemory.language')}</div>
                  <div className="ai-global-memory-preference-value">
                    {profile?.languages?.length ? profile.languages.join(', ') : t('globalMemory.notSpecifiedYet')}
                  </div>
                </div>
                <div className="ai-global-memory-preference-block">
                  <div className="ai-global-memory-preference-label">{t('globalMemory.style')}</div>
                  <div className="ai-global-memory-preference-value">
                    {profile?.writingStyle || t('globalMemory.notSpecifiedYet')}
                  </div>
                </div>
              </div>
            </section>

            <section className="ai-global-memory-section">
              <h2 className="ai-global-memory-section-title">{t('globalMemory.interests')}</h2>
              <div className="ai-global-memory-tags">
                {profile?.interests?.length ? (
                  profile.interests.map((tag) => (
                    <span key={tag} className="ai-global-memory-tag">
                      {tag}
                    </span>
                  ))
                ) : (
                  <span className="ai-global-memory-empty-text">{t('globalMemory.noInterestTags')}</span>
                )}
              </div>
            </section>

            <section className="ai-global-memory-section">
              <h2 className="ai-global-memory-section-title">{t('globalMemory.meta')}</h2>
              <div className="ai-global-memory-meta">
                <div className="ai-global-memory-meta-row">
                  <span className="ai-global-memory-meta-label">{t('globalMemory.lastUpdated')}</span>
                  <span className="ai-global-memory-meta-value">{formatLastUpdated(profile) || t('globalMemory.userPersonaNotGeneratedShort')}</span>
                </div>
                <div className="ai-global-memory-meta-row">
                  <span className="ai-global-memory-meta-label">{t('globalMemory.activeMemories')}</span>
                  <span className="ai-global-memory-meta-value">{enabledItems.length}</span>
                </div>
                <div className="ai-global-memory-meta-row">
                  <span className="ai-global-memory-meta-label">{t('globalMemory.pinned')}</span>
                  <span className="ai-global-memory-meta-value">{pinnedCount}</span>
                </div>
              </div>
            </section>
          </div>
        )}

        {activeTab === 'manage' && (
          <div className="ai-global-memory-body ai-global-memory-body-manage">
            <div className="ai-global-memory-filter-bar">
              <input
                type="text"
                className="ai-global-memory-search-input"
                placeholder={t('globalMemory.searchPlaceholder')}
                disabled
              />
              <div className="ai-global-memory-filter-summary">
                {t('globalMemory.filterSummary', { total: items.length, enabled: enabledItems.length, pinned: pinnedCount })}
              </div>
            </div>

            <div className="ai-global-memory-manage-controls">
              <label className="ai-global-memory-switch">
                <input
                  type="checkbox"
                  checked={settings.enabled}
                  onChange={handleToggleEnabled}
                />
                <span>{t('globalMemory.enableGlobalMemory')}</span>
              </label>
              <label className="ai-global-memory-switch">
                <input
                  type="checkbox"
                  checked={settings.autoUpdateEnabled}
                  onChange={handleToggleAutoUpdate}
                  disabled={!settings.enabled}
                />
                <span>{t('globalMemory.allowAutoUpdate')}</span>
              </label>
              <button
                type="button"
                className="ai-global-memory-danger-button"
                onClick={handleClearAll}
                disabled={isClearing}
              >
                {isClearing ? t('globalMemory.clearing') : t('globalMemory.clearAllGlobalMemories')}
              </button>
            </div>

            <div className="ai-global-memory-list">
              {items.length === 0 && (
                <div className="ai-global-memory-empty-text">
                  {t('globalMemory.noMemoryItems')}
                </div>
              )}

              {items.map((item) => (
                <div key={item.id} className="ai-global-memory-item">
                  <div className="ai-global-memory-item-header">
                    <div className="ai-global-memory-item-title">{item.title}</div>
                    <div className="ai-global-memory-item-meta">
                      <span className="ai-global-memory-item-type">{item.type}</span>
                      {item.pinned && <span className="ai-global-memory-badge">{t('globalMemory.pinned')}</span>}
                      {item.disabled && (
                        <span className="ai-global-memory-badge badge-muted">{t('globalMemory.disable')}</span>
                      )}
                    </div>
                  </div>
                  <div className="ai-global-memory-item-content">{item.content}</div>
                  <div className="ai-global-memory-item-footer">
                    <span className="ai-global-memory-item-tags">
                      {item.tags?.map((tag) => (
                        <span key={tag} className="ai-global-memory-tag ai-global-memory-tag-small">
                          {tag}
                        </span>
                      ))}
                    </span>
                    <span className="ai-global-memory-item-meta-small">
                      Sources: {(item.sourceDocs?.length ?? 0)} docs · Updated:{' '}
                      {new Date(item.updatedAt).toLocaleDateString()}
                    </span>
                    <span className="ai-global-memory-item-actions">
                      <button
                        type="button"
                        className="ai-global-memory-item-action-button"
                        onClick={() => handleEditTags(item)}
                      >
                        {t('globalMemory.editTags')}
                      </button>
                      <button
                        type="button"
                        className="ai-global-memory-item-action-button"
                        onClick={() => handleTogglePinned(item.id)}
                      >
                        {item.pinned ? t('globalMemory.unpin') : t('globalMemory.pin')}
                      </button>
                      <button
                        type="button"
                        className="ai-global-memory-item-action-button"
                        onClick={() => handleToggleDisabled(item.id)}
                      >
                        {item.disabled ? t('globalMemory.enable') : t('globalMemory.disable')}
                      </button>
                      <button
                        type="button"
                        className="ai-global-memory-item-action-button ai-global-memory-item-action-danger"
                        onClick={() => handleDeleteItem(item.id)}
                      >
                        {t('globalMemory.delete')}
                      </button>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="ai-global-memory-footer">
          <div className="ai-global-memory-footer-left">
            <div className="ai-global-memory-footer-meta">
              <span className="ai-global-memory-footer-meta-label">{t('globalMemory.lastGlobalUpdate')}</span>
              <span className="ai-global-memory-footer-meta-value">
                {formatGlobalUpdateTime(lastGlobalUpdate) || t('globalMemory.globalMemoryNotUpdated')}
              </span>
              <span className="ai-global-memory-footer-meta-separator">·</span>
              <span className="ai-global-memory-footer-meta-value">
                {t('globalMemory.pendingDigests', { count: pendingCount })}
              </span>
            </div>
            <div className="ai-global-memory-footer-text">
              {t('globalMemory.footerText')}
            </div>
          </div>
          <div className="ai-global-memory-footer-right">
            <button
              type="button"
              className="ai-global-memory-footer-button ai-global-memory-footer-button-primary"
              onClick={handleUpdateNow}
              disabled={isUpdating}
            >
              {isUpdating ? t('globalMemory.updating') : t('globalMemory.updateNow')}
            </button>
            <button type="button" className="ai-global-memory-footer-button" onClick={onClose}>
              {t('common.close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
