import { type ChangeEvent, type FC, useEffect, useState } from 'react'
import './SettingsDialog.css'
import { Button } from './Button'
import { FontSelectField } from './settings/FontSelectField'
import {
  getDefaultWordExportStyleSettings,
  getWordExportStyleSettings,
  loadEditorSettings,
  saveEditorSettings,
  type EditorSettings,
  type WordExportStyleSettings,
} from '../modules/settings/editorSettings'

export type SettingsDialogProps = {
  open: boolean
  onClose: () => void
}

type SettingsSectionId = 'word-export'

const fieldGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '180px minmax(0, 1fr)',
  gap: 12,
  alignItems: 'center',
}

export const SettingsDialog: FC<SettingsDialogProps> = ({ open, onClose }) => {
  const [settings, setSettings] = useState<EditorSettings>({})
  const [wordExport, setWordExport] = useState<WordExportStyleSettings>(getDefaultWordExportStyleSettings())
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('word-export')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      try {
        const [loadedSettings, loadedWordExport] = await Promise.all([
          loadEditorSettings(),
          getWordExportStyleSettings(),
        ])
        if (cancelled) return
        setSettings(loadedSettings)
        setWordExport(loadedWordExport)
        setError(null)
      } catch (err) {
        if (cancelled) return
        setError((err as Error).message || 'Failed to load settings')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

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

  const handleReset = () => {
    setWordExport(getDefaultWordExportStyleSettings())
  }

  const handleSave = async () => {
    setIsSaving(true)
    setError(null)
    try {
      const nextSettings: EditorSettings = {
        ...settings,
        wordExport,
      }
      await saveEditorSettings(nextSettings)
      setSettings(nextSettings)
      onClose()
    } catch (err) {
      setError((err as Error).message || 'Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-settings" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Settings</div>
        <div className="modal-content" style={{ paddingTop: 8 }}>
          <div className="settings-layout">
            <div className="settings-sidebar">
              <div className="settings-sidebar-title">
                Categories
              </div>
              <button
                type="button"
                onClick={() => setActiveSection('word-export')}
                className={`settings-sidebar-item ${activeSection === 'word-export' ? 'active' : ''}`}
              >
                Word Export
              </button>
            </div>

            <div className="settings-panel">
              {activeSection === 'word-export' && (
                <>
                  <div className="settings-panel-header">
                    <div className="settings-panel-title">Word Export</div>
                    <div className="settings-panel-description">
                      Customize default fonts, spacing, and margins for `.docx` export.
                    </div>
                  </div>

                  <div style={{ display: 'grid', gap: 14 }}>
                    <div style={fieldGridStyle}>
                      <label className="settings-field-label">Body Font</label>
                      <FontSelectField value={wordExport.bodyFontFamily} onChange={updateFontFamily('bodyFontFamily')} />
                    </div>
                    <div style={fieldGridStyle}>
                      <label className="settings-field-label">Body Size (pt)</label>
                      <input className="field-input settings-number-input" type="number" min={8} max={48} step={0.5} value={wordExport.bodyFontSizePt} onChange={updateNumber('bodyFontSizePt')} />
                    </div>
                    <div style={fieldGridStyle}>
                      <label className="settings-field-label">Heading Font</label>
                      <FontSelectField value={wordExport.headingFontFamily} onChange={updateFontFamily('headingFontFamily')} />
                    </div>
                    <div style={fieldGridStyle}>
                      <label className="settings-field-label">Heading 1 Size (pt)</label>
                      <input className="field-input settings-number-input" type="number" min={10} max={48} step={0.5} value={wordExport.heading1SizePt} onChange={updateNumber('heading1SizePt')} />
                    </div>
                    <div style={fieldGridStyle}>
                      <label className="settings-field-label">Heading 2 Size (pt)</label>
                      <input className="field-input settings-number-input" type="number" min={10} max={48} step={0.5} value={wordExport.heading2SizePt} onChange={updateNumber('heading2SizePt')} />
                    </div>
                    <div style={fieldGridStyle}>
                      <label className="settings-field-label">Heading 3 Size (pt)</label>
                      <input className="field-input settings-number-input" type="number" min={10} max={48} step={0.5} value={wordExport.heading3SizePt} onChange={updateNumber('heading3SizePt')} />
                    </div>
                    <div style={fieldGridStyle}>
                      <label className="settings-field-label">Paragraph Spacing After (pt)</label>
                      <input className="field-input settings-number-input" type="number" min={0} max={72} step={0.5} value={wordExport.paragraphSpacingAfterPt} onChange={updateNumber('paragraphSpacingAfterPt')} />
                    </div>
                    <div style={fieldGridStyle}>
                      <label className="settings-field-label">Line Spacing</label>
                      <input className="field-input settings-number-input" type="number" min={1} max={3} step={0.05} value={wordExport.lineSpacing} onChange={updateNumber('lineSpacing')} />
                    </div>
                    <div style={fieldGridStyle}>
                      <label className="settings-field-label">Code Size (pt)</label>
                      <input className="field-input settings-number-input" type="number" min={8} max={32} step={0.5} value={wordExport.codeFontSizePt} onChange={updateNumber('codeFontSizePt')} />
                    </div>
                    <div style={fieldGridStyle}>
                      <label className="settings-field-label">Page Margin (cm)</label>
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
          <Button variant="tertiary" type="button" onClick={handleReset} disabled={isSaving}>
            Reset
          </Button>
          <Button variant="secondary" type="button" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button variant="primary" type="button" onClick={handleSave} disabled={isSaving} loading={isSaving}>
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  )
}
