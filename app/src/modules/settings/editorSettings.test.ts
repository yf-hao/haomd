import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getAiCompressionSettings,
  getHugeDocSettings,
  getLanguageSetting,
  getThemeSettings,
  getWordExportStyleSettings,
  resetSettingsCache,
  saveEditorSettings,
} from './editorSettings'
import { mockInvoke } from '../../../vitest.setup'

describe('editorSettings', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        resetSettingsCache()
    })

    it('should return default compression settings if backend is empty', async () => {
        vi.mocked(mockInvoke).mockResolvedValue({ Ok: { data: {} } })

        const settings = await getAiCompressionSettings()
        expect(settings.minMessagesToCompress).toBe(80)
        expect(mockInvoke).toHaveBeenCalledWith('load_editor_settings')
    })

    it('should merge backend settings with defaults', async () => {
        vi.mocked(mockInvoke).mockResolvedValue({
            Ok: {
                data: {
                    aiCompression: { minMessagesToCompress: 50 },
                    hugeDoc: { enabled: false }
                }
            }
        })

        const compSettings = await getAiCompressionSettings()
        expect(compSettings.minMessagesToCompress).toBe(50)
        expect(compSettings.keepRecentRounds).toBe(8) // from default

        const hugeSettings = await getHugeDocSettings()
        expect(hugeSettings.enabled).toBe(false)
        expect(hugeSettings.lineThreshold).toBe(1000) // from default
    })

    it('should handle backend errors and return defaults', async () => {
        vi.mocked(mockInvoke).mockResolvedValue({
            Err: { error: { message: 'fail', code: 'Unknown' } }
        })

        const settings = await getHugeDocSettings()
        expect(settings.enabled).toBe(true)
        expect(settings.lineThreshold).toBe(1000)
    })

    it('should merge word export settings with defaults', async () => {
        vi.mocked(mockInvoke).mockResolvedValue({
            Ok: {
                data: {
                    wordExport: {
                        bodyFontFamily: 'Calibri',
                        lineSpacing: 1.5,
                    }
                }
            }
        })

        const settings = await getWordExportStyleSettings()
        expect(settings.bodyFontFamily).toBe('Calibri')
        expect(settings.lineSpacing).toBe(1.5)
        expect(settings.bodyFontSizePt).toBe(12)
        expect(settings.pageMarginCm).toBe(2.54)
    })

    it('should return default theme settings if backend is empty', async () => {
        vi.mocked(mockInvoke).mockResolvedValue({ Ok: { data: {} } })

        const settings = await getThemeSettings()
        expect(settings.mode).toBe('system')
        expect(settings.customThemeId).toBeNull()
        expect(settings.aiChatBackground?.enabled).toBe(false)
        expect(settings.aiChatBackground?.size).toBe('height-fill')
    })

    it('should return default language setting if backend is empty', async () => {
        vi.mocked(mockInvoke).mockResolvedValue({ Ok: { data: {} } })

        const language = await getLanguageSetting()
        expect(language).toBe('system')
    })

    it('should preserve theme preset metadata from backend', async () => {
        vi.mocked(mockInvoke).mockResolvedValue({
            Ok: {
                data: {
                    theme: {
                        mode: 'romantic',
                        customThemeId: 'romantic',
                        editorBackground: {
                            enabled: true,
                            path: '/tmp/romantic-bg.png',
                            opacity: 0.16,
                        },
                        aiChatBackground: {
                            enabled: true,
                            path: '/tmp/romantic-chat-bg.png',
                            opacity: 0.24,
                        },
                    }
                }
            }
        })

        const settings = await getThemeSettings()
        expect(settings.mode).toBe('romantic')
        expect(settings.customThemeId).toBe('romantic')
        expect(settings.editorBackground?.enabled).toBe(true)
        expect(settings.editorBackground?.path).toBe('/tmp/romantic-bg.png')
        expect(settings.editorBackground?.opacity).toBe(0.16)
        expect(settings.editorBackground?.overlayOpacity).toBe(0)
        expect(settings.editorBackground?.blurPx).toBe(1)
        expect(settings.editorBackground?.size).toBe('height-fill')
        expect(settings.aiChatBackground?.enabled).toBe(true)
        expect(settings.aiChatBackground?.path).toBe('/tmp/romantic-chat-bg.png')
        expect(settings.aiChatBackground?.opacity).toBe(0.24)
        expect(settings.aiChatBackground?.overlayOpacity).toBe(0)
    })

    it('should save editor settings through backend command', async () => {
        vi.mocked(mockInvoke).mockResolvedValue({ Ok: { data: null } })

        await saveEditorSettings({
            wordExport: {
                bodyFontFamily: 'Calibri',
                bodyFontSizePt: 11,
            }
        })

        expect(mockInvoke).toHaveBeenCalledWith('save_editor_settings', {
            cfg: {
                wordExport: {
                    bodyFontFamily: 'Calibri',
                    bodyFontSizePt: 11,
                }
            }
        })
    })

    it('should throw when save_editor_settings returns an error', async () => {
        vi.mocked(mockInvoke).mockResolvedValue({
            Err: { error: { message: 'save failed', code: 'UNKNOWN' } }
        })

        await expect(saveEditorSettings({})).rejects.toThrow('save failed')
    })
})
