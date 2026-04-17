import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { invoke } from '@tauri-apps/api/core'
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
import { onWebDavImportFinished, onWebDavImportStarted } from './modules/platform/backupEvents'
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

const appStartTime = performance.now()

function App() {
  const [activeLeftPanel, setActiveLeftPanel] = useState<LeftPanelId>(null)
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
      setActiveLeftPanel((prev) => (prev === id ? null : id))
    },
    [],
  )

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
  handleInitialActionHandled: () => void
  onThemeSettingsChange: (settings: ThemeSettings) => void
  onLanguageModeChange: (mode: LanguageMode) => void
  onUiTypographyChange: (settings: UiTypographySettings) => void
  setDocCharCount: (count: number | null) => void
  setStatusMessage: (message: string) => void
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
  handleInitialActionHandled,
  onThemeSettingsChange,
  onLanguageModeChange,
  onUiTypographyChange,
  setDocCharCount,
  setStatusMessage,
  setAiSettingsOpen,
  setAgentSettingsOpen,
  setPromptSettingsOpen,
  setSettingsOpen,
  setMcpSettingsOpen,
  setImageGenerationDialogOpen,
  setInitialImageGenerationAgentId,
}: AppShellContentProps) {
  const { t } = useI18n()
  const [toastMessage, setToastMessage] = useState('')
  const [backgroundStatusMessage, setBackgroundStatusMessage] = useState('')

  useEffect(() => {
    if (!isTauriEnv()) return

    const unlistenStarted = onWebDavImportStarted(() => {
      setBackgroundStatusMessage(t('backup.webdavImportRunningStatus'))
    })

    const unlisten = onWebDavImportFinished((payload) => {
      setBackgroundStatusMessage('')
      if (payload.success) {
        setToastMessage(t('backup.webdavImportSuccess'))
      } else {
        setToastMessage(t('backup.webdavImportFailed', { message: payload.message ?? 'Unknown error' }))
      }
    })

    return () => {
      unlistenStarted()
      unlisten()
    }
  }, [t])

  const displayedStatusMessage = backgroundStatusMessage || statusMessage

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
            <span className="activity-icon-file" aria-hidden="true" />
          </button>

          <button
            type="button"
            className={`activity-item ${activeLeftPanel === 'outline' ? 'active' : ''}`}
            onClick={() => handleLeftPanelToggle('outline')}
            aria-pressed={activeLeftPanel === 'outline'}
            title={t('app.outline')}
          >
            <span className="activity-icon-outline" aria-hidden="true" />
          </button>

          <button
            type="button"
            className={`activity-item ${activeLeftPanel === 'pdf' ? 'active' : ''}`}
            onClick={() => handleLeftPanelToggle('pdf')}
            aria-pressed={activeLeftPanel === 'pdf'}
            title={t('app.pdf')}
          >
            <span className="activity-icon-pdf" aria-hidden="true" />
          </button>

          <button
            type="button"
            className={`activity-item ${activeLeftPanel === 'sessions' ? 'active' : ''}`}
            onClick={() => handleLeftPanelToggle('sessions')}
            aria-pressed={activeLeftPanel === 'sessions'}
            title={t('app.sessions')}
          >
            <span className="activity-icon-sessions" aria-hidden="true" />
          </button>

          <button
            type="button"
            className={`activity-item ${activeLeftPanel === 'notes' ? 'active' : ''}`}
            onClick={() => handleLeftPanelToggle('notes')}
            aria-pressed={activeLeftPanel === 'notes'}
            title={t('app.notes')}
          >
            <span className="activity-icon-notes" aria-hidden="true" />
          </button>
        </div>

        <WorkspaceShell
          activeLeftPanel={activeLeftPanel}
          isTauriEnv={isTauriEnv}
          initialAction={initialWorkspaceAction}
          initialOpenRecentPath={initialOpenRecentPath}
          initialOpenRecentIsFolder={initialOpenRecentIsFolder}
          onInitialActionHandled={handleInitialActionHandled}
          onDocumentStatsChange={(stats) => setDocCharCount(stats.charCount)}
          onStatusMessageChange={setStatusMessage}
        />
      </div>

      {isStatusBarVisible && (
        <div className="status-bar">
          <div className="status-bar-left">{t('app.statusBarTitle')}</div>
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
        onThemeSettingsChange={onThemeSettingsChange}
        onLanguageModeChange={onLanguageModeChange}
        onUiTypographyChange={onUiTypographyChange}
      />
      <Toast message={toastMessage} onDismiss={() => setToastMessage('')} />
    </div>
  )
}

export default App
