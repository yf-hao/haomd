import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { emit } from '@tauri-apps/api/event'
import './App.css'
import WorkspaceShell, { type LeftPanelId, type InitialWorkspaceAction } from './components/WorkspaceShell'
import { AiSettingsDialog } from './components/AiSettingsDialog'
import { AgentSettingsDialog } from './components/AgentSettingsDialog'
import { ImageGenerationDialog } from './components/ImageGenerationDialog'
import { PromptSettingsDialog } from './components/PromptSettingsDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { McpSettingsDialog } from './components/McpSettingsDialog'
import Toast from './components/Toast'
import { I18nProvider, useI18n } from './modules/i18n/I18nContext'
import { getSystemResolvedLanguage, normalizeLanguageTag, resolveLanguageMode } from './modules/i18n/languageResolver'
import type { LanguageMode, ResolvedLanguage } from './modules/i18n/schema'
import { onMenuAction } from './modules/platform/menuEvents'
import {
  onWebDavExportFinished,
  onWebDavExportProgress,
  onWebDavExportStarted,
  onWebDavImportFinished,
  onWebDavImportStarted,
  onWebDavImportProgress,
  type WebDavImportProgressPayload,
  type WebDavExportProgressPayload,
} from './modules/platform/backupEvents'
import { isTauriEnv } from './modules/platform/runtime'
import {
  getDefaultLanguageSetting,
  getDefaultThemeSettings,
  getDefaultUiTypographySettings,
  getLanguageSetting,
  getUiTypographySettings,
  type ThemeSettings,
  type UiTypographySettings,
} from './modules/settings/editorSettings'
import { applyUiTypography, subscribeUiTypographyChanged } from './modules/settings/uiTypographyRuntime'
import {
  applyResolvedTheme,
  getSystemPrefersDark,
  resolveThemeMode,
  subscribeSystemThemePreference,
} from './modules/theme/themeRuntime'
import { ThemeModeProvider } from './modules/theme/ThemeContext'
import { resolveActiveTheme } from './modules/theme/themeResolver'
import { loadThemePreference } from './modules/theme/themePreferenceStore'
import type { SearchScope } from './modules/search/types'
import { getMusicTrackState, saveMusicSession } from './modules/tools/music/musicAudio'

const appStartTime = performance.now()
const STORAGE_ACTIVITY_BAR_VISIBLE = 'haomd:appearance:activity-bar-visible'
const STORAGE_STATUS_BAR_VISIBLE = 'haomd:appearance:status-bar-visible'

