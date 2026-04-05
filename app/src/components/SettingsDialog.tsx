import { type ChangeEvent, type FC, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import './SettingsDialog.css'
import { Button } from './Button'
import { FontSelectField } from './settings/FontSelectField'
import { useI18n } from '../modules/i18n/I18nContext'
import { onNativePaste } from '../modules/platform/clipboardEvents'
import type { BackendResult } from '../modules/platform/backendTypes'
import type { LanguageMode } from '../modules/i18n/schema'
import {
  getDefaultWebDavBackupSettings,
  DEFAULT_WEBDAV_REMOTE_PATH,
  getDefaultLanguageSetting,
  getDefaultThemeSettings,
  getDefaultUiTypographySettings,
  getDefaultWordExportStyleSettings,
  getLanguageSetting,
  getThemeSettings,
  getUiTypographySettings,
  getWordExportStyleSettings,
  loadEditorSettings,
  saveEditorSettings,
  type EditorSettings,
  type ThemeBackgroundSettings,
  type ThemeBackgroundSize,
  type ThemeSettings,
  type UiTypographySettings,
  type WordExportStyleSettings,
  type WebDavBackupSettings,
} from '../modules/settings/editorSettings'
import { resolveManagedBackgroundImageUrl } from '../modules/theme/backgroundImageRuntime'
import type { ThemeMode } from '../modules/theme/schema'
import { subscribeUiTypographyChanged } from '../modules/settings/uiTypographyRuntime'
import { builtinBackgroundPresets, getBuiltinBackgroundPresetLabel } from '../modules/theme/backgroundPresets'

export type SettingsDialogProps = {
  open: boolean
  onClose: () => void
  onThemeSettingsChange?: (settings: ThemeSettings) => void
  onLanguageModeChange?: (mode: LanguageMode) => void
  onUiTypographyChange?: (settings: UiTypographySettings) => void
}

type SettingsSectionId = 'theme' | 'typography' | 'word-export' | 'backup'
type ThemePanelTabId = 'theme-preset' | 'backgrounds'
type WordExportTabId = 'document' | 'layout' | 'diagrams' | 'templates'
type WordTemplateOption = {
  id: string
  name: string
  dir: string
  docxPath: string
  jsonPath: string
}
type WebDavField = 'url' | 'username' | 'password'
type BackgroundTarget =
  | 'workspaceBackground'
  | 'editorBackground'
  | 'previewBackground'
  | 'aiChatBackground'
  | 'sidebarBackground'

const fieldGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '180px minmax(0, 1fr)',
  gap: 12,
  alignItems: 'center',
}

