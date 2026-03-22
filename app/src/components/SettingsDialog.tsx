import { type ChangeEvent, type FC, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { invoke } from '@tauri-apps/api/core'
import './SettingsDialog.css'
import { Button } from './Button'
import { FontSelectField } from './settings/FontSelectField'
import { useI18n } from '../modules/i18n/I18nContext'
import type { LanguageMode } from '../modules/i18n/schema'
import {
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
} from '../modules/settings/editorSettings'
import { resolveManagedBackgroundImageUrl } from '../modules/theme/backgroundImageRuntime'
import type { ThemeMode } from '../modules/theme/schema'

export type SettingsDialogProps = {
  open: boolean
  onClose: () => void
  onThemeSettingsChange?: (settings: ThemeSettings) => void
  onLanguageModeChange?: (mode: LanguageMode) => void
  onUiTypographyChange?: (settings: UiTypographySettings) => void
}

type SettingsSectionId = 'theme' | 'typography' | 'word-export'
type ThemePanelTabId = 'theme-preset' | 'editor-background' | 'preview-background' | 'ai-chat-background'
type BackgroundTarget = 'editorBackground' | 'previewBackground' | 'aiChatBackground'

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
  const [uiTypography, setUiTypography] = useState<UiTypographySettings>(getDefaultUiTypographySettings())
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('theme')
  const [activeThemeTab, setActiveThemeTab] = useState<ThemePanelTabId>('theme-preset')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const previewDragRef = useRef(false)
  const modalRef = useRef<HTMLDivElement | null>(null)
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
        setEditorBackgroundOpacityInput(String(loadedTheme.editorBackground?.opacity ?? getDefaultThemeSettings().editorBackground?.opacity ?? 0.3))
        setEditorBackgroundOverlayOpacityInput(String(loadedTheme.editorBackground?.overlayOpacity ?? getDefaultThemeSettings().editorBackground?.overlayOpacity ?? 0))
        setEditorBackgroundBlurInput(String(loadedTheme.editorBackground?.blurPx ?? getDefaultThemeSettings().editorBackground?.blurPx ?? 1))
        setEditorBackgroundBrightnessInput(String(loadedTheme.editorBackground?.brightness ?? getDefaultThemeSettings().editorBackground?.brightness ?? 100))
        setPreviewBackgroundOpacityInput(String(loadedTheme.previewBackground?.opacity ?? getDefaultThemeSettings().previewBackground?.opacity ?? 0.22))
        setPreviewBackgroundOverlayOpacityInput(String(loadedTheme.previewBackground?.overlayOpacity ?? getDefaultThemeSettings().previewBackground?.overlayOpacity ?? 0.12))
        setPreviewBackgroundBlurInput(String(loadedTheme.previewBackground?.blurPx ?? getDefaultThemeSettings().previewBackground?.blurPx ?? 2))
        setPreviewBackgroundBrightnessInput(String(loadedTheme.previewBackground?.brightness ?? getDefaultThemeSettings().previewBackground?.brightness ?? 100))
        setAiChatBackgroundOpacityInput(String(loadedTheme.aiChatBackground?.opacity ?? getDefaultThemeSettings().aiChatBackground?.opacity ?? 0.3))
        setAiChatBackgroundOverlayOpacityInput(String(loadedTheme.aiChatBackground?.overlayOpacity ?? getDefaultThemeSettings().aiChatBackground?.overlayOpacity ?? 0))
        setAiChatBackgroundBlurInput(String(loadedTheme.aiChatBackground?.blurPx ?? getDefaultThemeSettings().aiChatBackground?.blurPx ?? 1))
        setAiChatBackgroundBrightnessInput(String(loadedTheme.aiChatBackground?.brightness ?? getDefaultThemeSettings().aiChatBackground?.brightness ?? 100))
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
    if (!open || !themePreviewReadyRef.current) return
    onLanguageModeChange?.(languageMode)
  }, [open, languageMode, onLanguageModeChange])

  useEffect(() => {
    if (!open || !themePreviewReadyRef.current) return
    onUiTypographyChange?.(uiTypography)
  }, [open, uiTypography, onUiTypographyChange])

  useEffect(() => {
    if (!open || !themePreviewReadyRef.current || !hasLocalPreviewEditsRef.current) return
    onThemeSettingsChange?.({
      ...theme,
      editorBackground: theme.editorBackground ? { ...theme.editorBackground } : undefined,
      previewBackground: theme.previewBackground ? { ...theme.previewBackground } : undefined,
      aiChatBackground: theme.aiChatBackground ? { ...theme.aiChatBackground } : undefined,
    })
  }, [open, theme, onThemeSettingsChange])

  useEffect(() => {
    setEditorBackgroundOpacityInput(String(theme.editorBackground?.opacity ?? getDefaultThemeSettings().editorBackground?.opacity ?? 0.3))
    setEditorBackgroundOverlayOpacityInput(String(theme.editorBackground?.overlayOpacity ?? getDefaultThemeSettings().editorBackground?.overlayOpacity ?? 0))
    setEditorBackgroundBlurInput(String(theme.editorBackground?.blurPx ?? getDefaultThemeSettings().editorBackground?.blurPx ?? 1))
    setEditorBackgroundBrightnessInput(String(theme.editorBackground?.brightness ?? getDefaultThemeSettings().editorBackground?.brightness ?? 100))
    setPreviewBackgroundOpacityInput(String(theme.previewBackground?.opacity ?? getDefaultThemeSettings().previewBackground?.opacity ?? 0.22))
    setPreviewBackgroundOverlayOpacityInput(String(theme.previewBackground?.overlayOpacity ?? getDefaultThemeSettings().previewBackground?.overlayOpacity ?? 0.12))
    setPreviewBackgroundBlurInput(String(theme.previewBackground?.blurPx ?? getDefaultThemeSettings().previewBackground?.blurPx ?? 2))
    setPreviewBackgroundBrightnessInput(String(theme.previewBackground?.brightness ?? getDefaultThemeSettings().previewBackground?.brightness ?? 100))
    setAiChatBackgroundOpacityInput(String(theme.aiChatBackground?.opacity ?? getDefaultThemeSettings().aiChatBackground?.opacity ?? 0.3))
    setAiChatBackgroundOverlayOpacityInput(String(theme.aiChatBackground?.overlayOpacity ?? getDefaultThemeSettings().aiChatBackground?.overlayOpacity ?? 0))
    setAiChatBackgroundBlurInput(String(theme.aiChatBackground?.blurPx ?? getDefaultThemeSettings().aiChatBackground?.blurPx ?? 1))
    setAiChatBackgroundBrightnessInput(String(theme.aiChatBackground?.brightness ?? getDefaultThemeSettings().aiChatBackground?.brightness ?? 100))
  }, [
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
  ])

  if (!open) return null

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
      ...(target === 'editorBackground'
        ? defaults.editorBackground
        : target === 'previewBackground'
          ? defaults.previewBackground
        : defaults.aiChatBackground)!,
    }
  }

  const getBackgroundSettings = (target: BackgroundTarget): ThemeBackgroundSettings => {
    const current =
      target === 'editorBackground'
        ? theme.editorBackground
        : target === 'previewBackground'
          ? theme.previewBackground
          : theme.aiChatBackground
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
        ...(target === 'editorBackground'
          ? prev.editorBackground
          : target === 'previewBackground'
            ? prev.previewBackground
            : prev.aiChatBackground),
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
      if (activeThemeTab === 'editor-background' || activeThemeTab === 'preview-background' || activeThemeTab === 'ai-chat-background') {
        hasLocalPreviewEditsRef.current = true
        const target =
          activeThemeTab === 'editor-background'
            ? 'editorBackground'
            : activeThemeTab === 'preview-background'
              ? 'previewBackground'
              : 'aiChatBackground'
        setTheme((prev) => {
          return {
            ...prev,
            [target]: getDefaultBackgroundSettings(target),
          }
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

  const currentBackgroundTarget: BackgroundTarget =
    activeThemeTab === 'ai-chat-background'
      ? 'aiChatBackground'
      : activeThemeTab === 'preview-background'
        ? 'previewBackground'
        : 'editorBackground'
  const currentBackground = getBackgroundSettings(currentBackgroundTarget)
  const currentBackgroundOpacityInput =
    currentBackgroundTarget === 'editorBackground'
      ? editorBackgroundOpacityInput
      : currentBackgroundTarget === 'previewBackground'
        ? previewBackgroundOpacityInput
        : aiChatBackgroundOpacityInput
  const currentBackgroundOverlayOpacityInput =
    currentBackgroundTarget === 'editorBackground'
      ? editorBackgroundOverlayOpacityInput
      : currentBackgroundTarget === 'previewBackground'
        ? previewBackgroundOverlayOpacityInput
        : aiChatBackgroundOverlayOpacityInput
  const currentBackgroundBlurInput =
    currentBackgroundTarget === 'editorBackground'
      ? editorBackgroundBlurInput
      : currentBackgroundTarget === 'previewBackground'
        ? previewBackgroundBlurInput
        : aiChatBackgroundBlurInput
  const currentBackgroundBrightnessInput =
    currentBackgroundTarget === 'editorBackground'
      ? editorBackgroundBrightnessInput
      : currentBackgroundTarget === 'previewBackground'
        ? previewBackgroundBrightnessInput
        : aiChatBackgroundBrightnessInput
  const selectedImageName = currentBackground.path
    ? currentBackground.path.split(/[\\/]/).pop()
    : t('theme.image')
  const currentBackgroundPreviewUrl = resolveManagedBackgroundImageUrl(currentBackground.path)
  const currentBackgroundTitle =
    currentBackgroundTarget === 'editorBackground'
      ? t('theme.editorBackground')
      : currentBackgroundTarget === 'previewBackground'
        ? t('theme.previewBackground')
        : t('theme.aiChatBackground')

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
                          aria-selected={activeThemeTab === 'editor-background'}
                          className={`settings-panel-tab ${activeThemeTab === 'editor-background' ? 'active' : ''}`}
                          onClick={() => setActiveThemeTab('editor-background')}
                        >
                          {t('theme.editorBackground')}
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={activeThemeTab === 'preview-background'}
                          className={`settings-panel-tab ${activeThemeTab === 'preview-background' ? 'active' : ''}`}
                          onClick={() => setActiveThemeTab('preview-background')}
                        >
                          {t('theme.previewBackground')}
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={activeThemeTab === 'ai-chat-background'}
                          className={`settings-panel-tab ${activeThemeTab === 'ai-chat-background' ? 'active' : ''}`}
                          onClick={() => setActiveThemeTab('ai-chat-background')}
                        >
                          {t('theme.aiChatBackground')}
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
                        <label className="settings-field-label">{t('settings.language')}</label>
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
                      <div className="settings-subsection-heading">
                        {currentBackgroundTitle}
                      </div>
                      <div className="settings-checkbox-row">
                        <label className="settings-checkbox-label">
                          <input
                            type="checkbox"
                            checked={currentBackground.enabled}
                            onChange={(event) => updateThemeBackground(currentBackgroundTarget, { enabled: event.target.checked })}
                          />
                          <span>
                            {activeThemeTab === 'ai-chat-background'
                              ? t('theme.enableAiChatBackgroundImage')
                              : activeThemeTab === 'preview-background'
                                ? t('theme.enablePreviewBackgroundImage')
                              : t('theme.enableEditorBackgroundImage')}
                          </span>
                        </label>
                      </div>

                      <div style={{ display: 'grid', gap: 14 }}>
                        <div style={fieldGridStyle}>
                          <label className="settings-field-label">{t('theme.image')}</label>
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
                          </div>
                        </div>

                        <div style={fieldGridStyle}>
                          <label className="settings-field-label">{t('theme.imageOpacity')}</label>
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
                          <label className="settings-field-label">{t('theme.blurPx')}</label>
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
                          <label className="settings-field-label">{t('theme.overlayOpacity')}</label>
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
                          <label className="settings-field-label">{t('theme.brightnessPercent')}</label>
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
                          <label className="settings-field-label">{t('theme.imageFit')}</label>
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
                          <label className="settings-field-label">{t('theme.imagePosition')}</label>
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
                          <label className="settings-field-label">{t('typography.appFontSize')}</label>
                          <input className="field-input settings-number-input" type="number" min={10} max={24} step={1} value={uiTypography.appFontSize} onChange={updateTypographyNumber('appFontSize')} />
                        </div>
                        <div style={fieldGridStyle}>
                          <label className="settings-field-label">{t('typography.settingsFontSize')}</label>
                          <input className="field-input settings-number-input" type="number" min={10} max={24} step={1} value={uiTypography.settingsFontSize} onChange={updateTypographyNumber('settingsFontSize')} />
                        </div>
                        <div style={fieldGridStyle}>
                          <label className="settings-field-label">{t('typography.tabBarFontSize')}</label>
                          <input className="field-input settings-number-input" type="number" min={10} max={24} step={1} value={uiTypography.tabBarFontSize} onChange={updateTypographyNumber('tabBarFontSize')} />
                        </div>
                        <div style={fieldGridStyle}>
                          <label className="settings-field-label">{t('typography.statusBarFontSize')}</label>
                          <input className="field-input settings-number-input" type="number" min={10} max={24} step={1} value={uiTypography.statusBarFontSize} onChange={updateTypographyNumber('statusBarFontSize')} />
                        </div>
                      </div>
                    </div>

                    <div className="settings-subgroup">
                      <div className="settings-subgroup-title">{t('typography.groups.workspace')}</div>
                      <div style={{ display: 'grid', gap: 14 }}>
                        <div style={fieldGridStyle}>
                          <label className="settings-field-label">{t('typography.sidebarFontSize')}</label>
                          <input className="field-input settings-number-input" type="number" min={10} max={24} step={1} value={uiTypography.sidebarFontSize} onChange={updateTypographyNumber('sidebarFontSize')} />
                        </div>
                        <div style={fieldGridStyle}>
                          <label className="settings-field-label">{t('typography.editorFontSize')}</label>
                          <input className="field-input settings-number-input" type="number" min={10} max={24} step={1} value={uiTypography.editorFontSize} onChange={updateTypographyNumber('editorFontSize')} />
                        </div>
                        <div style={fieldGridStyle}>
                          <label className="settings-field-label">{t('typography.previewFontSize')}</label>
                          <input className="field-input settings-number-input" type="number" min={10} max={24} step={1} value={uiTypography.previewFontSize} onChange={updateTypographyNumber('previewFontSize')} />
                        </div>
                      </div>
                    </div>

                    <div className="settings-subgroup">
                      <div className="settings-subgroup-title">{t('typography.groups.ai')}</div>
                      <div style={{ display: 'grid', gap: 14 }}>
                        <div style={fieldGridStyle}>
                          <label className="settings-field-label">{t('typography.aiChatMessageFontSize')}</label>
                          <input className="field-input settings-number-input" type="number" min={10} max={24} step={1} value={uiTypography.aiChatMessageFontSize} onChange={updateTypographyNumber('aiChatMessageFontSize')} />
                        </div>
                        <div style={fieldGridStyle}>
                          <label className="settings-field-label">{t('typography.aiChatInputFontSize')}</label>
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
                    <div className="settings-panel-title">{t('wordExport.title')}</div>
                    <div className="settings-panel-description">
                      {t('wordExport.description')}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gap: 14 }}>
                    <div style={fieldGridStyle}>
                      <label className="settings-field-label">{t('wordExport.bodyFont')}</label>
                      <FontSelectField value={wordExport.bodyFontFamily} onChange={updateFontFamily('bodyFontFamily')} />
                    </div>
                    <div style={fieldGridStyle}>
                      <label className="settings-field-label">{t('wordExport.bodySizePt')}</label>
                      <input className="field-input settings-number-input" type="number" min={8} max={48} step={0.5} value={wordExport.bodyFontSizePt} onChange={updateNumber('bodyFontSizePt')} />
                    </div>
                    <div style={fieldGridStyle}>
                      <label className="settings-field-label">{t('wordExport.headingFont')}</label>
                      <FontSelectField value={wordExport.headingFontFamily} onChange={updateFontFamily('headingFontFamily')} />
                    </div>
                    <div style={fieldGridStyle}>
                      <label className="settings-field-label">{t('wordExport.heading1SizePt')}</label>
                      <input className="field-input settings-number-input" type="number" min={10} max={48} step={0.5} value={wordExport.heading1SizePt} onChange={updateNumber('heading1SizePt')} />
                    </div>
                    <div style={fieldGridStyle}>
                      <label className="settings-field-label">{t('wordExport.heading2SizePt')}</label>
                      <input className="field-input settings-number-input" type="number" min={10} max={48} step={0.5} value={wordExport.heading2SizePt} onChange={updateNumber('heading2SizePt')} />
                    </div>
                    <div style={fieldGridStyle}>
                      <label className="settings-field-label">{t('wordExport.heading3SizePt')}</label>
                      <input className="field-input settings-number-input" type="number" min={10} max={48} step={0.5} value={wordExport.heading3SizePt} onChange={updateNumber('heading3SizePt')} />
                    </div>
                    <div style={fieldGridStyle}>
                      <label className="settings-field-label">{t('wordExport.paragraphSpacingAfterPt')}</label>
                      <input className="field-input settings-number-input" type="number" min={0} max={72} step={0.5} value={wordExport.paragraphSpacingAfterPt} onChange={updateNumber('paragraphSpacingAfterPt')} />
                    </div>
                    <div style={fieldGridStyle}>
                      <label className="settings-field-label">{t('wordExport.lineSpacing')}</label>
                      <input className="field-input settings-number-input" type="number" min={1} max={3} step={0.05} value={wordExport.lineSpacing} onChange={updateNumber('lineSpacing')} />
                    </div>
                    <div style={fieldGridStyle}>
                      <label className="settings-field-label">{t('wordExport.codeSizePt')}</label>
                      <input className="field-input settings-number-input" type="number" min={8} max={32} step={0.5} value={wordExport.codeFontSizePt} onChange={updateNumber('codeFontSizePt')} />
                    </div>
                    <div style={fieldGridStyle}>
                      <label className="settings-field-label">{t('wordExport.pageMarginCm')}</label>
                      <input className="field-input settings-number-input" type="number" min={1} max={5} step={0.1} value={wordExport.pageMarginCm} onChange={updateNumber('pageMarginCm')} />
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
