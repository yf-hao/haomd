import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getAiCompressionSettings, getHugeDocSettings, resetSettingsCache } from './editorSettings'
import { mockInvoke } from '../../../vitest.setup'

describe('editorSettings', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        resetSettingsCache()
    })

    it('should return default compression settings if backend is empty', async () => {
        ; (mockInvoke as any).mockResolvedValue({ Ok: { data: {} } })

        const settings = await getAiCompressionSettings()
        expect(settings.minMessagesToCompress).toBe(80)
        expect(mockInvoke).toHaveBeenCalledWith('load_editor_settings')
    })

    it('should merge backend settings with defaults', async () => {
        ; (mockInvoke as any).mockResolvedValue({
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
        ; (mockInvoke as any).mockResolvedValue({
            Err: { error: { message: 'fail', code: 'Unknown' } }
        })

        const settings = await getHugeDocSettings()
        expect(settings.enabled).toBe(true)
        expect(settings.lineThreshold).toBe(1000)
    })
})