export const SettingsDialog: FC<SettingsDialogProps> = ({
  open,
  onClose,
  onThemeSettingsChange,
  onLanguageModeChange,
  onUiTypographyChange,
}) => {
  const { t } = useI18n()
  const [settings, setSettings] = useState<EditorSettings>({})
  const [theme, setTheme] = useState<ThemeSettings>(getDefaultThemeSettings())
  const [languageMode, setLanguageMode] = useState<LanguageMode>(getDefaultLanguageSetting())
  const [wordExport, setWordExport] = useState<WordExportStyleSettings>(getDefaultWordExportStyleSettings())
  const [webdavBackup, setWebdavBackup] = useState<WebDavBackupSettings>(getDefaultWebDavBackupSettings())
  const [uiTypography, setUiTypography] = useState<UiTypographySettings>(getDefaultUiTypographySettings())
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('theme')
  const [activeThemeTab, setActiveThemeTab] = useState<ThemePanelTabId>('theme-preset')
  const [activeWordExportTab, setActiveWordExportTab] = useState<WordExportTabId>('document')
  const [wordTemplates, setWordTemplates] = useState<WordTemplateOption[]>([])
  const [currentBackgroundTarget, setCurrentBackgroundTarget] = useState<BackgroundTarget>('workspaceBackground')
  const [isSaving, setIsSaving] = useState(false)
  const [backupBusy, setBackupBusy] = useState<
    'export' | 'import' | 'webdav-test' | 'webdav-export' | 'webdav-import' | null
  >(null)
  const [backupStatus, setBackupStatus] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [workspaceBackgroundOpacityInput, setWorkspaceBackgroundOpacityInput] = useState('')
  const [workspaceBackgroundOverlayOpacityInput, setWorkspaceBackgroundOverlayOpacityInput] = useState('')
  const [workspaceBackgroundBlurInput, setWorkspaceBackgroundBlurInput] = useState('')
  const [workspaceBackgroundBrightnessInput, setWorkspaceBackgroundBrightnessInput] = useState('')
  const [editorBackgroundOpacityInput, setEditorBackgroundOpacityInput] = useState('')
  const [editorBackgroundOverlayOpacityInput, setEditorBackgroundOverlayOpacityInput] = useState('')
  const [editorBackgroundBlurInput, setEditorBackgroundBlurInput] = useState('')
  const [editorBackgroundBrightnessInput, setEditorBackgroundBrightnessInput] = useState('')
  const [previewBackgroundOpacityInput, setPreviewBackgroundOpacityInput] = useState('')
  const [previewBackgroundOverlayOpacityInput, setPreviewBackgroundOverlayOpacityInput] = useState('')
  const [previewBackgroundBlurInput, setPreviewBackgroundBlurInput] = useState('')
  const [previewBackgroundBrightnessInput, setPreviewBackgroundBrightnessInput] = useState('')
  const [aiChatBackgroundOpacityInput, setAiChatBackgroundOpacityInput] = useState('')
  const [aiChatBackgroundOverlayOpacityInput, setAiChatBackgroundOverlayOpacityInput] = useState('')
  const [aiChatBackgroundBlurInput, setAiChatBackgroundBlurInput] = useState('')
  const [aiChatBackgroundBrightnessInput, setAiChatBackgroundBrightnessInput] = useState('')
  const [sidebarBackgroundOpacityInput, setSidebarBackgroundOpacityInput] = useState('')
  const [sidebarBackgroundOverlayOpacityInput, setSidebarBackgroundOverlayOpacityInput] = useState('')
  const [sidebarBackgroundBlurInput, setSidebarBackgroundBlurInput] = useState('')
  const [sidebarBackgroundBrightnessInput, setSidebarBackgroundBrightnessInput] = useState('')
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const previewDragRef = useRef(false)
  const modalRef = useRef<HTMLDivElement | null>(null)
  const webdavUrlInputRef = useRef<HTMLInputElement | null>(null)
  const webdavUsernameInputRef = useRef<HTMLInputElement | null>(null)
  const webdavPasswordInputRef = useRef<HTMLInputElement | null>(null)
  const originalThemeRef = useRef<ThemeSettings>(getDefaultThemeSettings())
  const originalLanguageRef = useRef<LanguageMode>(getDefaultLanguageSetting())
  const originalTypographyRef = useRef<UiTypographySettings>(getDefaultUiTypographySettings())
  const hasLocalPreviewEditsRef = useRef(false)
  const themePreviewReadyRef = useRef(false)
  const dialogDragRef = useRef<{
    active: boolean
    pointerId: number | null
    startX: number
    startY: number
    originX: number
    originY: number
  }>({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  })

  useEffect(() => {
    if (!open) return
    setDragOffset({ x: 0, y: 0 })
    setBackupBusy(null)
    setBackupStatus(null)
    hasLocalPreviewEditsRef.current = false
    let cancelled = false
    ;(async () => {
      try {
        const [loadedSettings, loadedTheme, loadedLanguage, loadedTypography, loadedWordExport] = await Promise.all([
          loadEditorSettings(),
          getThemeSettings(),
          getLanguageSetting(),
          getUiTypographySettings(),
          getWordExportStyleSettings(),
        ])
        if (cancelled) return
        if (hasLocalPreviewEditsRef.current) return
        setSettings(loadedSettings)
        setTheme(loadedTheme)
        originalThemeRef.current = loadedTheme
        setLanguageMode(loadedLanguage)
        originalLanguageRef.current = loadedLanguage
        setUiTypography(loadedTypography)
        originalTypographyRef.current = loadedTypography
        themePreviewReadyRef.current = true
        setWordExport(loadedWordExport)
        setWebdavBackup({
          enabled: loadedSettings.backup?.webdav?.enabled ?? getDefaultWebDavBackupSettings().enabled,
          url: loadedSettings.backup?.webdav?.url ?? getDefaultWebDavBackupSettings().url,
          username: loadedSettings.backup?.webdav?.username ?? getDefaultWebDavBackupSettings().username,
          password: loadedSettings.backup?.webdav?.password ?? getDefaultWebDavBackupSettings().password,
          remotePath: DEFAULT_WEBDAV_REMOTE_PATH,
        })
        setWorkspaceBackgroundOpacityInput(String(loadedTheme.workspaceBackground?.opacity ?? getDefaultThemeSettings().workspaceBackground?.opacity ?? 0.22))
        setWorkspaceBackgroundOverlayOpacityInput(String(loadedTheme.workspaceBackground?.overlayOpacity ?? getDefaultThemeSettings().workspaceBackground?.overlayOpacity ?? 0.12))
        setWorkspaceBackgroundBlurInput(String(loadedTheme.workspaceBackground?.blurPx ?? getDefaultThemeSettings().workspaceBackground?.blurPx ?? 0))
        setWorkspaceBackgroundBrightnessInput(String(loadedTheme.workspaceBackground?.brightness ?? getDefaultThemeSettings().workspaceBackground?.brightness ?? 100))
        setEditorBackgroundOpacityInput(String(loadedTheme.editorBackground?.opacity ?? getDefaultThemeSettings().editorBackground?.opacity ?? 0.3))
        setEditorBackgroundOverlayOpacityInput(String(loadedTheme.editorBackground?.overlayOpacity ?? getDefaultThemeSettings().editorBackground?.overlayOpacity ?? 0))
        setEditorBackgroundBlurInput(String(loadedTheme.editorBackground?.blurPx ?? getDefaultThemeSettings().editorBackground?.blurPx ?? 0))
        setEditorBackgroundBrightnessInput(String(loadedTheme.editorBackground?.brightness ?? getDefaultThemeSettings().editorBackground?.brightness ?? 100))
        setPreviewBackgroundOpacityInput(String(loadedTheme.previewBackground?.opacity ?? getDefaultThemeSettings().previewBackground?.opacity ?? 0.22))
        setPreviewBackgroundOverlayOpacityInput(String(loadedTheme.previewBackground?.overlayOpacity ?? getDefaultThemeSettings().previewBackground?.overlayOpacity ?? 0.12))
        setPreviewBackgroundBlurInput(String(loadedTheme.previewBackground?.blurPx ?? getDefaultThemeSettings().previewBackground?.blurPx ?? 0))
        setPreviewBackgroundBrightnessInput(String(loadedTheme.previewBackground?.brightness ?? getDefaultThemeSettings().previewBackground?.brightness ?? 100))
        setAiChatBackgroundOpacityInput(String(loadedTheme.aiChatBackground?.opacity ?? getDefaultThemeSettings().aiChatBackground?.opacity ?? 0.3))
        setAiChatBackgroundOverlayOpacityInput(String(loadedTheme.aiChatBackground?.overlayOpacity ?? getDefaultThemeSettings().aiChatBackground?.overlayOpacity ?? 0))
        setAiChatBackgroundBlurInput(String(loadedTheme.aiChatBackground?.blurPx ?? getDefaultThemeSettings().aiChatBackground?.blurPx ?? 0))
        setAiChatBackgroundBrightnessInput(String(loadedTheme.aiChatBackground?.brightness ?? getDefaultThemeSettings().aiChatBackground?.brightness ?? 100))
        setSidebarBackgroundOpacityInput(String(loadedTheme.sidebarBackground?.opacity ?? getDefaultThemeSettings().sidebarBackground?.opacity ?? 0.2))
        setSidebarBackgroundOverlayOpacityInput(String(loadedTheme.sidebarBackground?.overlayOpacity ?? getDefaultThemeSettings().sidebarBackground?.overlayOpacity ?? 0.16))
        setSidebarBackgroundBlurInput(String(loadedTheme.sidebarBackground?.blurPx ?? getDefaultThemeSettings().sidebarBackground?.blurPx ?? 0))
        setSidebarBackgroundBrightnessInput(String(loadedTheme.sidebarBackground?.brightness ?? getDefaultThemeSettings().sidebarBackground?.brightness ?? 100))
        setError(null)
      } catch (err) {
        if (cancelled) return
        setError((err as Error).message || 'Failed to load settings')
      }
    })()
    return () => {
      cancelled = true
      themePreviewReadyRef.current = false
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      try {
        const items = await invoke<WordTemplateOption[]>('list_word_templates')
        if (cancelled) return
        setWordTemplates(items)
      } catch (err) {
        if (cancelled) return
        console.warn('[SettingsDialog] list_word_templates failed', err)
        setWordTemplates([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    return subscribeUiTypographyChanged((nextTypography) => {
      setUiTypography(nextTypography)
      originalTypographyRef.current = nextTypography
    })
  }, [open])

  useEffect(() => {
    if (!open || !themePreviewReadyRef.current) return
    onLanguageModeChange?.(languageMode)
  }, [open, languageMode, onLanguageModeChange])

  useEffect(() => {
    if (!open || !themePreviewReadyRef.current) return
    onUiTypographyChange?.(uiTypography)
  }, [open, uiTypography, onUiTypographyChange])

  useEffect(() => {
    if (!open) return

    const unPaste = onNativePaste((text) => {
      if (!text || typeof document === 'undefined') return

      const active = document.activeElement as HTMLElement | null
      if (!active) return

      let el: HTMLInputElement | null = null
      let field: WebDavField | null = null

      if (active === webdavUrlInputRef.current) {
        el = active as HTMLInputElement
        field = 'url'
      } else if (active === webdavUsernameInputRef.current) {
        el = active as HTMLInputElement
        field = 'username'
      } else if (active === webdavPasswordInputRef.current) {
        el = active as HTMLInputElement
        field = 'password'
      } else {
        return
      }

      const start = el.selectionStart ?? el.value.length
      const end = el.selectionEnd ?? el.value.length
      const current = el.value
      const next = current.slice(0, start) + text + current.slice(end)

      el.value = next
      setWebdavBackup((prev) => ({
        ...prev,
        [field]: next,
      }))

      const pos = start + text.length
      el.setSelectionRange(pos, pos)
    })

    return () => {
      unPaste()
    }
  }, [open])

  useEffect(() => {
    if (!open || !themePreviewReadyRef.current || !hasLocalPreviewEditsRef.current) return
    onThemeSettingsChange?.({
      ...theme,
      workspaceBackground: theme.workspaceBackground ? { ...theme.workspaceBackground } : undefined,
      editorBackground: theme.editorBackground ? { ...theme.editorBackground } : undefined,
      previewBackground: theme.previewBackground ? { ...theme.previewBackground } : undefined,
      aiChatBackground: theme.aiChatBackground ? { ...theme.aiChatBackground } : undefined,
      sidebarBackground: theme.sidebarBackground ? { ...theme.sidebarBackground } : undefined,
    })
  }, [open, theme, onThemeSettingsChange])

  useEffect(() => {
    setWorkspaceBackgroundOpacityInput(String(theme.workspaceBackground?.opacity ?? getDefaultThemeSettings().workspaceBackground?.opacity ?? 0.22))
    setWorkspaceBackgroundOverlayOpacityInput(String(theme.workspaceBackground?.overlayOpacity ?? getDefaultThemeSettings().workspaceBackground?.overlayOpacity ?? 0.12))
    setWorkspaceBackgroundBlurInput(String(theme.workspaceBackground?.blurPx ?? getDefaultThemeSettings().workspaceBackground?.blurPx ?? 0))
    setWorkspaceBackgroundBrightnessInput(String(theme.workspaceBackground?.brightness ?? getDefaultThemeSettings().workspaceBackground?.brightness ?? 100))
    setEditorBackgroundOpacityInput(String(theme.editorBackground?.opacity ?? getDefaultThemeSettings().editorBackground?.opacity ?? 0.3))
    setEditorBackgroundOverlayOpacityInput(String(theme.editorBackground?.overlayOpacity ?? getDefaultThemeSettings().editorBackground?.overlayOpacity ?? 0))
    setEditorBackgroundBlurInput(String(theme.editorBackground?.blurPx ?? getDefaultThemeSettings().editorBackground?.blurPx ?? 0))
    setEditorBackgroundBrightnessInput(String(theme.editorBackground?.brightness ?? getDefaultThemeSettings().editorBackground?.brightness ?? 100))
    setPreviewBackgroundOpacityInput(String(theme.previewBackground?.opacity ?? getDefaultThemeSettings().previewBackground?.opacity ?? 0.22))
    setPreviewBackgroundOverlayOpacityInput(String(theme.previewBackground?.overlayOpacity ?? getDefaultThemeSettings().previewBackground?.overlayOpacity ?? 0.12))
    setPreviewBackgroundBlurInput(String(theme.previewBackground?.blurPx ?? getDefaultThemeSettings().previewBackground?.blurPx ?? 0))
    setPreviewBackgroundBrightnessInput(String(theme.previewBackground?.brightness ?? getDefaultThemeSettings().previewBackground?.brightness ?? 100))
    setAiChatBackgroundOpacityInput(String(theme.aiChatBackground?.opacity ?? getDefaultThemeSettings().aiChatBackground?.opacity ?? 0.3))
    setAiChatBackgroundOverlayOpacityInput(String(theme.aiChatBackground?.overlayOpacity ?? getDefaultThemeSettings().aiChatBackground?.overlayOpacity ?? 0))
    setAiChatBackgroundBlurInput(String(theme.aiChatBackground?.blurPx ?? getDefaultThemeSettings().aiChatBackground?.blurPx ?? 0))
    setAiChatBackgroundBrightnessInput(String(theme.aiChatBackground?.brightness ?? getDefaultThemeSettings().aiChatBackground?.brightness ?? 100))
    setSidebarBackgroundOpacityInput(String(theme.sidebarBackground?.opacity ?? getDefaultThemeSettings().sidebarBackground?.opacity ?? 0.2))
    setSidebarBackgroundOverlayOpacityInput(String(theme.sidebarBackground?.overlayOpacity ?? getDefaultThemeSettings().sidebarBackground?.overlayOpacity ?? 0.16))
    setSidebarBackgroundBlurInput(String(theme.sidebarBackground?.blurPx ?? getDefaultThemeSettings().sidebarBackground?.blurPx ?? 0))
    setSidebarBackgroundBrightnessInput(String(theme.sidebarBackground?.brightness ?? getDefaultThemeSettings().sidebarBackground?.brightness ?? 100))
  }, [
    theme.workspaceBackground?.opacity,
    theme.workspaceBackground?.overlayOpacity,
    theme.workspaceBackground?.blurPx,
    theme.workspaceBackground?.brightness,
    theme.editorBackground?.opacity,
    theme.editorBackground?.overlayOpacity,
    theme.editorBackground?.blurPx,
    theme.editorBackground?.brightness,
    theme.previewBackground?.opacity,
    theme.previewBackground?.overlayOpacity,
    theme.previewBackground?.blurPx,
    theme.previewBackground?.brightness,
    theme.aiChatBackground?.opacity,
    theme.aiChatBackground?.overlayOpacity,
    theme.aiChatBackground?.blurPx,
    theme.aiChatBackground?.brightness,
    theme.sidebarBackground?.opacity,
    theme.sidebarBackground?.overlayOpacity,
    theme.sidebarBackground?.blurPx,
    theme.sidebarBackground?.brightness,
  ])

  if (!open) return null

  const expectBackendOk = <T,>(resp: BackendResult<T>): T => {
    if ('Ok' in resp) {
      return resp.Ok.data
    }
    throw new Error(resp.Err.error.message)
  }

  const handleExportBackup = async () => {
    try {
      setBackupStatus(null)
      const now = new Date()
      const yyyy = now.getFullYear()
      const mm = String(now.getMonth() + 1).padStart(2, '0')
      const dd = String(now.getDate()).padStart(2, '0')
      const hh = String(now.getHours()).padStart(2, '0')
      const min = String(now.getMinutes()).padStart(2, '0')
      const suggested = `haomd-backup-${yyyy}${mm}${dd}-${hh}${min}.zip`
      const selected = await saveDialog({
        title: t('backup.exportDialogTitle'),
        defaultPath: suggested,
        filters: [{ name: 'ZIP', extensions: ['zip'] }],
      })
      const outputPath = Array.isArray(selected) ? selected[0] : selected
      if (!outputPath || typeof outputPath !== 'string') return

      setBackupBusy('export')
      const resp = await invoke<BackendResult<null>>('export_settings_backup', { outputPath })
      expectBackendOk(resp)
      setBackupStatus({ tone: 'success', message: t('backup.exportSuccess', { path: outputPath }) })
    } catch (err) {
      setBackupStatus({ tone: 'error', message: t('backup.exportFailed', { message: (err as Error).message }) })
    } finally {
      setBackupBusy(null)
    }
  }

  const handleImportBackup = async () => {
    try {
      setBackupStatus(null)
      const selected = await openDialog({
        title: t('backup.importDialogTitle'),
        multiple: false,
        filters: [{ name: 'ZIP', extensions: ['zip'] }],
      })
      const backupPath = Array.isArray(selected) ? selected[0] : selected
      if (!backupPath || typeof backupPath !== 'string') return

      setBackupBusy('import')
      const resp = await invoke<BackendResult<null>>('import_settings_backup', { backupPath })
      expectBackendOk(resp)
      setBackupStatus({ tone: 'success', message: t('backup.importSuccess') })
    } catch (err) {
      setBackupStatus({ tone: 'error', message: t('backup.importFailed', { message: (err as Error).message }) })
    } finally {
      setBackupBusy(null)
    }
  }

  const handleExportBackupToWebDav = async () => {
    try {
      setBackupStatus(null)
      setBackupBusy('webdav-export')
      const resp = await invoke<BackendResult<null>>('export_settings_backup_to_webdav', {
        url: webdavBackup.url,
        username: webdavBackup.username,
        password: webdavBackup.password,
        remotePath: DEFAULT_WEBDAV_REMOTE_PATH,
      })
      expectBackendOk(resp)
      setBackupStatus({ tone: 'success', message: t('backup.webdavExportSuccess') })
    } catch (err) {
      setBackupStatus({ tone: 'error', message: t('backup.webdavExportFailed', { message: (err as Error).message }) })
    } finally {
      setBackupBusy(null)
    }
  }

  const handleTestWebDavConnection = async () => {
    try {
      setBackupStatus(null)
      setBackupBusy('webdav-test')
      const resp = await invoke<BackendResult<null>>('test_webdav_connection', {
        url: webdavBackup.url,
        username: webdavBackup.username,
        password: webdavBackup.password,
      })
      expectBackendOk(resp)
      setBackupStatus({ tone: 'success', message: t('backup.webdavTestSuccess') })
    } catch (err) {
      setBackupStatus({ tone: 'error', message: t('backup.webdavTestFailed', { message: (err as Error).message }) })
    } finally {
      setBackupBusy(null)
    }
  }

  const handleImportBackupFromWebDav = async () => {
    try {
      setBackupStatus(null)
      setBackupBusy('webdav-import')
      const resp = await invoke<BackendResult<null>>('import_settings_backup_from_webdav', {
        url: webdavBackup.url,
        username: webdavBackup.username,
        password: webdavBackup.password,
        remotePath: DEFAULT_WEBDAV_REMOTE_PATH,
      })
      expectBackendOk(resp)
      setBackupStatus({ tone: 'success', message: t('backup.webdavImportSuccess') })
    } catch (err) {
      setBackupStatus({ tone: 'error', message: t('backup.webdavImportFailed', { message: (err as Error).message }) })
    } finally {
      setBackupBusy(null)
    }
  }

  const updateNumber =
    (key: keyof WordExportStyleSettings) =>
      (event: ChangeEvent<HTMLInputElement>) => {
        const value = Number(event.target.value)
        setWordExport((prev) => ({
          ...prev,
          [key]: Number.isFinite(value) ? value : prev[key],
        }))
      }

  const updateFontFamily = (key: 'bodyFontFamily' | 'headingFontFamily') => (value: string) => {
    setWordExport((prev) => ({
      ...prev,
      [key]: value,
    }))
  }

  const updateThemeMode = (mode: ThemeMode) => {
    hasLocalPreviewEditsRef.current = true
    setTheme((prev) => ({ ...prev, mode }))
  }

  const updateTypographyNumber =
    (key: keyof UiTypographySettings) =>
      (event: ChangeEvent<HTMLInputElement>) => {
        const value = Number(event.target.value)
        if (!Number.isFinite(value)) return
        setUiTypography((prev) => ({
          ...prev,
          [key]: Math.min(Math.max(value, 10), 24),
        }))
      }

  const getDefaultBackgroundSettings = (target: BackgroundTarget): ThemeBackgroundSettings => {
    const defaults = getDefaultThemeSettings()
    return {
      ...(target === 'workspaceBackground'
        ? defaults.workspaceBackground
        : target === 'editorBackground'
        ? defaults.editorBackground
        : target === 'previewBackground'
          ? defaults.previewBackground
          : target === 'aiChatBackground'
            ? defaults.aiChatBackground
            : defaults.sidebarBackground)!,
    }
  }

  const getBackgroundSettings = (target: BackgroundTarget): ThemeBackgroundSettings => {
    const current =
      target === 'workspaceBackground'
        ? theme.workspaceBackground
        : target === 'editorBackground'
        ? theme.editorBackground
        : target === 'previewBackground'
          ? theme.previewBackground
          : target === 'aiChatBackground'
            ? theme.aiChatBackground
            : theme.sidebarBackground
    return {
      ...getDefaultBackgroundSettings(target),
      ...current,
    }
  }

  const setBackgroundNumberInput = (
    target: BackgroundTarget,
    key: 'opacity' | 'overlayOpacity' | 'blurPx' | 'brightness',
    value: string,
  ) => {
    if (target === 'workspaceBackground') {
      if (key === 'opacity') setWorkspaceBackgroundOpacityInput(value)
      else if (key === 'overlayOpacity') setWorkspaceBackgroundOverlayOpacityInput(value)
      else if (key === 'blurPx') setWorkspaceBackgroundBlurInput(value)
      else setWorkspaceBackgroundBrightnessInput(value)
      return
    }
    if (target === 'editorBackground') {
      if (key === 'opacity') setEditorBackgroundOpacityInput(value)
      else if (key === 'overlayOpacity') setEditorBackgroundOverlayOpacityInput(value)
      else if (key === 'blurPx') setEditorBackgroundBlurInput(value)
      else setEditorBackgroundBrightnessInput(value)
      return
    }
    if (target === 'previewBackground') {
      if (key === 'opacity') setPreviewBackgroundOpacityInput(value)
      else if (key === 'overlayOpacity') setPreviewBackgroundOverlayOpacityInput(value)
      else if (key === 'blurPx') setPreviewBackgroundBlurInput(value)
      else setPreviewBackgroundBrightnessInput(value)
      return
    }
    if (target === 'sidebarBackground') {
      if (key === 'opacity') setSidebarBackgroundOpacityInput(value)
      else if (key === 'overlayOpacity') setSidebarBackgroundOverlayOpacityInput(value)
      else if (key === 'blurPx') setSidebarBackgroundBlurInput(value)
      else setSidebarBackgroundBrightnessInput(value)
      return
    }

    if (key === 'opacity') setAiChatBackgroundOpacityInput(value)
    else if (key === 'overlayOpacity') setAiChatBackgroundOverlayOpacityInput(value)
    else if (key === 'blurPx') setAiChatBackgroundBlurInput(value)
    else setAiChatBackgroundBrightnessInput(value)
  }

  const updateThemeBackground = (
    target: BackgroundTarget,
    patch: Partial<ThemeBackgroundSettings>,
  ) => {
    hasLocalPreviewEditsRef.current = true
    console.warn('[SettingsDialog] updateThemeBackground', { target, patch })
    setTheme((prev) => ({
      ...prev,
      [target]: {
        ...getDefaultBackgroundSettings(target),
        ...(target === 'workspaceBackground'
          ? prev.workspaceBackground
          : target === 'editorBackground'
          ? prev.editorBackground
          : target === 'previewBackground'
            ? prev.previewBackground
            : target === 'aiChatBackground'
              ? prev.aiChatBackground
              : prev.sidebarBackground),
        ...patch,
      },
    }))
  }

  const handleSelectBackgroundImage = async (target: BackgroundTarget) => {
    try {
      const selected = await invoke<string | null>('pick_editor_background_image', {
        currentPath: getBackgroundSettings(target).path,
      })
      console.warn('[SettingsDialog] selectBackgroundImage result', { target, selected })
      if (!selected) return
      updateThemeBackground(target, {
        enabled: true,
        path: selected,
      })
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : String(err)
      setError(message || 'Failed to choose editor background image')
    }
  }

  const clearBackgroundImage = (target: BackgroundTarget) => {
    updateThemeBackground(target, {
      enabled: false,
      path: null,
    })
  }

  const selectBuiltinBackgroundImage = (target: BackgroundTarget, presetId: string) => {
    updateThemeBackground(target, {
      enabled: true,
      path: `builtin:${presetId}`,
    })
  }

  const commitBackgroundNumber = (
    target: BackgroundTarget,
    key: 'opacity' | 'overlayOpacity' | 'blurPx' | 'brightness',
    rawValue: string,
  ) => {
    const trimmed = rawValue.trim()
    if (!trimmed) {
      updateThemeBackground(target, { [key]: 0 } as Pick<ThemeBackgroundSettings, typeof key>)
      setBackgroundNumberInput(target, key, '')
      return
    }

    const value = Number(trimmed)
    if (!Number.isFinite(value)) return
    const normalizedValue = key === 'opacity'
      ? Math.min(Math.max(value, 0), 0.4)
      : key === 'overlayOpacity'
        ? Math.min(Math.max(value, 0), 1)
      : key === 'brightness'
        ? Math.min(Math.max(value, 0), 200)
        : value

    updateThemeBackground(target, { [key]: normalizedValue } as Pick<ThemeBackgroundSettings, typeof key>)
    setBackgroundNumberInput(target, key, String(normalizedValue))
  }

  const updateBackgroundSize = (target: BackgroundTarget) => (event: ChangeEvent<HTMLSelectElement>) => {
    updateThemeBackground(target, { size: event.target.value as ThemeBackgroundSize })
  }

  const updateEditorBackgroundPositionFromPointer = (
    target: BackgroundTarget,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const x = ((event.clientX - rect.left) / rect.width) * 100
    const y = ((event.clientY - rect.top) / rect.height) * 100
    updateThemeBackground(target, {
      positionX: Math.min(Math.max(Number(x.toFixed(2)), 0), 100),
      positionY: Math.min(Math.max(Number(y.toFixed(2)), 0), 100),
    })
  }

  const handleReset = () => {
    if (activeSection === 'theme') {
      if (activeThemeTab === 'backgrounds') {
        hasLocalPreviewEditsRef.current = true
        setTheme((prev) => {
          const nextTheme = {
            ...prev,
            [currentBackgroundTarget]: getDefaultBackgroundSettings(currentBackgroundTarget),
          }
          if (currentBackgroundTarget === 'workspaceBackground') {
            nextTheme.workspaceBackgroundIncludeSidebar =
              getDefaultThemeSettings().workspaceBackgroundIncludeSidebar ?? false
          }
          return nextTheme
        })
      }
      return
    }
    if (activeSection === 'typography') {
      setUiTypography(getDefaultUiTypographySettings())
      return
    }
    setWordExport(getDefaultWordExportStyleSettings())
  }

  const handleSave = async () => {
    setIsSaving(true)
    setError(null)
    try {
      const nextSettings: EditorSettings = {
        ...settings,
        language: languageMode,
        theme,
        uiTypography,
        wordExport,
        backup: {
          ...(settings.backup ?? {}),
          webdav: webdavBackup,
        },
      }
      await saveEditorSettings(nextSettings)
      setSettings(nextSettings)
      originalThemeRef.current = theme
      originalLanguageRef.current = languageMode
      originalTypographyRef.current = uiTypography
      onClose()
    } catch (err) {
      setError((err as Error).message || 'Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  const handleCloseWithoutSave = () => {
    if (themePreviewReadyRef.current) {
      onThemeSettingsChange?.(originalThemeRef.current)
      onLanguageModeChange?.(originalLanguageRef.current)
      onUiTypographyChange?.(originalTypographyRef.current)
    }
    onClose()
  }

  const handleOpenWordTemplatesDir = async () => {
    try {
      setError(null)
      await invoke('open_word_templates_dir')
      const items = await invoke<WordTemplateOption[]>('list_word_templates')
      setWordTemplates(items)
    } catch (err) {
      setError((err as Error).message || 'Failed to open word_templates directory')
    }
  }

  const currentBackground = getBackgroundSettings(currentBackgroundTarget)
  const isInkscapeEnhancedExportEnabled = wordExport.enableInkscapeForWordExport
  const effectiveInkscapeFallback =
    wordExport.mermaidExportFormat === 'png' ? 'png' : 'ask'
  const currentBackgroundOpacityInput =
    currentBackgroundTarget === 'workspaceBackground'
      ? workspaceBackgroundOpacityInput
      : currentBackgroundTarget === 'editorBackground'
      ? editorBackgroundOpacityInput
      : currentBackgroundTarget === 'previewBackground'
        ? previewBackgroundOpacityInput
        : currentBackgroundTarget === 'aiChatBackground'
          ? aiChatBackgroundOpacityInput
          : sidebarBackgroundOpacityInput
  const currentBackgroundOverlayOpacityInput =
    currentBackgroundTarget === 'workspaceBackground'
      ? workspaceBackgroundOverlayOpacityInput
      : currentBackgroundTarget === 'editorBackground'
      ? editorBackgroundOverlayOpacityInput
      : currentBackgroundTarget === 'previewBackground'
        ? previewBackgroundOverlayOpacityInput
        : currentBackgroundTarget === 'aiChatBackground'
          ? aiChatBackgroundOverlayOpacityInput
          : sidebarBackgroundOverlayOpacityInput
  const currentBackgroundBlurInput =
    currentBackgroundTarget === 'workspaceBackground'
      ? workspaceBackgroundBlurInput
      : currentBackgroundTarget === 'editorBackground'
      ? editorBackgroundBlurInput
      : currentBackgroundTarget === 'previewBackground'
        ? previewBackgroundBlurInput
        : currentBackgroundTarget === 'aiChatBackground'
          ? aiChatBackgroundBlurInput
          : sidebarBackgroundBlurInput
  const currentBackgroundBrightnessInput =
    currentBackgroundTarget === 'workspaceBackground'
      ? workspaceBackgroundBrightnessInput
      : currentBackgroundTarget === 'editorBackground'
      ? editorBackgroundBrightnessInput
      : currentBackgroundTarget === 'previewBackground'
        ? previewBackgroundBrightnessInput
        : currentBackgroundTarget === 'aiChatBackground'
          ? aiChatBackgroundBrightnessInput
          : sidebarBackgroundBrightnessInput
  const selectedImageName = currentBackground.path
    ? currentBackground.path.startsWith('builtin:')
      ? getBuiltinBackgroundPresetLabel(currentBackground.path.slice('builtin:'.length)) ?? currentBackground.path
      : currentBackground.path.split(/[\\/]/).pop()
    : t('theme.image')
  const currentBackgroundPreviewUrl = resolveManagedBackgroundImageUrl(currentBackground.path)
  const clampDialogOffset = (nextX: number, nextY: number) => {
    const modal = modalRef.current
    if (!modal || typeof window === 'undefined') return { x: nextX, y: nextY }

    const rect = modal.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const margin = 24

    const maxX = Math.max((viewportWidth - margin * 2 - rect.width) / 2, 0)
    const maxY = Math.max((viewportHeight - margin * 2 - rect.height) / 2, 0)

    return {
      x: Math.min(Math.max(nextX, -maxX), maxX),
      y: Math.min(Math.max(nextY, -maxY), maxY),
    }
  }

  const handleDialogPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    dialogDragRef.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: dragOffset.x,
      originY: dragOffset.y,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleDialogPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dialogDragRef.current.active) return
    const deltaX = event.clientX - dialogDragRef.current.startX
    const deltaY = event.clientY - dialogDragRef.current.startY
    setDragOffset(clampDialogOffset(
      dialogDragRef.current.originX + deltaX,
      dialogDragRef.current.originY + deltaY,
    ))
  }

  const handleDialogPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dialogDragRef.current.pointerId != null && event.currentTarget.hasPointerCapture(dialogDragRef.current.pointerId)) {
      event.currentTarget.releasePointerCapture(dialogDragRef.current.pointerId)
    }
    dialogDragRef.current.active = false
    dialogDragRef.current.pointerId = null
  }

  return (
    <div className="modal-backdrop modal-backdrop-settings-plain">
      <div
        ref={modalRef}
        className="modal modal-settings"
        style={{ transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="modal-title settings-dialog-drag-handle"
          onPointerDown={handleDialogPointerDown}
          onPointerMove={handleDialogPointerMove}
          onPointerUp={handleDialogPointerEnd}
          onPointerCancel={handleDialogPointerEnd}
        >
          {t('settings.title')}
        </div>
        <div className="modal-content" style={{ paddingTop: 8 }}>
          <div className="settings-layout">
            <div className="settings-sidebar">
              <div className="settings-sidebar-title">
                {t('settings.categories')}
              </div>
              <button
                type="button"
                onClick={() => setActiveSection('theme')}
                className={`settings-sidebar-item ${activeSection === 'theme' ? 'active' : ''}`}
              >
                {t('settings.theme')}
              </button>
              <button
                type="button"
                onClick={() => setActiveSection('typography')}
                className={`settings-sidebar-item ${activeSection === 'typography' ? 'active' : ''}`}
              >
                {t('settings.typography')}
              </button>
              <button
                type="button"
                onClick={() => setActiveSection('word-export')}
                className={`settings-sidebar-item ${activeSection === 'word-export' ? 'active' : ''}`}
              >
                {t('settings.wordExport')}
              </button>
              <button
                type="button"
                onClick={() => setActiveSection('backup')}
                className={`settings-sidebar-item ${activeSection === 'backup' ? 'active' : ''}`}
              >
                {t('settings.backup')}
              </button>
            </div>

            <div className="settings-panel">
              {activeSection === 'theme' && (
                <>
                  <div className="settings-panel-header">
                    <div className="settings-panel-header-top">
                      <div className="settings-panel-tabs" role="tablist" aria-label={t('settings.themeSections')}>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={activeThemeTab === 'theme-preset'}
                          className={`settings-panel-tab ${activeThemeTab === 'theme-preset' ? 'active' : ''}`}
                          onClick={() => setActiveThemeTab('theme-preset')}
                        >
                          {t('settings.theme')}
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={activeThemeTab === 'backgrounds'}
                          className={`settings-panel-tab ${activeThemeTab === 'backgrounds' ? 'active' : ''}`}
                          onClick={() => setActiveThemeTab('backgrounds')}
                        >
                          {t('theme.backgrounds')}
                        </button>
                      </div>
                    </div>
                    {activeThemeTab === 'theme-preset' ? (
                      <div className="settings-panel-description">
                        {t('settings.appearanceDescription')}
                      </div>
                    ) : null}
                  </div>

                  {activeThemeTab === 'theme-preset' ? (
                    <div className="theme-option-group">
                      <div style={{ ...fieldGridStyle, marginBottom: 2 }}>
                        <div className="settings-field-label">{t('settings.language')}</div>
                        <select
                          className="field-select"
                          value={languageMode}
                          onChange={(event) => setLanguageMode(event.target.value as LanguageMode)}
                        >
                          <option value="system">{t('settings.system')}</option>
                          <option value="zh-CN">{t('settings.simplifiedChinese')}</option>
                          <option value="en-US">{t('settings.english')}</option>
                        </select>
                      </div>
                      <div className="settings-panel-description" style={{ marginBottom: 8 }}>
                        {t('settings.languageDescription')}
                      </div>
                      {([
                        {
                          mode: 'system',
                          title: t('theme.presets.system.title'),
                          description: t('theme.presets.system.description'),
                        },
                        {
                          mode: 'light',
                          title: t('theme.presets.light.title'),
                          description: t('theme.presets.light.description'),
                        },
                        {
                          mode: 'romantic',
                          title: t('theme.presets.romantic.title'),
                          description: t('theme.presets.romantic.description'),
                        },
                        {
                          mode: 'paper',
                          title: t('theme.presets.paper.title'),
                          description: t('theme.presets.paper.description'),
                        },
                        {
                          mode: 'high-contrast',
                          title: t('theme.presets.highContrast.title'),
                          description: t('theme.presets.highContrast.description'),
                        },
                        {
                          mode: 'dark',
                          title: t('theme.presets.dark.title'),
                          description: t('theme.presets.dark.description'),
                        },
                        {
                          mode: 'electric-mint',
                          title: t('theme.presets.electricMint.title'),
                          description: t('theme.presets.electricMint.description'),
                        },
                        {
                          mode: 'neon-pop',
                          title: t('theme.presets.neonPop.title'),
                          description: t('theme.presets.neonPop.description'),
                        },
                        {
                          mode: 'velvet-rose',
                          title: t('theme.presets.velvetRose.title'),
                          description: t('theme.presets.velvetRose.description'),
                        },
                        {
                          mode: 'focus',
                          title: t('theme.presets.focus.title'),
                          description: t('theme.presets.focus.description'),
                        },
                        {
                          mode: 'ai-console',
                          title: t('theme.presets.aiConsole.title'),
                          description: t('theme.presets.aiConsole.description'),
                        },
                      ] as const).map((option) => (
                        <button
                          key={option.mode}
                          type="button"
                          className={`theme-option-card ${theme.mode === option.mode ? 'active' : ''}`}
                          onClick={() => updateThemeMode(option.mode)}
                          aria-pressed={theme.mode === option.mode}
                        >
                          <span className="theme-option-card-title">{option.title}</span>
                          <span className="theme-option-card-description">{option.description}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="settings-subsection settings-subsection-standalone">
                      <div style={{ marginBottom: 14 }}>
                        <div className="settings-panel-tabs settings-panel-tabs-full" role="tablist" aria-label={t('theme.backgroundTargets')}>
                          <button
                            type="button"
                            role="tab"
                            aria-selected={currentBackgroundTarget === 'workspaceBackground'}
                            className={`settings-panel-tab ${currentBackgroundTarget === 'workspaceBackground' ? 'active' : ''}`}
                            onClick={() => setCurrentBackgroundTarget('workspaceBackground')}
                          >
                            {t('theme.workspaceBackgroundShort')}
                          </button>
                          <button
                            type="button"
                            role="tab"
                            aria-selected={currentBackgroundTarget === 'editorBackground'}
                            className={`settings-panel-tab ${currentBackgroundTarget === 'editorBackground' ? 'active' : ''}`}
                            onClick={() => setCurrentBackgroundTarget('editorBackground')}
                          >
                            {t('theme.editorBackgroundShort')}
                          </button>
                          <button
                            type="button"
                            role="tab"
                            aria-selected={currentBackgroundTarget === 'previewBackground'}
                            className={`settings-panel-tab ${currentBackgroundTarget === 'previewBackground' ? 'active' : ''}`}
                            onClick={() => setCurrentBackgroundTarget('previewBackground')}
                          >
                            {t('theme.previewBackgroundShort')}
                          </button>
                          <button
                            type="button"
                            role="tab"
                            aria-selected={currentBackgroundTarget === 'aiChatBackground'}
                            className={`settings-panel-tab ${currentBackgroundTarget === 'aiChatBackground' ? 'active' : ''}`}
                            onClick={() => setCurrentBackgroundTarget('aiChatBackground')}
                          >
                            {t('theme.aiChatBackgroundShort')}
                          </button>
                          <button
                            type="button"
                            role="tab"
                            aria-selected={currentBackgroundTarget === 'sidebarBackground'}
                            className={`settings-panel-tab ${currentBackgroundTarget === 'sidebarBackground' ? 'active' : ''}`}
                            onClick={() => setCurrentBackgroundTarget('sidebarBackground')}
                          >
                            {t('theme.sidebarBackgroundShort')}
                          </button>
                        </div>
                      </div>
                      <div className="settings-checkbox-row">
                        <label className="settings-checkbox-label">
                          <input
                            type="checkbox"
                            checked={currentBackground.enabled}
                            onChange={(event) => updateThemeBackground(currentBackgroundTarget, { enabled: event.target.checked })}
                          />
                          <span>
                            {currentBackgroundTarget === 'workspaceBackground'
                              ? t('theme.enableWorkspaceBackgroundImage')
                              : currentBackgroundTarget === 'aiChatBackground'
                              ? t('theme.enableAiChatBackgroundImage')
                              : currentBackgroundTarget === 'sidebarBackground'
                                ? t('theme.enableSidebarBackgroundImage')
                              : currentBackgroundTarget === 'previewBackground'
                                ? t('theme.enablePreviewBackgroundImage')
                              : t('theme.enableEditorBackgroundImage')}
                          </span>
                        </label>
                      </div>
                      {currentBackgroundTarget === 'workspaceBackground' ? (
                        <div className="settings-checkbox-row">
                          <label className="settings-checkbox-label">
                            <input
                              type="checkbox"
                              checked={theme.workspaceBackgroundIncludeSidebar ?? false}
                              onChange={(event) => {
                                hasLocalPreviewEditsRef.current = true
                                setTheme((prev) => ({
                                  ...prev,
                                  workspaceBackgroundIncludeSidebar: event.target.checked,
                                }))
                              }}
                            />
                            <span>{t('theme.includeSidebar')}</span>
                          </label>
                        </div>
                      ) : null}

                      <div style={{ display: 'grid', gap: 14 }}>
                        <div style={fieldGridStyle}>
                          <div className="settings-field-label">{t('theme.image')}</div>
                          <div className="settings-inline-actions">
                            <div className="settings-inline-meta">{selectedImageName}</div>
                            <div className="settings-inline-buttons">
                              <Button variant="secondary" type="button" onClick={() => void handleSelectBackgroundImage(currentBackgroundTarget)}>
                                {t('common.chooseImage')}
                              </Button>
                              <Button variant="tertiary" type="button" onClick={() => clearBackgroundImage(currentBackgroundTarget)} disabled={!currentBackground.path}>
                                {t('common.clear')}
                              </Button>
                            </div>
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                                gap: 10,
                                width: '100%',
                                marginTop: 10,
                              }}
                            >
                              {builtinBackgroundPresets.map((preset) => {
                                const isSelected = currentBackground.path === `builtin:${preset.id}`
                                return (
                                  <button
                                    key={preset.id}
                                    type="button"
                                    onClick={() => selectBuiltinBackgroundImage(currentBackgroundTarget, preset.id)}
                                    style={{
                                      position: 'relative',
                                      borderRadius: 10,
                                      border: isSelected
                                        ? '2px solid var(--theme-accent, #58a6ff)'
                                        : '1px solid var(--theme-border-subtle, rgba(255,255,255,0.14))',
                                      padding: 0,
                                      overflow: 'hidden',
                                      background: 'var(--theme-surface-card, rgba(255,255,255,0.04))',
                                      cursor: 'pointer',
                                      textAlign: 'left',
                                    }}
                                  >
                                    <img
                                      src={preset.url}
                                      alt={preset.label}
                                      style={{ display: 'block', width: '100%', aspectRatio: '16 / 10', objectFit: 'cover' }}
                                    />
                                    <div
                                      style={{
                                        padding: '8px 10px',
                                        fontSize: 12,
                                        color: 'var(--theme-text-default)',
                                        background: 'var(--theme-surface-panel, rgba(0,0,0,0.16))',
                                      }}
                                    >
                                      {preset.label}
                                    </div>
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        </div>

                        <div style={fieldGridStyle}>
                          <div className="settings-field-label">{t('theme.imageOpacity')}</div>
                          <input
                            className="field-input settings-number-input"
                            type="number"
                            min={0.02}
                            max={0.4}
                            step={0.01}
                            value={currentBackgroundOpacityInput}
                            onChange={(event) => setBackgroundNumberInput(currentBackgroundTarget, 'opacity', event.target.value)}
                            onBlur={(event) => commitBackgroundNumber(currentBackgroundTarget, 'opacity', event.target.value)}
                          />
                        </div>

                        <div style={fieldGridStyle}>
                          <div className="settings-field-label">{t('theme.blurPx')}</div>
                          <input
                            className="field-input settings-number-input"
                            type="number"
                            min={0}
                            max={24}
                            step={1}
                            value={currentBackgroundBlurInput}
                            onChange={(event) => setBackgroundNumberInput(currentBackgroundTarget, 'blurPx', event.target.value)}
                            onBlur={(event) => commitBackgroundNumber(currentBackgroundTarget, 'blurPx', event.target.value)}
                          />
                        </div>

                        <div style={fieldGridStyle}>
                          <div className="settings-field-label">{t('theme.overlayOpacity')}</div>
                          <input
                            className="field-input settings-number-input"
                            type="number"
                            min={0}
                            max={1}
                            step={0.01}
                            value={currentBackgroundOverlayOpacityInput}
                            onChange={(event) => setBackgroundNumberInput(currentBackgroundTarget, 'overlayOpacity', event.target.value)}
                            onBlur={(event) => commitBackgroundNumber(currentBackgroundTarget, 'overlayOpacity', event.target.value)}
                          />
                        </div>

                        <div style={fieldGridStyle}>
                          <div className="settings-field-label">{t('theme.brightnessPercent')}</div>
                          <input
                            className="field-input settings-number-input"
                            type="number"
                            min={0}
                            max={200}
                            step={1}
                            value={currentBackgroundBrightnessInput}
                            onChange={(event) => setBackgroundNumberInput(currentBackgroundTarget, 'brightness', event.target.value)}
                            onBlur={(event) => commitBackgroundNumber(currentBackgroundTarget, 'brightness', event.target.value)}
                          />
                        </div>

                        <div style={fieldGridStyle}>
                          <div className="settings-field-label">{t('theme.imageFit')}</div>
                          <select
                            className="field-select"
                          value={currentBackground.size}
                          onChange={updateBackgroundSize(currentBackgroundTarget)}
                        >
                          <option value="cover">{t('theme.cover')}</option>
                          <option value="height-fill">{t('theme.heightFill')}</option>
                          <option value="width-fill">{t('theme.widthFill')}</option>
                          <option value="contain">{t('theme.contain')}</option>
                          <option value="auto">{t('theme.original')}</option>
                        </select>
                        </div>

                        <div style={fieldGridStyle}>
                          <div className="settings-field-label">{t('theme.imagePosition')}</div>
                          <div style={{ display: 'grid', gap: 10 }}>
                            <div
                              className={`settings-image-position-picker ${currentBackground.path ? '' : 'disabled'}`}
                              onPointerDown={(event) => {
                                if (!currentBackground.path) return
                                previewDragRef.current = true
                                event.currentTarget.setPointerCapture(event.pointerId)
                                updateEditorBackgroundPositionFromPointer(currentBackgroundTarget, event)
                              }}
                              onPointerMove={(event) => {
                                if (!previewDragRef.current || !currentBackground.path) return
                                updateEditorBackgroundPositionFromPointer(currentBackgroundTarget, event)
                              }}
                              onPointerUp={(event) => {
                                previewDragRef.current = false
                                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                                  event.currentTarget.releasePointerCapture(event.pointerId)
                                }
                              }}
                              onPointerCancel={() => {
                                previewDragRef.current = false
                              }}
                            >
                              {currentBackground.path ? (
                                <img
                                  className={`settings-image-position-preview fit-${currentBackground.size}`}
                                  src={currentBackgroundPreviewUrl ?? ''}
                                  alt=""
                                  aria-hidden="true"
                                  style={{
                                    objectPosition: `${currentBackground.positionX}% ${currentBackground.positionY}%`,
                                    opacity: Math.min(Math.max(currentBackground.opacity, 0), 0.4),
                                    filter: `blur(${Math.min(Math.max(currentBackground.blurPx, 0), 24)}px) brightness(${Math.min(Math.max(currentBackground.brightness, 0), 200)}%)`,
                                    ['--settings-image-position-x' as string]: `${currentBackground.positionX}%`,
                                    ['--settings-image-position-y' as string]: `${currentBackground.positionY}%`,
                                  }}
                                />
                              ) : (
                                <div className="settings-image-position-empty">{t('theme.chooseImageToDrag')}</div>
                              )}
                              <div
                                className="settings-image-position-preview-overlay"
                                aria-hidden="true"
                                style={{
                                  opacity: Math.min(Math.max(currentBackground.overlayOpacity ?? 0, 0), 1),
                                }}
                              />
                              <div
                                className="settings-image-position-crosshair"
                                style={{
                                  left: `${currentBackground.positionX}%`,
                                  top: `${currentBackground.positionY}%`,
                                }}
                              />
                            </div>
                            <div className="settings-inline-meta">
                              {t('theme.positionLabel', {
                                x: Math.round(currentBackground.positionX),
                                y: Math.round(currentBackground.positionY),
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {activeSection === 'typography' && (
                <>
                  <div className="settings-panel-header">
                    <div className="settings-panel-title">{t('typography.title')}</div>
                    <div className="settings-panel-description">
                      {t('typography.description')}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gap: 18 }}>
                    <div className="settings-subgroup">
                      <div className="settings-subgroup-title">{t('typography.groups.global')}</div>
                      <div style={{ display: 'grid', gap: 14 }}>
                        <div style={fieldGridStyle}>
                          <div className="settings-field-label">{t('typography.appFontSize')}</div>
                          <input className="field-input settings-number-input" type="number" min={10} max={24} step={1} value={uiTypography.appFontSize} onChange={updateTypographyNumber('appFontSize')} />
                        </div>
                        <div style={fieldGridStyle}>
                          <div className="settings-field-label">{t('typography.settingsFontSize')}</div>
                          <input className="field-input settings-number-input" type="number" min={10} max={24} step={1} value={uiTypography.settingsFontSize} onChange={updateTypographyNumber('settingsFontSize')} />
                        </div>
                        <div style={fieldGridStyle}>
                          <div className="settings-field-label">{t('typography.tabBarFontSize')}</div>
                          <input className="field-input settings-number-input" type="number" min={10} max={24} step={1} value={uiTypography.tabBarFontSize} onChange={updateTypographyNumber('tabBarFontSize')} />
                        </div>
                        <div style={fieldGridStyle}>
                          <div className="settings-field-label">{t('typography.statusBarFontSize')}</div>
                          <input className="field-input settings-number-input" type="number" min={10} max={24} step={1} value={uiTypography.statusBarFontSize} onChange={updateTypographyNumber('statusBarFontSize')} />
                        </div>
                      </div>
                    </div>

                    <div className="settings-subgroup">
                      <div className="settings-subgroup-title">{t('typography.groups.workspace')}</div>
                      <div style={{ display: 'grid', gap: 14 }}>
                        <div style={fieldGridStyle}>
                          <div className="settings-field-label">{t('typography.sidebarFontSize')}</div>
                          <input className="field-input settings-number-input" type="number" min={10} max={24} step={1} value={uiTypography.sidebarFontSize} onChange={updateTypographyNumber('sidebarFontSize')} />
                        </div>
                        <div style={fieldGridStyle}>
                          <div className="settings-field-label">{t('typography.editorFontSize')}</div>
                          <input className="field-input settings-number-input" type="number" min={10} max={24} step={1} value={uiTypography.editorFontSize} onChange={updateTypographyNumber('editorFontSize')} />
                        </div>
                        <div style={fieldGridStyle}>
                          <div className="settings-field-label">{t('typography.previewFontSize')}</div>
                          <input className="field-input settings-number-input" type="number" min={10} max={24} step={1} value={uiTypography.previewFontSize} onChange={updateTypographyNumber('previewFontSize')} />
                        </div>
                        <div style={fieldGridStyle}>
                          <div className="settings-field-label">{t('typography.wysiwygFontSize')}</div>
                          <input className="field-input settings-number-input" type="number" min={10} max={24} step={1} value={uiTypography.wysiwygFontSize} onChange={updateTypographyNumber('wysiwygFontSize')} />
                        </div>
                      </div>
                    </div>

                    <div className="settings-subgroup">
                      <div className="settings-subgroup-title">{t('typography.groups.ai')}</div>
                      <div style={{ display: 'grid', gap: 14 }}>
                        <div style={fieldGridStyle}>
                          <div className="settings-field-label">{t('typography.aiChatMessageFontSize')}</div>
                          <input className="field-input settings-number-input" type="number" min={10} max={24} step={1} value={uiTypography.aiChatMessageFontSize} onChange={updateTypographyNumber('aiChatMessageFontSize')} />
                        </div>
                        <div style={fieldGridStyle}>
                          <div className="settings-field-label">{t('typography.aiChatInputFontSize')}</div>
                          <input className="field-input settings-number-input" type="number" min={10} max={24} step={1} value={uiTypography.aiChatInputFontSize} onChange={updateTypographyNumber('aiChatInputFontSize')} />
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {activeSection === 'word-export' && (
                <>
                  <div className="settings-panel-header">
                    <div className="settings-panel-header-top">
                      <div className="settings-panel-title">{t('wordExport.title')}</div>
                      <div className="settings-panel-tabs" role="tablist" aria-label={t('wordExport.sections')}>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={activeWordExportTab === 'document'}
                          className={`settings-panel-tab ${activeWordExportTab === 'document' ? 'active' : ''}`}
                          onClick={() => setActiveWordExportTab('document')}
                        >
                          {t('wordExport.tabs.document')}
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={activeWordExportTab === 'layout'}
                          className={`settings-panel-tab ${activeWordExportTab === 'layout' ? 'active' : ''}`}
                          onClick={() => setActiveWordExportTab('layout')}
                        >
                          {t('wordExport.tabs.layout')}
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={activeWordExportTab === 'diagrams'}
                          className={`settings-panel-tab ${activeWordExportTab === 'diagrams' ? 'active' : ''}`}
                          onClick={() => setActiveWordExportTab('diagrams')}
                        >
                          {t('wordExport.tabs.diagrams')}
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={activeWordExportTab === 'templates'}
                          className={`settings-panel-tab ${activeWordExportTab === 'templates' ? 'active' : ''}`}
                          onClick={() => setActiveWordExportTab('templates')}
                        >
                          {t('wordExport.tabs.templates')}
                        </button>
                      </div>
                    </div>
                    <div className="settings-panel-description">
                      {activeWordExportTab === 'document'
                        ? t('wordExport.documentDescription')
                        : activeWordExportTab === 'layout'
                          ? t('wordExport.layoutDescription')
                          : activeWordExportTab === 'diagrams'
                            ? t('wordExport.diagramsDescription')
                            : t('wordExport.templatesDescription')}
                    </div>
                  </div>

                  {activeWordExportTab === 'document' ? (
                    <div className="settings-subgroup">
                      <div className="settings-subgroup-title">{t('wordExport.groups.document')}</div>
                      <div style={{ display: 'grid', gap: 14 }}>
                        <div style={fieldGridStyle}>
                          <div className="settings-field-label">{t('wordExport.bodyFont')}</div>
                          <FontSelectField value={wordExport.bodyFontFamily} onChange={updateFontFamily('bodyFontFamily')} />
                        </div>
                        <div style={fieldGridStyle}>
                          <div className="settings-field-label">{t('wordExport.bodySizePt')}</div>
                          <input className="field-input settings-number-input" type="number" min={8} max={48} step={0.5} value={wordExport.bodyFontSizePt} onChange={updateNumber('bodyFontSizePt')} />
                        </div>
                        <div style={fieldGridStyle}>
                          <div className="settings-field-label">{t('wordExport.headingFont')}</div>
                          <FontSelectField value={wordExport.headingFontFamily} onChange={updateFontFamily('headingFontFamily')} />
                        </div>
                        <div style={fieldGridStyle}>
                          <div className="settings-field-label">{t('wordExport.heading1SizePt')}</div>
                          <input className="field-input settings-number-input" type="number" min={10} max={48} step={0.5} value={wordExport.heading1SizePt} onChange={updateNumber('heading1SizePt')} />
                        </div>
                        <div style={fieldGridStyle}>
                          <div className="settings-field-label">{t('wordExport.heading2SizePt')}</div>
                          <input className="field-input settings-number-input" type="number" min={10} max={48} step={0.5} value={wordExport.heading2SizePt} onChange={updateNumber('heading2SizePt')} />
                        </div>
                        <div style={fieldGridStyle}>
                          <div className="settings-field-label">{t('wordExport.heading3SizePt')}</div>
                          <input className="field-input settings-number-input" type="number" min={10} max={48} step={0.5} value={wordExport.heading3SizePt} onChange={updateNumber('heading3SizePt')} />
                        </div>
                        <div style={fieldGridStyle}>
                          <div className="settings-field-label">{t('wordExport.codeSizePt')}</div>
                          <input className="field-input settings-number-input" type="number" min={8} max={32} step={0.5} value={wordExport.codeFontSizePt} onChange={updateNumber('codeFontSizePt')} />
                        </div>
                      </div>
                    </div>
                  ) : activeWordExportTab === 'layout' ? (
                    <div className="settings-subgroup">
                      <div className="settings-subgroup-title">{t('wordExport.groups.layout')}</div>
                      <div style={{ display: 'grid', gap: 14 }}>
                        <div style={fieldGridStyle}>
                          <div className="settings-field-label">{t('wordExport.paragraphSpacingAfterPt')}</div>
                          <input className="field-input settings-number-input" type="number" min={0} max={72} step={0.5} value={wordExport.paragraphSpacingAfterPt} onChange={updateNumber('paragraphSpacingAfterPt')} />
                        </div>
                        <div style={fieldGridStyle}>
                          <div className="settings-field-label">{t('wordExport.lineSpacing')}</div>
                          <input className="field-input settings-number-input" type="number" min={1} max={3} step={0.05} value={wordExport.lineSpacing} onChange={updateNumber('lineSpacing')} />
                        </div>
                        <div style={fieldGridStyle}>
                          <div className="settings-field-label">{t('wordExport.pageMarginCm')}</div>
                          <input className="field-input settings-number-input" type="number" min={1} max={5} step={0.1} value={wordExport.pageMarginCm} onChange={updateNumber('pageMarginCm')} />
                        </div>
                      </div>
                    </div>
                  ) : activeWordExportTab === 'diagrams' ? (
                    <div className="settings-subgroup">
                      <div className="settings-subgroup-title">{t('wordExport.groups.diagrams')}</div>
                      <div style={{ display: 'grid', gap: 14 }}>
                        <div style={fieldGridStyle}>
                          <div className="settings-field-label">{t('wordExport.enableInkscapeForWordExport')}</div>
                          <label className="settings-checkbox-label">
                            <input
                              type="checkbox"
                              checked={wordExport.enableInkscapeForWordExport}
                              onChange={(event) =>
                                setWordExport((prev) => ({
                                  ...prev,
                                  enableInkscapeForWordExport: event.target.checked,
                                }))}
                            />
                            <span>{t('wordExport.enableInkscapeForWordExportHint')}</span>
                          </label>
                        </div>
                        <div style={fieldGridStyle}>
                          <div className="settings-field-label">{t('wordExport.mermaidExportFormat')}</div>
                          <select
                            className="field-select"
                            value={wordExport.mermaidExportFormat}
                            disabled={!isInkscapeEnhancedExportEnabled}
                            onChange={(event) =>
                              setWordExport((prev) => {
                                const mermaidExportFormat = event.target.value as WordExportStyleSettings['mermaidExportFormat']
                                return {
                                  ...prev,
                                  mermaidExportFormat,
                                  inkscapeFallback: mermaidExportFormat === 'png' ? 'png' : 'ask',
                                }
                              })}
                          >
                            <option value="png">{t('wordExport.exportFormats.png')}</option>
                            <option value="svg">{t('wordExport.exportFormats.svg')}</option>
                            <option value="emf">{t('wordExport.exportFormats.emf')}</option>
                          </select>
                        </div>
                        <div style={fieldGridStyle}>
                          <div className="settings-field-label">{t('wordExport.inkscapeFallback')}</div>
                          <select
                            className="field-select"
                            value={effectiveInkscapeFallback}
                            disabled
                            onChange={undefined}
                          >
                            <option value="ask">{t('wordExport.fallbackModes.ask')}</option>
                            <option value="png">{t('wordExport.fallbackModes.png')}</option>
                            <option value="cancel">{t('wordExport.fallbackModes.cancel')}</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="settings-subgroup">
                      <div className="settings-subgroup-title">{t('wordExport.groups.templates')}</div>
                      <div style={{ display: 'grid', gap: 14 }}>
                        <div style={fieldGridStyle}>
                          <div className="settings-field-label">{t('wordExport.wordTemplatesFolder')}</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                            <Button variant="tertiary" type="button" onClick={handleOpenWordTemplatesDir}>
                              {t('wordExport.openWordTemplatesFolder')}
                            </Button>
                            <span className="settings-inline-help">{t('wordExport.wordTemplatesFolderHint')}</span>
                          </div>
                        </div>
                        {wordTemplates.length > 0 ? (
                          <div style={fieldGridStyle}>
                            <div className="settings-field-label">{t('wordExport.availableTemplates')}</div>
                            <div className="settings-inline-help">
                              {wordTemplates.map((template) => template.name).join(' / ')}
                            </div>
                          </div>
                        ) : (
                          <div style={fieldGridStyle}>
                            <div className="settings-field-label">{t('wordExport.availableTemplates')}</div>
                            <div className="settings-inline-help">{t('wordExport.noTemplatesFound')}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}

              {activeSection === 'backup' && (
                <>
                  <div className="settings-panel-header">
                    <div className="settings-panel-header-top">
                      <div className="settings-panel-title">{t('backup.title')}</div>
                    </div>
                    <div className="settings-panel-description">{t('backup.description')}</div>
                  </div>

                  <div className="settings-subgroup">
                    <div className="settings-subgroup-title">{t('backup.groups.sync')}</div>
                    <div style={{ display: 'grid', gap: 14 }}>
                      <div style={fieldGridStyle}>
                        <div className="settings-field-label">{t('backup.exportLabel')}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                          <Button
                            variant="tertiary"
                            type="button"
                            onClick={() => void handleExportBackup()}
                            disabled={backupBusy !== null}
                            loading={backupBusy === 'export'}
                          >
                            {t('backup.exportAction')}
                          </Button>
                        </div>
                      </div>

                      <div style={fieldGridStyle}>
                        <div className="settings-field-label">{t('backup.importLabel')}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                          <Button
                            variant="tertiary"
                            type="button"
                            onClick={() => void handleImportBackup()}
                            disabled={backupBusy !== null}
                            loading={backupBusy === 'import'}
                          >
                            {t('backup.importAction')}
                          </Button>
                        </div>
                      </div>

                    </div>
                  </div>

                  <div className="settings-subsection">
                    <div className="settings-subgroup">
                      <div className="settings-subgroup-title">{t('backup.groups.webdav')}</div>
                      <div style={{ display: 'grid', gap: 14 }}>
                      <div style={fieldGridStyle}>
                        <div className="settings-field-label">{t('backup.webdavEnabled')}</div>
                        <label className="settings-checkbox-label">
                          <input
                            type="checkbox"
                            checked={webdavBackup.enabled}
                            onChange={(event) =>
                              setWebdavBackup((prev) => ({ ...prev, enabled: event.target.checked }))}
                          />
                        </label>
                      </div>
                      <div style={fieldGridStyle}>
                        <div className="settings-field-label">{t('backup.webdavUrl')}</div>
                        <input
                          ref={webdavUrlInputRef}
                          className="field-input"
                          value={webdavBackup.url}
                          onChange={(event) =>
                            setWebdavBackup((prev) => ({ ...prev, url: event.target.value }))}
                          placeholder="https://example.com/dav"
                        />
                      </div>
                      <div style={fieldGridStyle}>
                        <div className="settings-field-label">{t('backup.webdavUsername')}</div>
                        <input
                          ref={webdavUsernameInputRef}
                          className="field-input"
                          value={webdavBackup.username}
                          onChange={(event) =>
                            setWebdavBackup((prev) => ({ ...prev, username: event.target.value }))}
                        />
                      </div>
                      <div style={fieldGridStyle}>
                        <div className="settings-field-label">{t('backup.webdavPassword')}</div>
                        <input
                          ref={webdavPasswordInputRef}
                          className="field-input"
                          type="password"
                          value={webdavBackup.password}
                          onChange={(event) =>
                            setWebdavBackup((prev) => ({ ...prev, password: event.target.value }))}
                        />
                      </div>
                      <div style={fieldGridStyle}>
                        <div className="settings-field-label">{t('backup.webdavTestLabel')}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                          <Button
                            variant="tertiary"
                            type="button"
                            onClick={() => void handleTestWebDavConnection()}
                            disabled={backupBusy !== null}
                            loading={backupBusy === 'webdav-test'}
                          >
                            {t('backup.webdavTestAction')}
                          </Button>
                        </div>
                      </div>
                      <div style={fieldGridStyle}>
                        <div className="settings-field-label">{t('backup.webdavExportLabel')}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                          <Button
                            variant="tertiary"
                            type="button"
                            onClick={() => void handleExportBackupToWebDav()}
                            disabled={backupBusy !== null}
                            loading={backupBusy === 'webdav-export'}
                          >
                            {t('backup.webdavExportAction')}
                          </Button>
                        </div>
                      </div>
                      <div style={fieldGridStyle}>
                        <div className="settings-field-label">{t('backup.webdavImportLabel')}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                          <Button
                            variant="tertiary"
                            type="button"
                            onClick={() => void handleImportBackupFromWebDav()}
                            disabled={backupBusy !== null}
                            loading={backupBusy === 'webdav-import'}
                          >
                            {t('backup.webdavImportAction')}
                          </Button>
                        </div>
                      </div>
                      {backupStatus ? (
                        <div style={fieldGridStyle}>
                          <div className="settings-field-label">{t('backup.statusLabel')}</div>
                          <div
                            className={`settings-status-message settings-status-${backupStatus.tone}`}
                          >
                            {backupStatus.message}
                          </div>
                        </div>
                      ) : null}
                      </div>
                    </div>
                  </div>
                </>
              )}

              {error && (
                <div className="form-error" style={{ marginTop: 14 }}>
                  {error}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="modal-actions">
          {activeSection === 'word-export' || activeSection === 'typography' || (activeSection === 'theme' && activeThemeTab !== 'theme-preset') ? (
            <Button variant="tertiary" type="button" onClick={handleReset} disabled={isSaving}>
              {t('common.reset')}
            </Button>
          ) : null}
          <Button variant="secondary" type="button" onClick={handleCloseWithoutSave} disabled={isSaving}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" type="button" onClick={handleSave} disabled={isSaving} loading={isSaving}>
            {isSaving ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </div>
    </div>
  )
}
