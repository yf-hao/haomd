import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { I18nProvider } from '../modules/i18n/I18nContext'
import { SettingsDialog } from './SettingsDialog'
import { mockInvoke } from '../../vitest.setup'
import { resetSettingsCache } from '../modules/settings/editorSettings'

describe('SettingsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSettingsCache()
  })

  it('should preview preview-background selection immediately', async () => {
    vi.mocked(mockInvoke).mockImplementation(async (command: string) => {
      if (command === 'load_editor_settings') {
        return { Ok: { data: {} } }
      }
      if (command === 'pick_editor_background_image') {
        return '/tmp/preview-background.webp'
      }
      return { Ok: { data: null } }
    })

    const onThemeSettingsChange = vi.fn()
    render(
      <I18nProvider value={{ languageMode: 'en-US', resolvedLanguage: 'en-US' }}>
        <SettingsDialog
          open
          onClose={() => {}}
          onThemeSettingsChange={onThemeSettingsChange}
        />
      </I18nProvider>,
    )

    fireEvent.click(await screen.findByRole('tab', { name: 'Backgrounds' }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Preview' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose Image' }))

    await waitFor(() => {
      expect(onThemeSettingsChange).toHaveBeenCalled()
    })

    const latestTheme =
      onThemeSettingsChange.mock.calls[onThemeSettingsChange.mock.calls.length - 1]?.[0]

    expect(latestTheme.previewBackground?.enabled).toBe(true)
    expect(latestTheme.previewBackground?.path).toBe('/tmp/preview-background.webp')
  })
})
