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
  getDefaultWordExportStyleSettings,
  getLanguageSetting,
  getThemeSettings,
  getWordExportStyleSettings,
  loadEditorSettings,
  saveEditorSettings,
  type EditorSettings,
  type ThemeSettings,
  type ThemeEditorBackgroundSize,
  type WordExportStyleSettings,
} from '../modules/settings/editorSettings'
import type { ThemeMode } from '../modules/theme/schema'

export type SettingsDialogProps = {
  open: boolean
  onClose: () => void
  onThemeSettingsChange?: (settings: ThemeSettings) => void
  onLanguageModeChange?: (mode: LanguageMode) => void
}

type SettingsSectionId = 'theme' | 'word-export'
type ThemePanelTabId = 'theme-preset' | 'editor-background'

const fieldGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '180px minmax(0, 1fr)',
  gap: 12,
  alignItems: 'center',
}

const settingsImagePreviewUrlCache = new Map<string, string>()

function encodeSettingsImagePreviewPath(absPath: string): string {
  const isWindows = absPath.includes('\\') || navigator.userAgent.includes('Windows')
  const cacheKey = `${isWindows ? 'win' : 'unix'}|${absPath}`
  const cached = settingsImagePreviewUrlCache.get(cacheKey)
  if (cached) return cached

  const pathParts = absPath.split(/([/\\])/)
  const encodedParts = pathParts.map((part) => {
    if (part === '/' || part === '\\') return part
    return encodeURIComponent(part)
  })
  const encoded = encodedParts.join('')
  const finalUrl = isWindows ? `https://haomd.localhost${encoded}` : `haomd://localhost${encoded}`
  settingsImagePreviewUrlCache.set(cacheKey, finalUrl)
  return finalUrl
}

