import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import './App.css'
import WorkspaceShell, { type LeftPanelId, type InitialWorkspaceAction } from './components/WorkspaceShell'
import { AiSettingsDialog } from './components/AiSettingsDialog'
import { PromptSettingsDialog } from './components/PromptSettingsDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { I18nProvider, useI18n } from './modules/i18n/I18nContext'
import { resolveLanguageMode } from './modules/i18n/languageResolver'
import type { LanguageMode } from './modules/i18n/schema'
import { onMenuAction } from './modules/platform/menuEvents'
import { isTauriEnv } from './modules/platform/runtime'
import {
  getDefaultLanguageSetting,
  getDefaultThemeSettings,
  getLanguageSetting,
  type ThemeSettings,
} from './modules/settings/editorSettings'
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
  const [isPromptSettingsOpen, setPromptSettingsOpen] = useState(false)
  const [isSettingsOpen, setSettingsOpen] = useState(false)
  const [isStatusBarVisible, setStatusBarVisible] = useState(true)
  const [docCharCount, setDocCharCount] = useState<number | null>(null)
  const [statusMessage, setStatusMessage] = useState('')
  const [themeSettings, setThemeSettings] = useState<ThemeSettings>(getDefaultThemeSettings())
  const [languageMode, setLanguageMode] = useState<LanguageMode>(getDefaultLanguageSetting())
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => getSystemPrefersDark())

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
      if (actionId === 'ai_prompt_settings') {
        setPromptSettingsOpen(true)
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
      const [settings, language] = await Promise.all([loadThemePreference(), getLanguageSetting()])
      if (cancelled) return
      setThemeSettings(settings)
      setLanguageMode(language)
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
  const resolvedLanguage = useMemo(() => resolveLanguageMode(languageMode), [languageMode])

  useEffect(() => {
    applyResolvedTheme(activeTheme, resolvedThemeMode)
  }, [activeTheme, resolvedThemeMode])

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
          isPromptSettingsOpen={isPromptSettingsOpen}
          isSettingsOpen={isSettingsOpen}
          isStatusBarVisible={isStatusBarVisible}
          docCharCount={docCharCount}
          statusMessage={statusMessage}
          handleLeftPanelToggle={handleLeftPanelToggle}
          handleInitialActionHandled={handleInitialActionHandled}
          onThemeSettingsChange={setThemeSettings}
          onLanguageModeChange={setLanguageMode}
          setAiSettingsOpen={setAiSettingsOpen}
          setPromptSettingsOpen={setPromptSettingsOpen}
          setSettingsOpen={setSettingsOpen}
          setStatusBarVisible={setStatusBarVisible}
          setDocCharCount={setDocCharCount}
          setStatusMessage={setStatusMessage}
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
  isPromptSettingsOpen: boolean
  isSettingsOpen: boolean
  isStatusBarVisible: boolean
  docCharCount: number | null
  statusMessage: string
  handleLeftPanelToggle: (id: LeftPanelId) => void
  handleInitialActionHandled: () => void
  onThemeSettingsChange: (settings: ThemeSettings) => void
  onLanguageModeChange: (mode: LanguageMode) => void
  setAiSettingsOpen: (open: boolean) => void
  setPromptSettingsOpen: (open: boolean) => void
  setSettingsOpen: (open: boolean) => void
  setStatusBarVisible: Dispatch<SetStateAction<boolean>>
  setDocCharCount: (count: number | null) => void
  setStatusMessage: (message: string) => void
}

function AppShellContent({
  activeLeftPanel,
  initialWorkspaceAction,
  initialOpenRecentPath,
  initialOpenRecentIsFolder,
  isAiSettingsOpen,
  isPromptSettingsOpen,
  isSettingsOpen,
  isStatusBarVisible,
  docCharCount,
  statusMessage,
  handleLeftPanelToggle,
  handleInitialActionHandled,
  onThemeSettingsChange,
  onLanguageModeChange,
  setAiSettingsOpen,
  setPromptSettingsOpen,
  setSettingsOpen,
  setDocCharCount,
  setStatusMessage,
}: AppShellContentProps) {
  const { t } = useI18n()

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
              <span style={{ marginRight: statusMessage ? 12 : 0 }}>
                {t('app.characters', { count: docCharCount.toLocaleString() })}
              </span>
            )}
            <span>{statusMessage || '\u00A0'}</span>
          </div>
        </div>
      )}

      <AiSettingsDialog open={isAiSettingsOpen} onClose={() => setAiSettingsOpen(false)} />
      <PromptSettingsDialog open={isPromptSettingsOpen} onClose={() => setPromptSettingsOpen(false)} />
      <SettingsDialog
        open={isSettingsOpen}
        onClose={() => setSettingsOpen(false)}
        onThemeSettingsChange={onThemeSettingsChange}
        onLanguageModeChange={onLanguageModeChange}
      />
    </div>
  )
}

export default App