function readVisibilityPreference(key: string): boolean {
  if (typeof localStorage === 'undefined') return true
  const stored = localStorage.getItem(key)
  return stored !== 'false'
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0 B'
  }
  if (bytes < 1024) {
    return `${bytes} B`
  }
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`
}

function getDisplayFileName(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const parts = normalized.split('/').filter(Boolean)
  return parts[parts.length - 1] || normalized || 'unknown'
}

function formatWebDavExportProgress(payload: WebDavExportProgressPayload): string {
  if (payload.phase === 'scanning') {
    if (payload.total > 0) {
      return `WebDAV 扫描中 ${payload.current}/${payload.total} · ${getDisplayFileName(payload.path)} · ${payload.fileCount} files${payload.dirCount > 0 ? ` · ${payload.dirCount} dirs` : ''}`
    }
    return `WebDAV 扫描中 · ${getDisplayFileName(payload.path)} · ${payload.fileCount} files${payload.dirCount > 0 ? ` · ${payload.dirCount} dirs` : ''}`
  }
  return `WebDAV 上传中 ${payload.current}/${payload.total} · ${getDisplayFileName(payload.path)} · ${formatBytes(payload.size)}`
}

function formatWebDavImportProgress(payload: WebDavImportProgressPayload): string {
  if (payload.phase === 'scanning') {
    if (payload.total > 0) {
      return `WebDAV 恢复扫描中 ${payload.current}/${payload.total}`
    }
    return 'WebDAV 恢复扫描中'
  }
  if (payload.phase === 'comparing') {
    if (payload.total > 0) {
      return `WebDAV 恢复比对中 ${payload.current}/${payload.total} · 已跳过 ${payload.skippedCount} · ${getDisplayFileName(payload.path)} · ${formatBytes(payload.size)}`
    }
    return `WebDAV 恢复比对中 · 已跳过 ${payload.skippedCount} · ${getDisplayFileName(payload.path)} · ${formatBytes(payload.size)}`
  }
  return `WebDAV 恢复中 ${payload.current}/${payload.total} · 已跳过 ${payload.skippedCount} · ${getDisplayFileName(payload.path)} · ${formatBytes(payload.size)}`
}

function App() {
  const [activeLeftPanel, setActiveLeftPanel] = useState<LeftPanelId>(null)
  const lastVisibleLeftPanelRef = useRef<Exclude<LeftPanelId, null>>('files')
  const [isActivityBarVisible, setActivityBarVisible] = useState(() =>
    readVisibilityPreference(STORAGE_ACTIVITY_BAR_VISIBLE),
  )
  const [initialWorkspaceAction, setInitialWorkspaceAction] = useState<InitialWorkspaceAction>(null)
  const [initialOpenRecentPath, setInitialOpenRecentPath] = useState<string | null>(null)
  const [initialOpenRecentIsFolder, setInitialOpenRecentIsFolder] = useState<boolean | null>(null)
  const [isAiSettingsOpen, setAiSettingsOpen] = useState(false)
  const [isAgentSettingsOpen, setAgentSettingsOpen] = useState(false)
  const [isPromptSettingsOpen, setPromptSettingsOpen] = useState(false)
  const [isSettingsOpen, setSettingsOpen] = useState(false)
  const [isMcpSettingsOpen, setMcpSettingsOpen] = useState(false)
  const [isImageGenerationDialogOpen, setImageGenerationDialogOpen] = useState(false)
  const [initialImageGenerationAgentId, setInitialImageGenerationAgentId] = useState<string | null>(null)
  const [isStatusBarVisible, setStatusBarVisible] = useState(() =>
    readVisibilityPreference(STORAGE_STATUS_BAR_VISIBLE),
  )
  const [docCharCount, setDocCharCount] = useState<number | null>(null)
  const [statusMessage, setStatusMessage] = useState('')
  const [searchScope, setSearchScope] = useState<SearchScope | null>(null)
  const [themeSettings, setThemeSettings] = useState<ThemeSettings>(getDefaultThemeSettings())
  const [languageMode, setLanguageMode] = useState<LanguageMode>(getDefaultLanguageSetting())
  const [systemResolvedLanguage, setSystemResolvedLanguage] = useState<ResolvedLanguage | null>(null)
  const [uiTypography, setUiTypography] = useState<UiTypographySettings>(getDefaultUiTypographySettings())
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => getSystemPrefersDark())
  const [isBootstrapReady, setBootstrapReady] = useState(false)
  const hasPreviewThemeOverrideRef = useRef(false)
  const hasPreviewLanguageOverrideRef = useRef(false)
  const hasPreviewTypographyOverrideRef = useRef(false)

  const handleThemeSettingsPreview = useCallback((settings: ThemeSettings) => {
    hasPreviewThemeOverrideRef.current = true
    console.warn('[App] apply theme settings preview', {
      mode: settings.mode,
      workspaceBackground: settings.workspaceBackground,
      workspaceBackgroundIncludeSidebar: settings.workspaceBackgroundIncludeSidebar,
      editorBackground: settings.editorBackground,
      previewBackground: settings.previewBackground,
      aiChatBackground: settings.aiChatBackground,
      sidebarBackground: settings.sidebarBackground,
    })
    setThemeSettings({
      ...settings,
      workspaceBackground: settings.workspaceBackground ? { ...settings.workspaceBackground } : undefined,
      workspaceBackgroundIncludeSidebar: settings.workspaceBackgroundIncludeSidebar,
      editorBackground: settings.editorBackground ? { ...settings.editorBackground } : undefined,
      previewBackground: settings.previewBackground ? { ...settings.previewBackground } : undefined,
      aiChatBackground: settings.aiChatBackground ? { ...settings.aiChatBackground } : undefined,
      sidebarBackground: settings.sidebarBackground ? { ...settings.sidebarBackground } : undefined,
    })
  }, [])

  const handleLeftPanelToggle = useCallback(
    (id: LeftPanelId) => {
      setActiveLeftPanel((prev) => {
        const next = prev === id ? null : id
        if (next) lastVisibleLeftPanelRef.current = next
        return next
      })
    },
    [],
  )

  const toggleActivityBarVisible = useCallback(() => {
    setActivityBarVisible((visible) => !visible)
  }, [])

  useEffect(() => {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(STORAGE_ACTIVITY_BAR_VISIBLE, String(isActivityBarVisible))
  }, [isActivityBarVisible])

  useEffect(() => {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(STORAGE_STATUS_BAR_VISIBLE, String(isStatusBarVisible))
  }, [isStatusBarVisible])

  useEffect(() => {
    if (!isTauriEnv()) return
    void invoke('set_appearance_menu_state', {
      activityBar: isActivityBarVisible,
      statusBar: isStatusBarVisible,
    }).catch((error) => {
      console.warn('[App] failed to sync appearance menu state:', error)
    })
  }, [isActivityBarVisible, isStatusBarVisible])

  useEffect(() => {
    if (!isTauriEnv()) return
    void invoke('set_panel_menu_state', {
      activePanel: activeLeftPanel,
    }).catch((error) => {
      console.warn('[App] failed to sync panel menu state:', error)
    })
  }, [activeLeftPanel])

  const handleInitialActionHandled = useCallback(() => {
    setInitialWorkspaceAction(null)
    setInitialOpenRecentPath(null)
    setInitialOpenRecentIsFolder(null)
  }, [])

  useEffect(() => {
    if (!isTauriEnv()) return

    const unlistenAction = onMenuAction((actionId) => {
      if (actionId === 'haomd_settings') {
        setSettingsOpen(true)
        return
      }
      if (actionId === 'ai_settings') {
        setAiSettingsOpen(true)
        return
      }
      if (actionId === 'agent_settings') {
        setAgentSettingsOpen(true)
        return
      }
      if (actionId === 'ai_prompt_settings') {
        setPromptSettingsOpen(true)
        return
      }
      if (actionId === 'mcp_settings') {
        setMcpSettingsOpen(true)
        return
      }
      if (actionId === 'toggle_status_bar') {
        setStatusBarVisible((prev) => !prev)
      }
    })

    return () => {
      unlistenAction()
    }
  }, [])

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log('[Perf] App first render cost:', performance.now() - appStartTime, 'ms')
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      const systemLanguagePromise = isTauriEnv()
        ? invoke<string>('get_system_language')
            .then((language) => normalizeLanguageTag(language))
            .catch(() => getSystemResolvedLanguage())
        : Promise.resolve(getSystemResolvedLanguage())

      const [settings, language, typography, systemLanguage] = await Promise.all([
        loadThemePreference(),
        getLanguageSetting(),
        getUiTypographySettings(),
        systemLanguagePromise,
      ])
      if (cancelled) return
      if (!hasPreviewThemeOverrideRef.current) {
        setThemeSettings(settings)
      }
      if (!hasPreviewLanguageOverrideRef.current) {
        setLanguageMode(language)
      }
      if (!hasPreviewTypographyOverrideRef.current) {
        setUiTypography(typography)
      }
      setSystemResolvedLanguage(systemLanguage)
      setBootstrapReady(true)
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return subscribeSystemThemePreference(setSystemPrefersDark)
  }, [])

  const resolvedThemeMode = useMemo(
    () => resolveThemeMode(themeSettings.mode, systemPrefersDark),
    [themeSettings.mode, systemPrefersDark],
  )
  const activeTheme = useMemo(
    () => resolveActiveTheme(themeSettings.mode, systemPrefersDark),
    [themeSettings.mode, systemPrefersDark],
  )
  const resolvedLanguage = useMemo(
    () => resolveLanguageMode(languageMode, systemResolvedLanguage ?? getSystemResolvedLanguage()),
    [languageMode, systemResolvedLanguage],
  )

  useLayoutEffect(() => {
    applyResolvedTheme(activeTheme, resolvedThemeMode)
  }, [activeTheme, resolvedThemeMode])

  useLayoutEffect(() => {
    applyUiTypography(uiTypography)
  }, [uiTypography])

  useEffect(() => {
    return subscribeUiTypographyChanged((settings) => {
      hasPreviewTypographyOverrideRef.current = true
      setUiTypography(settings)
    })
  }, [])

  useEffect(() => {
    if (!isTauriEnv()) return

    let cancelled = false
    const timer = window.setInterval(() => {
      void persistMusicSession()
    }, 5000)

    const saveCurrentMusicSession = async () => {
      const state = await getMusicTrackState()
      if (!state) return
      await saveMusicSession(state)
    }

    const persistMusicSession = async () => {
      if (cancelled) return
      await saveCurrentMusicSession()
    }

    void persistMusicSession()

    return () => {
      window.clearInterval(timer)
      cancelled = true
      void saveCurrentMusicSession()
    }
  }, [])

  return (
    <I18nProvider
      value={{
        languageMode,
        resolvedLanguage,
        ready: isBootstrapReady,
      }}
    >
      <ThemeModeProvider
        value={{
          selectedMode: themeSettings.mode,
          themeSettings,
          resolvedMode: resolvedThemeMode,
          activeTheme,
        }}
      >
        <AppShellContent
          activeLeftPanel={activeLeftPanel}
          isActivityBarVisible={isActivityBarVisible}
          initialWorkspaceAction={initialWorkspaceAction}
          initialOpenRecentPath={initialOpenRecentPath}
          initialOpenRecentIsFolder={initialOpenRecentIsFolder}
          isAiSettingsOpen={isAiSettingsOpen}
          isAgentSettingsOpen={isAgentSettingsOpen}
          isPromptSettingsOpen={isPromptSettingsOpen}
          isSettingsOpen={isSettingsOpen}
          isMcpSettingsOpen={isMcpSettingsOpen}
          isImageGenerationDialogOpen={isImageGenerationDialogOpen}
          initialImageGenerationAgentId={initialImageGenerationAgentId}
          isStatusBarVisible={isStatusBarVisible}
          docCharCount={docCharCount}
          statusMessage={statusMessage}
          handleLeftPanelToggle={handleLeftPanelToggle}
          toggleActivityBarVisible={toggleActivityBarVisible}
          handleInitialActionHandled={handleInitialActionHandled}
          onThemeSettingsChange={handleThemeSettingsPreview}
          onLanguageModeChange={(mode) => {
            hasPreviewLanguageOverrideRef.current = true
            setLanguageMode(mode)
          }}
          onUiTypographyChange={(settings) => {
            hasPreviewTypographyOverrideRef.current = true
            setUiTypography(settings)
          }}
          setDocCharCount={setDocCharCount}
          setStatusMessage={setStatusMessage}
          searchScope={searchScope}
          setSearchScope={setSearchScope}
          setAiSettingsOpen={setAiSettingsOpen}
          setAgentSettingsOpen={setAgentSettingsOpen}
          setPromptSettingsOpen={setPromptSettingsOpen}
          setSettingsOpen={setSettingsOpen}
          setMcpSettingsOpen={setMcpSettingsOpen}
          setImageGenerationDialogOpen={setImageGenerationDialogOpen}
          setInitialImageGenerationAgentId={setInitialImageGenerationAgentId}
        />
      </ThemeModeProvider>
    </I18nProvider>
  )
}

type AppShellContentProps = {
  activeLeftPanel: LeftPanelId
  isActivityBarVisible: boolean
  initialWorkspaceAction: InitialWorkspaceAction
  initialOpenRecentPath: string | null
  initialOpenRecentIsFolder: boolean | null
  isAiSettingsOpen: boolean
  isAgentSettingsOpen: boolean
  isPromptSettingsOpen: boolean
  isSettingsOpen: boolean
  isMcpSettingsOpen: boolean
  isImageGenerationDialogOpen: boolean
  initialImageGenerationAgentId: string | null
  isStatusBarVisible: boolean
  docCharCount: number | null
  statusMessage: string
  handleLeftPanelToggle: (id: LeftPanelId) => void
  toggleActivityBarVisible: () => void
  handleInitialActionHandled: () => void
  onThemeSettingsChange: (settings: ThemeSettings) => void
  onLanguageModeChange: (mode: LanguageMode) => void
  onUiTypographyChange: (settings: UiTypographySettings) => void
  setDocCharCount: (count: number | null) => void
  setStatusMessage: (message: string) => void
  searchScope: SearchScope | null
  setSearchScope: Dispatch<SetStateAction<SearchScope | null>>
  setAiSettingsOpen: Dispatch<SetStateAction<boolean>>
  setAgentSettingsOpen: Dispatch<SetStateAction<boolean>>
  setPromptSettingsOpen: Dispatch<SetStateAction<boolean>>
  setSettingsOpen: Dispatch<SetStateAction<boolean>>
  setMcpSettingsOpen: Dispatch<SetStateAction<boolean>>
  setImageGenerationDialogOpen: Dispatch<SetStateAction<boolean>>
  setInitialImageGenerationAgentId: Dispatch<SetStateAction<string | null>>
}

function AppShellContent({
  activeLeftPanel,
  isActivityBarVisible,
  initialWorkspaceAction,
  initialOpenRecentPath,
  initialOpenRecentIsFolder,
  isAiSettingsOpen,
  isAgentSettingsOpen,
  isPromptSettingsOpen,
  isSettingsOpen,
  isMcpSettingsOpen,
  isImageGenerationDialogOpen,
  initialImageGenerationAgentId,
  isStatusBarVisible,
  docCharCount,
  statusMessage,
  handleLeftPanelToggle,
  toggleActivityBarVisible,
  handleInitialActionHandled,
  onThemeSettingsChange,
  onLanguageModeChange,
  onUiTypographyChange,
  setDocCharCount,
  setStatusMessage,
  searchScope,
  setSearchScope,
  setAiSettingsOpen,
  setAgentSettingsOpen,
  setPromptSettingsOpen,
  setSettingsOpen,
  setMcpSettingsOpen,
  setImageGenerationDialogOpen,
  setInitialImageGenerationAgentId,
}: AppShellContentProps) {
  const { t, resolvedLanguage } = useI18n()
  const [toastMessage, setToastMessage] = useState('')
  const [backgroundStatusMessage, setBackgroundStatusMessage] = useState('')
  const [backgroundStatusPhase, setBackgroundStatusPhase] = useState<'idle' | 'scanning' | 'comparing' | 'uploading' | 'downloading'>('idle')
  const [musicTrackName, setMusicTrackName] = useState<string | null>(null)

  useEffect(() => {
    if (!isTauriEnv()) return

    const unlistenStarted = onWebDavImportStarted(() => {
      setBackgroundStatusPhase('scanning')
      setBackgroundStatusMessage(t('backup.webdavImportPreparingStatus'))
    })
    const unlistenImportProgress = onWebDavImportProgress((payload) => {
      setBackgroundStatusPhase(payload.phase)
      setBackgroundStatusMessage(formatWebDavImportProgress(payload))
    })
    const unlistenExportStarted = onWebDavExportStarted(() => {
      setBackgroundStatusPhase('scanning')
      setBackgroundStatusMessage(t('backup.webdavExportPreparingStatus'))
    })
    const unlistenExportProgress = onWebDavExportProgress((payload) => {
      setBackgroundStatusPhase(payload.phase)
      setBackgroundStatusMessage(formatWebDavExportProgress(payload))
    })

    const unlistenImport = onWebDavImportFinished((payload) => {
      setBackgroundStatusPhase('idle')
      setBackgroundStatusMessage('')
      if (payload.success) {
        setToastMessage(t('backup.webdavImportSuccess'))
      } else {
        setToastMessage(t('backup.webdavImportFailed', { message: payload.message ?? 'Unknown error' }))
      }
    })
    const unlistenExport = onWebDavExportFinished((payload) => {
      setBackgroundStatusPhase('idle')
      if (payload.success) {
        const summary = payload.summary
        if (payload.noUploads) {
          setBackgroundStatusMessage(t('backup.webdavExportNoUploads'))
          setToastMessage(t('backup.webdavExportNoUploads'))
          return
        }
        setBackgroundStatusMessage('')
        setToastMessage(
          summary?.incremental
            ? t('backup.webdavExportSuccessIncremental', {
                total: summary?.totalFiles ?? 0,
                uploaded: summary?.uploadedFiles ?? 0,
                skipped: summary?.skippedFiles ?? 0,
                deleted: summary?.deletedFiles ?? 0,
              })
            : t('backup.webdavExportSuccessFull', {
                total: summary?.totalFiles ?? 0,
                uploaded: summary?.uploadedFiles ?? 0,
              }),
        )
      } else {
        setBackgroundStatusMessage('')
          setToastMessage(t('backup.webdavExportFailed', { message: payload.message ?? 'Unknown error' }))
      }
    })

    return () => {
      unlistenStarted()
      unlistenImportProgress()
      unlistenExportStarted()
      unlistenExportProgress()
      unlistenImport()
      unlistenExport()
    }
  }, [t])

  useEffect(() => {
    if (!isTauriEnv()) {
      setMusicTrackName(null)
      return
    }

    let cancelled = false

    const syncMusicTrack = async () => {
      const state = await getMusicTrackState()
      if (cancelled) return
      setMusicTrackName(state?.fileName ?? null)
    }

    void syncMusicTrack()
    const timer = window.setInterval(() => {
      void syncMusicTrack()
    }, 1000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  const handleOpenMusicPlayer = useCallback(() => {
    if (!isTauriEnv()) return
    void emit('menu://action', 'tools_music_player')
  }, [])

  const displayedStatusMessage = backgroundStatusMessage || statusMessage
  const currentMusicLabel = musicTrackName ? stripAudioExtension(musicTrackName) : resolvedLanguage === 'en-US' ? 'No music playing' : '未播放音乐'

  return (
    <div className="app-shell">
      <div className="layout-row">
        {isActivityBarVisible && (
        <div className="activity-bar">
          <button
            type="button"
            className={`activity-item ${activeLeftPanel === 'files' ? 'active' : ''}`}
            onClick={() => handleLeftPanelToggle('files')}
            aria-pressed={activeLeftPanel === 'files'}
            title={t('app.files')}
          >
            <svg
              className="activity-icon-file"
              viewBox="0 0 20 20"
              aria-hidden="true"
              fill="none"
            >
              <path
                d="M4 1.8H11.8L16.5 6.4V18.2H4V1.8Z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <path
                d="M11.8 1.8V6.4H16.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          <button
            type="button"
            className={`activity-item ${activeLeftPanel === 'search' ? 'active' : ''}`}
            onClick={() => handleLeftPanelToggle('search')}
            aria-pressed={activeLeftPanel === 'search'}
            title={t('app.search')}
          >
            <svg
              className="activity-icon-search"
              viewBox="0 0 20 20"
              aria-hidden="true"
              fill="none"
            >
              <circle cx="8.5" cy="8.5" r="4.8" stroke="currentColor" strokeWidth="1.6" />
              <path d="M12.2 12.2L16.4 16.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </button>

          <button
            type="button"
            className={`activity-item ${activeLeftPanel === 'outline' ? 'active' : ''}`}
            onClick={() => handleLeftPanelToggle('outline')}
            aria-pressed={activeLeftPanel === 'outline'}
            title={t('app.outline')}
          >
            <svg
              className="activity-icon-outline"
              viewBox="0 0 20 20"
              aria-hidden="true"
              fill="none"
            >
              <rect x="2.5" y="2.6" width="2.2" height="2.2" rx="0.45" fill="currentColor" />
              <rect x="2.5" y="7.6" width="2.2" height="2.2" rx="0.45" fill="currentColor" />
              <rect x="2.5" y="12.6" width="2.2" height="2.2" rx="0.45" fill="currentColor" />
              <rect x="2.5" y="17.1" width="2.2" height="2.2" rx="0.45" fill="currentColor" />
              <path d="M8 3.7h9.5M8 8.7h9.5M8 13.7h9.5M8 18.2h9.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>

          <button
            type="button"
            className={`activity-item ${activeLeftPanel === 'pdf' ? 'active' : ''}`}
            onClick={() => handleLeftPanelToggle('pdf')}
            aria-pressed={activeLeftPanel === 'pdf'}
            title={t('app.pdf')}
          >
            <svg
              className="activity-icon-pdf"
              viewBox="0 0 1024 1024"
              aria-hidden="true"
              fill="currentColor"
            >
              <path d="M597.333333 85.333333l256 256v512a85.333333 85.333333 0 0 1-85.333333 85.333334H256a85.333333 85.333333 0 0 1-85.333333-85.333334V170.666667a85.333333 85.333333 0 0 1 85.333333-85.333334h341.333333m170.666667 768V384h-213.333333V170.666667H256v682.666666h512m-302.08-328.106666c-10.24-32.853333-32.853333-137.813333 26.88-139.52 59.733333-1.706667 20.48 133.12 20.48 133.12a225.28 225.28 0 0 0 85.333333 109.226666c21.333333-6.4 142.933333-20.48 125.866667 42.666667-17.066667 63.146667-149.333333 3.84-149.333333 3.84a609.28 609.28 0 0 0-145.493334 28.16c-48.213333 90.026667-104.533333 128-128 91.306667-28.586667-47.36 90.88-108.373333 90.88-108.373334a518.826667 518.826667 0 0 0 72.106667-160.426666m27.733333 35.84a663.893333 663.893333 0 0 1-51.2 114.773333 984.32 984.32 0 0 1 115.626667-31.146667 250.026667 250.026667 0 0 1-64.426667-85.333333m133.973334 92.586667s74.666667 27.733333 76.373333 16.64c1.706667-11.093333-56.746667-21.76-76.373333-16.64m-241.493334 63.573333c-32.853333 12.8-64.426667 67.413333-56.746666 67.413333a123.306667 123.306667 0 0 0 56.746666-67.413333m107.52-236.8c0-2.133333 18.346667-71.68 0-73.813333-18.346667-2.133333.853333 73.813333 1.28 75.52l-1.28-1.706667z" />
            </svg>
          </button>

          <button
            type="button"
            className={`activity-item ${activeLeftPanel === 'sessions' ? 'active' : ''}`}
            onClick={() => handleLeftPanelToggle('sessions')}
            aria-pressed={activeLeftPanel === 'sessions'}
            title={t('app.sessions')}
          >
            <svg
              className="activity-icon-sessions"
              viewBox="0 0 1024 1024"
              aria-hidden="true"
              fill="currentColor"
            >
              <path d="M850.56 32H301.44a141.12 141.12 0 0 0-140.16 129.28A141.44 141.44 0 0 0 32 301.696v438.848a141.824 141.824 0 0 0 141.696 141.76h151.36l100.288 100.352a32 32 0 0 0 45.248 0l100.352-100.352h151.36a141.44 141.44 0 0 0 140.416-128.96A141.568 141.568 0 0 0 992 612.48V173.44A141.568 141.568 0 0 0 850.56 32z m-50.56 708.544a77.824 77.824 0 0 1-77.696 77.76H557.696a32 32 0 0 0-22.656 9.344L448 914.752l-87.04-87.04a32 32 0 0 0-22.656-9.408H173.696A77.824 77.824 0 0 1 96 740.48V301.696A77.824 77.824 0 0 1 173.696 224h548.608A77.824 77.824 0 0 1 800 301.696z m128-128.064a76.928 76.928 0 0 1-64 75.328V301.696A141.888 141.888 0 0 0 722.304 160H226.688a76.48 76.48 0 0 1 74.752-64h549.12a77.568 77.568 0 0 1 77.44 77.44z" />
            </svg>
          </button>

          <button
            type="button"
            className={`activity-item ${activeLeftPanel === 'notes' ? 'active' : ''}`}
            onClick={() => handleLeftPanelToggle('notes')}
            aria-pressed={activeLeftPanel === 'notes'}
            title={t('app.notes')}
          >
            <svg
              className="activity-icon-notes"
              viewBox="0 0 1024 1024"
              aria-hidden="true"
              fill="currentColor"
            >
              <path d="M238.501424 385.003326m49.999739 0l199.998959 0q49.99974 0 49.99974 49.99974l0 0q0 49.99974-49.99974 49.99974l-199.998959 0q-49.999739 0-49.999739-49.99974l0 0q0-49.99974 49.999739-49.99974Z" />
              <path d="M238.501424 617.002118m49.999739 0l319.998335 0q49.99974 0 49.999739 49.99974l0 0q0 49.99974-49.999739 49.99974l-319.998335 0q-49.999739 0-49.999739-49.99974l0 0q0-49.99974 49.999739-49.99974Z" />
              <path d="M818.518405 1024h-670.996508A94.579508 94.579508 0 0 1 53.002389 929.520492v-736.996164A94.579508 94.579508 0 0 1 147.481897 98.00482h494.997424a49.99974 49.99974 0 0 1 0 99.999479H153.001869v725.996222h659.996564V577.482324a49.99974 49.99974 0 0 1 99.99948 0v351.998168a94.579508 94.579508 0 0 1-94.479508 94.519508z" />
              <path d="M705.99899 464.002915a49.99974 49.99974 0 0 1-41.379784-77.999594l245.998719-363.998106a49.99974 49.99974 0 1 1 82.849569 55.999709l-245.99872 363.998105A49.99974 49.99974 0 0 1 705.99899 464.002915z" />
            </svg>
          </button>

          <button
            type="button"
            className={`activity-item ${activeLeftPanel === 'skills' ? 'active' : ''}`}
            onClick={() => handleLeftPanelToggle('skills')}
            aria-pressed={activeLeftPanel === 'skills'}
            title={t('app.skills')}
          >
            <svg
              className="activity-icon-skills"
              viewBox="0 0 1024 1024"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="64"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M727.04 305.5616v-3.072c0-57.1392 0-85.7088-16.1792-104.7552a67.584 67.584 0 0 0-7.4752-7.4752C684.4416 174.08 655.7696 174.08 598.6304 174.08H302.4896c-57.1392 0-85.7088 0-104.7552 16.1792a67.584 67.584 0 0 0-7.4752 7.4752c-16.1792 19.0464-16.1792 47.616-16.1792 104.7552V598.6304c0 57.1392 0 85.7088 16.1792 104.7552a67.584 67.584 0 0 0 7.4752 7.4752c19.0464 16.1792 47.616 16.1792 104.7552 16.1792h3.072c21.504 0 32.256 0 38.8096 4.4032a20.48 20.48 0 0 1 2.6624 2.048c5.8368 5.12 9.3184 18.7392 16.384 45.9776 8.6016 33.3824 30.9248 70.4512 87.1424 70.4512 56.32 0 78.5408-37.0688 87.1424-70.4512 7.0656-27.2384 10.5472-40.8576 16.384-46.08a20.3776 20.3776 0 0 1 2.6624-2.048c6.5536-4.3008 17.3056-4.3008 38.912-4.3008h2.9696c57.1392 0 85.8112 0 104.7552-16.1792a67.584 67.584 0 0 0 7.4752-7.4752c16.1792-19.0464 16.1792-47.616 16.1792-104.7552v-3.072c0-21.504 0-32.256 4.4032-38.8096a20.48 20.48 0 0 1 2.048-2.6624c5.12-5.8368 18.7392-9.3184 45.9776-16.384 33.3824-8.6016 70.4512-30.9248 70.4512-87.1424 0-56.32-37.0688-78.5408-70.4512-87.1424-27.2384-7.0656-40.8576-10.5472-46.08-16.384a20.48 20.48 0 0 1-2.048-2.6624c-4.3008-6.5536-4.3008-17.3056-4.3008-38.912z" />
            </svg>
          </button>

          <button
            type="button"
            className={`activity-item ${activeLeftPanel === 'workflows' ? 'active' : ''}`}
            onClick={() => handleLeftPanelToggle('workflows')}
            aria-pressed={activeLeftPanel === 'workflows'}
            title={t('app.workflows')}
          >
            <svg
              className="activity-icon-workflows"
              viewBox="0 0 1024 1024"
              aria-hidden="true"
              fill="currentColor"
            >
              <path d="M96 0a96 96 0 1 1-96 96 96 96 0 0 1 96-96z m32 64h768a32 32 0 0 1 0 64H128a32 32 0 0 1 0-64z m384-64a96 96 0 1 1-96 96 96 96 0 0 1 96-96z m416 0a96 96 0 1 1-96 96 96 96 0 0 1 96-96zM96 416a96 96 0 1 1-96 96 96 96 0 0 1 96-96z m416 0a96 96 0 1 1-96 96 96 96 0 0 1 96-96z m416 0a96 96 0 1 1-96 96 96 96 0 0 1 96-96zM96 832a96 96 0 1 1-96 96 96 96 0 0 1 96-96z m416 0a96 96 0 1 1-96 96 96 96 0 0 1 96-96z m416 0a96 96 0 1 1-96 96 96 96 0 0 1 96-96zM128 480h768a32 32 0 0 1 0 64H128a32 32 0 0 1 0-64z m0 416h768a32 32 0 0 1 0 64H128a32 32 0 0 1 0-64zM928 64a32 32 0 0 1 32 32v384a32 32 0 0 1-64 0V96a32 32 0 0 1 32-32zM96 512a32 32 0 0 1 32 32v384a32 32 0 0 1-64 0V544a32 32 0 0 1 32-32z" />
            </svg>
          </button>

          <div className="activity-bar-bottom">
            <button
              type="button"
              className={`activity-item ${isSettingsOpen ? 'active' : ''}`}
              onClick={() => setSettingsOpen(true)}
              aria-expanded={isSettingsOpen}
              aria-label={t('settings.title')}
              title={t('settings.title')}
            >
              <svg
                className="activity-icon-settings"
                viewBox="0 0 1024 1024"
                aria-hidden="true"
                fill="currentColor"
              >
                <path d="M512 745.448727c-119.505455 0-216.738909-97.210182-216.738909-216.715636s97.233455-216.738909 216.738909-216.738909c119.528727 0 216.738909 97.233455 216.738909 216.738909S631.528727 745.448727 512 745.448727z m0-386.885818c-93.835636 0-170.193455 76.334545-170.193455 170.193455s76.334545 170.170182 170.193455 170.170181 170.193455-76.334545 170.193455-170.170181-76.357818-170.193455-170.193455-170.193455z" />
                <path d="M608.512 1001.821091h-193.047273a23.272727 23.272727 0 0 1-23.272727-23.272727v-88.110546a396.334545 396.334545 0 0 1-65.349818-23.831273l-60.066909 60.043637a23.202909 23.202909 0 0 1-32.907637 0L97.373091 790.109091a23.249455 23.249455 0 0 1 0-32.907636L152.203636 702.370909a393.658182 393.658182 0 0 1-30.603636-70.539636H45.428364a23.272727 23.272727 0 0 1-23.272728-23.272728v-193.047272a23.272727 23.272727 0 0 1 23.272728-23.272728h76.218181a390.865455 390.865455 0 0 1 30.72-70.376727l-54.993454-55.016727a23.249455 23.249455 0 0 1 0-32.907636l136.494545-136.517819a23.970909 23.970909 0 0 1 32.907637 0l60.113454 60.113455c20.526545-9.704727 42.402909-17.687273 65.303273-23.854546V45.451636a23.272727 23.272727 0 0 1 23.272727-23.272727h193.047273a23.272727 23.272727 0 0 1 23.272727 23.272727v98.56c18.781091 6.958545 36.840727 15.220364 54.039273 24.738909l71.354182-71.354181a23.179636 23.179636 0 0 1 32.907636 0l136.494546 136.517818a23.249455 23.249455 0 0 1 0 32.907636L850.385455 343.04c7.400727 15.592727 13.870545 32.023273 19.316363 49.175273h108.846546a23.272727 23.272727 0 0 1 23.272727 23.272727v193.047273a23.272727 23.272727 0 0 1-23.272727 23.272727h-108.939637a397.917091 397.917091 0 0 1-19.572363 48.826182l76.544 76.544a23.249455 23.249455 0 0 1 0 32.907636l-136.494546 136.541091a23.179636 23.179636 0 0 1-32.907636 0l-71.284364-71.330909c-17.221818 9.541818-35.351273 17.826909-54.109091 24.762182v98.466909a23.272727 23.272727 0 0 1-23.272727 23.296z m-169.751273-46.545455h146.501818v-91.764363a23.272727 23.272727 0 0 1 16.104728-22.132364 347.415273 347.415273 0 0 0 76.055272-35.025454 23.272727 23.272727 0 0 1 28.695273 3.351272l67.537455 67.584 103.586909-103.633454-72.005818-72.005818a23.272727 23.272727 0 0 1-4.096-27.368728 350.301091 350.301091 0 0 0 28.672-71.842909 23.249455 23.249455 0 0 1 22.458181-17.152h103.005091v-146.501818h-102.958545a23.272727 23.272727 0 0 1-22.458182-17.152 347.229091 347.229091 0 0 0-28.346182-72.168727 23.226182 23.226182 0 0 1 4.072728-27.415273l71.633454-71.656727-103.586909-103.610182-67.560727 67.560727a23.202909 23.202909 0 0 1-28.672 3.351273 348.765091 348.765091 0 0 0-76.032-34.978909 23.249455 23.249455 0 0 1-16.104728-22.132364V68.724364h-146.501818v83.130181a23.272727 23.272727 0 0 1-18.199272 22.714182 345.018182 345.018182 0 0 0-87.272728 31.790546 23.296 23.296 0 0 1-27.392-4.096l-55.528727-55.528728-103.586909 103.610182 51.269818 51.293091a23.272727 23.272727 0 0 1 3.351273 28.672 345.809455 345.809455 0 0 0-39.866182 91.205818 23.272727 23.272727 0 0 1-22.458182 17.198546H68.701091v146.501818H138.938182c10.496 0 19.688727 7.028364 22.434909 17.128727a347.927273 347.927273 0 0 0 39.796364 91.415273 23.226182 23.226182 0 0 1-3.328 28.718545l-51.083637 51.083637 103.586909 103.633454 55.458909-55.458909a23.296 23.296 0 0 1 27.368728-4.119272 347.601455 347.601455 0 0 0 87.365818 31.744c10.658909 2.397091 18.222545 11.822545 18.222545 22.737454v83.176727z" />
              </svg>
            </button>
          </div>
        </div>
        )}

        <WorkspaceShell
          activeLeftPanel={activeLeftPanel}
          onLeftPanelToggle={handleLeftPanelToggle}
          toggleSidebarVisible={toggleActivityBarVisible}
          isTauriEnv={isTauriEnv}
          initialAction={initialWorkspaceAction}
          initialOpenRecentPath={initialOpenRecentPath}
          initialOpenRecentIsFolder={initialOpenRecentIsFolder}
          onInitialActionHandled={handleInitialActionHandled}
          onDocumentStatsChange={(stats) => setDocCharCount(stats.charCount)}
          onStatusMessageChange={setStatusMessage}
          onSearchScopeChange={setSearchScope}
        />
      </div>

      {isStatusBarVisible && (
        <div className="status-bar">
          <div className="status-bar-left">{t('app.statusBarTitle')}</div>
          <div className="status-bar-center">
            <button
              type="button"
              className="status-bar-music-button"
              onClick={handleOpenMusicPlayer}
              title={resolvedLanguage === 'en-US' ? 'Open music player' : '打开音乐播放器'}
            >
              <span className="status-bar-music-label">
                {currentMusicLabel}
              </span>
            </button>
          </div>
          <div className={`status-bar-right status-bar-right-${backgroundStatusPhase}`}>
            {docCharCount != null && (
              <span style={{ marginRight: displayedStatusMessage ? 12 : 0 }}>
                {t('app.characters', { count: docCharCount.toLocaleString() })}
              </span>
            )}
            <span className="status-bar-message">{displayedStatusMessage || '\u00A0'}</span>
          </div>
        </div>
      )}

      <AiSettingsDialog open={isAiSettingsOpen} onClose={() => setAiSettingsOpen(false)} />
      <AgentSettingsDialog
        open={isAgentSettingsOpen}
        onClose={() => setAgentSettingsOpen(false)}
        onOpenImageGeneration={(agentId) => {
          setInitialImageGenerationAgentId(agentId ?? null)
          setImageGenerationDialogOpen(true)
        }}
      />
      <ImageGenerationDialog
        open={isImageGenerationDialogOpen}
        initialAgentId={initialImageGenerationAgentId}
        onClose={() => setImageGenerationDialogOpen(false)}
      />
      <PromptSettingsDialog open={isPromptSettingsOpen} onClose={() => setPromptSettingsOpen(false)} />
      <McpSettingsDialog open={isMcpSettingsOpen} onClose={() => setMcpSettingsOpen(false)} />
      <SettingsDialog
        open={isSettingsOpen}
        onClose={() => setSettingsOpen(false)}
        searchScope={searchScope}
        onThemeSettingsChange={onThemeSettingsChange}
        onLanguageModeChange={onLanguageModeChange}
        onUiTypographyChange={onUiTypographyChange}
      />
      <Toast message={toastMessage} onDismiss={() => setToastMessage('')} />
    </div>
  )
}

function stripAudioExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '')
}

export default App