export const SettingsDialog: FC<SettingsDialogProps> = ({
  open,
  onClose,
  onThemeSettingsChange,
  onLanguageModeChange,
}) => {
  const { t } = useI18n()
  const [settings, setSettings] = useState<EditorSettings>({})
  const [theme, setTheme] = useState<ThemeSettings>(getDefaultThemeSettings())
  const [languageMode, setLanguageMode] = useState<LanguageMode>(getDefaultLanguageSetting())
  const [wordExport, setWordExport] = useState<WordExportStyleSettings>(getDefaultWordExportStyleSettings())
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('theme')
  const [activeThemeTab, setActiveThemeTab] = useState<ThemePanelTabId>('theme-preset')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editorBackgroundOpacityInput, setEditorBackgroundOpacityInput] = useState('')
  const [editorBackgroundOverlayOpacityInput, setEditorBackgroundOverlayOpacityInput] = useState('')
  const [editorBackgroundBlurInput, setEditorBackgroundBlurInput] = useState('')
  const [editorBackgroundBrightnessInput, setEditorBackgroundBrightnessInput] = useState('')
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const previewDragRef = useRef(false)
  const modalRef = useRef<HTMLDivElement | null>(null)
  const originalThemeRef = useRef<ThemeSettings>(getDefaultThemeSettings())
  const originalLanguageRef = useRef<LanguageMode>(getDefaultLanguageSetting())
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
    let cancelled = false
    ;(async () => {
      try {
        const [loadedSettings, loadedTheme, loadedLanguage, loadedWordExport] = await Promise.all([
          loadEditorSettings(),
          getThemeSettings(),
          getLanguageSetting(),
          getWordExportStyleSettings(),
        ])
        if (cancelled) return
        setSettings(loadedSettings)
        setTheme(loadedTheme)
        originalThemeRef.current = loadedTheme
        setLanguageMode(loadedLanguage)
        originalLanguageRef.current = loadedLanguage
        themePreviewReadyRef.current = true
        setWordExport(loadedWordExport)
        setEditorBackgroundOpacityInput(String(loadedTheme.editorBackground?.opacity ?? getDefaultThemeSettings().editorBackground?.opacity ?? 0.3))
        setEditorBackgroundOverlayOpacityInput(String(loadedTheme.editorBackground?.overlayOpacity ?? getDefaultThemeSettings().editorBackground?.overlayOpacity ?? 0))
        setEditorBackgroundBlurInput(String(loadedTheme.editorBackground?.blurPx ?? getDefaultThemeSettings().editorBackground?.blurPx ?? 1))
        setEditorBackgroundBrightnessInput(String(loadedTheme.editorBackground?.brightness ?? getDefaultThemeSettings().editorBackground?.brightness ?? 100))
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
    onThemeSettingsChange?.(theme)
  }, [open, theme, onThemeSettingsChange])

  useEffect(() => {
    if (!open || !themePreviewReadyRef.current) return
    onLanguageModeChange?.(languageMode)
  }, [open, languageMode, onLanguageModeChange])

  useEffect(() => {
    setEditorBackgroundOpacityInput(String(theme.editorBackground?.opacity ?? getDefaultThemeSettings().editorBackground?.opacity ?? 0.3))
    setEditorBackgroundOverlayOpacityInput(String(theme.editorBackground?.overlayOpacity ?? getDefaultThemeSettings().editorBackground?.overlayOpacity ?? 0))
    setEditorBackgroundBlurInput(String(theme.editorBackground?.blurPx ?? getDefaultThemeSettings().editorBackground?.blurPx ?? 1))
    setEditorBackgroundBrightnessInput(String(theme.editorBackground?.brightness ?? getDefaultThemeSettings().editorBackground?.brightness ?? 100))
  }, [theme.editorBackground?.opacity, theme.editorBackground?.overlayOpacity, theme.editorBackground?.blurPx, theme.editorBackground?.brightness])

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
    setTheme((prev) => ({ ...prev, mode }))
  }

  const updateEditorBackground = (
    patch: Partial<NonNullable<ThemeSettings['editorBackground']>>,
  ) => {
    setTheme((prev) => ({
      ...prev,
      editorBackground: {
        enabled:
          patch.enabled
          ?? prev.editorBackground?.enabled
          ?? getDefaultThemeSettings().editorBackground?.enabled
          ?? false,
        path:
          patch.path
          ?? prev.editorBackground?.path
          ?? getDefaultThemeSettings().editorBackground?.path
          ?? null,
        opacity:
          patch.opacity
          ?? prev.editorBackground?.opacity
          ?? getDefaultThemeSettings().editorBackground?.opacity
          ?? 0.1,
        overlayOpacity:
          patch.overlayOpacity
          ?? prev.editorBackground?.overlayOpacity
          ?? getDefaultThemeSettings().editorBackground?.overlayOpacity
          ?? 0,
        blurPx:
          patch.blurPx
          ?? prev.editorBackground?.blurPx
          ?? getDefaultThemeSettings().editorBackground?.blurPx
          ?? 1,
        brightness:
          patch.brightness
          ?? prev.editorBackground?.brightness
          ?? getDefaultThemeSettings().editorBackground?.brightness
          ?? 100,
        size:
          patch.size
          ?? prev.editorBackground?.size
          ?? getDefaultThemeSettings().editorBackground?.size
          ?? 'cover',
        positionX:
          patch.positionX
          ?? prev.editorBackground?.positionX
          ?? getDefaultThemeSettings().editorBackground?.positionX
          ?? 50,
        positionY:
          patch.positionY
          ?? prev.editorBackground?.positionY
          ?? getDefaultThemeSettings().editorBackground?.positionY
          ?? 50,
      },
    }))
  }

  const handleSelectEditorBackground = async () => {
    try {
      const selected = await invoke<string | null>('pick_editor_background_image', {
        currentPath: editorBackground.path,
      })
      if (!selected) return
      updateEditorBackground({
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

  const clearEditorBackground = () => {
    updateEditorBackground({
      enabled: false,
      path: null,
    })
  }

  const commitEditorBackgroundNumber = (key: 'opacity' | 'overlayOpacity' | 'blurPx' | 'brightness', rawValue: string) => {
    const trimmed = rawValue.trim()
    if (!trimmed) {
      updateEditorBackground({ [key]: 0 } as Pick<NonNullable<ThemeSettings['editorBackground']>, typeof key>)
      if (key === 'opacity') {
        setEditorBackgroundOpacityInput('')
      } else if (key === 'overlayOpacity') {
        setEditorBackgroundOverlayOpacityInput('')
      } else if (key === 'brightness') {
        setEditorBackgroundBrightnessInput('')
      } else {
        setEditorBackgroundBlurInput('')
      }
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

    updateEditorBackground({ [key]: normalizedValue } as Pick<NonNullable<ThemeSettings['editorBackground']>, typeof key>)
    if (key === 'opacity') {
      setEditorBackgroundOpacityInput(String(normalizedValue))
    } else if (key === 'overlayOpacity') {
      setEditorBackgroundOverlayOpacityInput(String(normalizedValue))
    } else if (key === 'brightness') {
      setEditorBackgroundBrightnessInput(String(normalizedValue))
    } else {
      setEditorBackgroundBlurInput(String(normalizedValue))
    }
  }

  const updateEditorBackgroundSize = (event: ChangeEvent<HTMLSelectElement>) => {
    updateEditorBackground({ size: event.target.value as ThemeEditorBackgroundSize })
  }

  const updateEditorBackgroundPositionFromPointer = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const x = ((event.clientX - rect.left) / rect.width) * 100
    const y = ((event.clientY - rect.top) / rect.height) * 100
    updateEditorBackground({
      positionX: Math.min(Math.max(Number(x.toFixed(2)), 0), 100),
      positionY: Math.min(Math.max(Number(y.toFixed(2)), 0), 100),
    })
  }

  const handleReset = () => {
    if (activeSection === 'theme') {
      if (activeThemeTab === 'editor-background') {
        setTheme((prev) => ({
          ...prev,
          editorBackground: getDefaultThemeSettings().editorBackground,
        }))
      }
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
        wordExport,
      }
      await saveEditorSettings(nextSettings)
      setSettings(nextSettings)
      originalThemeRef.current = theme
      originalLanguageRef.current = languageMode
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
    }
    onClose()
  }

  const editorBackground = theme.editorBackground ?? getDefaultThemeSettings().editorBackground!
  const selectedImageName = editorBackground.path
    ? editorBackground.path.split(/[\\/]/).pop()
    : t('theme.image')
  const editorBackgroundPreviewUrl = editorBackground.path
    ? encodeSettingsImagePreviewPath(editorBackground.path)
    : null

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
                      <div className="settings-checkbox-row">
                        <label className="settings-checkbox-label">
                          <input
                            type="checkbox"
                            checked={editorBackground.enabled}
                            onChange={(event) => updateEditorBackground({ enabled: event.target.checked })}
                          />
                          <span>{t('theme.enableEditorBackgroundImage')}</span>
                        </label>
                      </div>

                      <div style={{ display: 'grid', gap: 14 }}>
                        <div style={fieldGridStyle}>
                          <label className="settings-field-label">{t('theme.image')}</label>
                          <div className="settings-inline-actions">
                            <div className="settings-inline-meta">{selectedImageName}</div>
                            <div className="settings-inline-buttons">
                              <Button variant="secondary" type="button" onClick={() => void handleSelectEditorBackground()}>
                                {t('common.chooseImage')}
                              </Button>
                              <Button variant="tertiary" type="button" onClick={clearEditorBackground} disabled={!editorBackground.path}>
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
                            value={editorBackgroundOpacityInput}
                            onChange={(event) => setEditorBackgroundOpacityInput(event.target.value)}
                            onBlur={(event) => commitEditorBackgroundNumber('opacity', event.target.value)}
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
                            value={editorBackgroundBlurInput}
                            onChange={(event) => setEditorBackgroundBlurInput(event.target.value)}
                            onBlur={(event) => commitEditorBackgroundNumber('blurPx', event.target.value)}
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
                            value={editorBackgroundOverlayOpacityInput}
                            onChange={(event) => setEditorBackgroundOverlayOpacityInput(event.target.value)}
                            onBlur={(event) => commitEditorBackgroundNumber('overlayOpacity', event.target.value)}
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
                            value={editorBackgroundBrightnessInput}
                            onChange={(event) => setEditorBackgroundBrightnessInput(event.target.value)}
                            onBlur={(event) => commitEditorBackgroundNumber('brightness', event.target.value)}
                          />
                        </div>

                        <div style={fieldGridStyle}>
                          <label className="settings-field-label">{t('theme.imageFit')}</label>
                          <select
                            className="field-select"
                          value={editorBackground.size}
                          onChange={updateEditorBackgroundSize}
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
                              className={`settings-image-position-picker ${editorBackground.path ? '' : 'disabled'}`}
                              onPointerDown={(event) => {
                                if (!editorBackground.path) return
                                previewDragRef.current = true
                                event.currentTarget.setPointerCapture(event.pointerId)
                                updateEditorBackgroundPositionFromPointer(event)
                              }}
                              onPointerMove={(event) => {
                                if (!previewDragRef.current || !editorBackground.path) return
                                updateEditorBackgroundPositionFromPointer(event)
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
                              {editorBackground.path ? (
                                <img
                                  className={`settings-image-position-preview fit-${editorBackground.size}`}
                                  src={editorBackgroundPreviewUrl ?? ''}
                                  alt=""
                                  aria-hidden="true"
                                  style={{
                                    objectPosition: `${editorBackground.positionX}% ${editorBackground.positionY}%`,
                                    opacity: Math.min(Math.max(editorBackground.opacity, 0), 0.4),
                                    filter: `blur(${Math.min(Math.max(editorBackground.blurPx, 0), 24)}px) brightness(${Math.min(Math.max(editorBackground.brightness, 0), 200)}%)`,
                                    ['--settings-image-position-x' as string]: `${editorBackground.positionX}%`,
                                    ['--settings-image-position-y' as string]: `${editorBackground.positionY}%`,
                                  }}
                                />
                              ) : (
                                <div className="settings-image-position-empty">{t('theme.chooseImageToDrag')}</div>
                              )}
                              <div
                                className="settings-image-position-preview-overlay"
                                aria-hidden="true"
                                style={{
                                  opacity: Math.min(Math.max(editorBackground.overlayOpacity ?? 0, 0), 1),
                                }}
                              />
                              <div
                                className="settings-image-position-crosshair"
                                style={{
                                  left: `${editorBackground.positionX}%`,
                                  top: `${editorBackground.positionY}%`,
                                }}
                              />
                            </div>
                            <div className="settings-inline-meta">
                              {t('theme.positionLabel', {
                                x: Math.round(editorBackground.positionX),
                                y: Math.round(editorBackground.positionY),
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
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
          {activeSection === 'word-export' || (activeSection === 'theme' && activeThemeTab === 'editor-background') ? (
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
