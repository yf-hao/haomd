import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
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
  onWebDavExportStarted,
  onWebDavImportFinished,
  onWebDavImportStarted,
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

function App() {
  const [activeLeftPanel, setActiveLeftPanel] = useState<LeftPanelId>(null)
  const lastVisibleLeftPanelRef = useRef<Exclude<LeftPanelId, null>>('files')
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
  const [isStatusBarVisible, setStatusBarVisible] = useState(true)
  const [docCharCount, setDocCharCount] = useState<number | null>(null)
  const [statusMessage, setStatusMessage] = useState('')
  const [searchScope, setSearchScope] = useState<SearchScope | null>(null)
  const [themeSettings, setThemeSettings] = useState<ThemeSettings>(getDefaultThemeSettings())
  const [languageMode, setLanguageMode] = useState<LanguageMode>(getDefaultLanguageSetting())
  const [systemResolvedLanguage, setSystemResolvedLanguage] = useState<ResolvedLanguage>(() => getSystemResolvedLanguage())
  const [uiTypography, setUiTypography] = useState<UiTypographySettings>(getDefaultUiTypographySettings())
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => getSystemPrefersDark())
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

  const toggleSidebarVisible = useCallback(() => {
    setActiveLeftPanel((prev) => {
      if (prev) {
        lastVisibleLeftPanelRef.current = prev
        return null
      }
      return lastVisibleLeftPanelRef.current
    })
  }, [])

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
    if (!isTauriEnv()) {
      setSystemResolvedLanguage(getSystemResolvedLanguage())
      return
    }

    let cancelled = false

    void invoke<string>('get_system_language')
      .then((language) => {
        if (!cancelled) {
          setSystemResolvedLanguage(normalizeLanguageTag(language))
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSystemResolvedLanguage(getSystemResolvedLanguage())
        }
      })

    return () => {
      cancelled = true
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
      const [settings, language, typography] = await Promise.all([
        loadThemePreference(),
        getLanguageSetting(),
        getUiTypographySettings(),
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
    () => resolveLanguageMode(languageMode, systemResolvedLanguage),
    [languageMode, systemResolvedLanguage],
  )

  useEffect(() => {
    applyResolvedTheme(activeTheme, resolvedThemeMode)
  }, [activeTheme, resolvedThemeMode])

  useEffect(() => {
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
    let timer: number | undefined

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
    timer = window.setInterval(() => {
      void persistMusicSession()
    }, 5000)

    return () => {
      if (timer !== undefined) {
        window.clearInterval(timer)
      }
      cancelled = true
      void saveCurrentMusicSession()
    }
  }, [])

  return (
    <I18nProvider
      value={{
        languageMode,
        resolvedLanguage,
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
          toggleSidebarVisible={toggleSidebarVisible}
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
  toggleSidebarVisible: () => void
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
  toggleSidebarVisible,
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
  const [musicTrackName, setMusicTrackName] = useState<string | null>(null)

  useEffect(() => {
    if (!isTauriEnv()) return

    const unlistenStarted = onWebDavImportStarted(() => {
      setBackgroundStatusMessage(t('backup.webdavImportRunningStatus'))
    })
    const unlistenExportStarted = onWebDavExportStarted(() => {
      setBackgroundStatusMessage(t('backup.webdavExportRunningStatus'))
    })

    const unlistenImport = onWebDavImportFinished((payload) => {
      setBackgroundStatusMessage('')
      if (payload.success) {
        setToastMessage(t('backup.webdavImportSuccess'))
      } else {
        setToastMessage(t('backup.webdavImportFailed', { message: payload.message ?? 'Unknown error' }))
      }
    })
    const unlistenExport = onWebDavExportFinished((payload) => {
      setBackgroundStatusMessage('')
      if (payload.success) {
        const summary = payload.summary
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
        setToastMessage(t('backup.webdavExportFailed', { message: payload.message ?? 'Unknown error' }))
      }
    })

    return () => {
      unlistenStarted()
      unlistenExportStarted()
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
              <path d="M4 3.5V16.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <path d="M4 5H15.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <path d="M4 10H13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <path d="M4 15H10.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
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
              viewBox="0 0 20 20"
              aria-hidden="true"
              fill="none"
            >
              <path
                d="M4 1.8H16V18.2H4V1.8Z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <path
                d="M7 13.8V7H10.2C11.6 7 12.6 8 12.6 9.3C12.6 10.7 11.6 11.6 10.2 11.6H7"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
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
              viewBox="0 0 20 20"
              aria-hidden="true"
              fill="none"
            >
              <path
                d="M3 8.5H10.8C12.1 8.5 13.2 9.6 13.2 10.9V13.6C13.2 14.9 12.1 16 10.8 16H7.9L5 18V16H3C1.7 16 0.6 14.9 0.6 13.6V10.9C0.6 9.6 1.7 8.5 3 8.5Z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <path
                d="M11.8 2.5H16.8C17.9 2.5 18.8 3.4 18.8 4.5V6.2C18.8 7.3 17.9 8.2 16.8 8.2H15.3L13.2 9.7V8.2H11.8C10.7 8.2 9.8 7.3 9.8 6.2V4.5C9.8 3.4 10.7 2.5 11.8 2.5Z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
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
              viewBox="0 0 20 20"
              aria-hidden="true"
              fill="none"
            >
              <g transform="rotate(-28 10 10)">
                <path
                  d="M7.6 0.2H12.4V5.4"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
                <path d="M8.8 0.2V5.4" stroke="currentColor" strokeWidth="1" />
                <path d="M11.2 0.2V5.4" stroke="currentColor" strokeWidth="1" />
                <path
                  d="M10 2.2L15.2 7.4L13.4 14.4L10 17.8L6.6 14.4L4.8 7.4L10 2.2Z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
                <circle cx="10" cy="8.1" r="1.6" fill="currentColor" />
                <path d="M10 9.8V15.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </g>
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
              viewBox="0 0 20 20"
              aria-hidden="true"
              fill="none"
            >
              <rect x="2.5" y="2.5" width="5.5" height="5.5" stroke="currentColor" strokeWidth="1.6" />
              <rect x="12" y="2.5" width="5.5" height="5.5" stroke="currentColor" strokeWidth="1.6" />
              <rect x="5" y="11.5" width="10" height="5.5" stroke="currentColor" strokeWidth="1.6" />
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
              viewBox="0 0 20 20"
              aria-hidden="true"
              fill="none"
            >
              <circle cx="5" cy="5" r="2.25" fill="currentColor" />
              <circle cx="14.5" cy="7.75" r="2.25" fill="currentColor" opacity="0.9" />
              <circle cx="15" cy="15" r="2.25" fill="currentColor" />
              <path
                d="M7.4 5H9.8C11.2 5 12.4 5.7 13.1 6.9"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="2.2 2"
              />
              <path
                d="M14.5 9.75V11.8C14.5 13.1 14.7 13.9 15 15"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="2.2 2"
              />
              <path
                d="M13.4 13.9L15 15.5L16.6 13.9"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        <WorkspaceShell
          activeLeftPanel={activeLeftPanel}
          toggleSidebarVisible={toggleSidebarVisible}
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
          <div className="status-bar-right">
            {docCharCount != null && (
              <span style={{ marginRight: displayedStatusMessage ? 12 : 0 }}>
                {t('app.characters', { count: docCharCount.toLocaleString() })}
              </span>
            )}
            <span>{displayedStatusMessage || '\u00A0'}</span>
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
