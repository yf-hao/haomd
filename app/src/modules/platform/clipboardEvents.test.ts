import { describe, it, expect, vi, beforeEach } from 'vitest'
import { onNativePaste, onNativePasteError, onNativePasteImage } from './clipboardEvents'
import { listen } from '@tauri-apps/api/event'

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn()
}))

describe('clipboardEvents', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('should register onNativePaste and handle events', async () => {
        const handler = vi.fn()
        const unlistenMock = vi.fn()
        vi.mocked(listen).mockResolvedValue(unlistenMock as any)

        const unlisten = onNativePaste(handler)

        // Wait for setup async
        await new Promise(r => setTimeout(r, 0))

        expect(listen).toHaveBeenCalledWith('native://paste', expect.any(Function))

        // Simulate event
        const callback = vi.mocked(listen).mock.calls[0][1]
        callback({ payload: 'test text', event: 'native://paste', id: 1 } as any)
        expect(handler).toHaveBeenCalledWith('test text')

        unlisten()
        expect(unlistenMock).toHaveBeenCalled()
    })

    it('should handle onNativePasteError', async () => {
        const handler = vi.fn()
        const unlistenMock = vi.fn()
        vi.mocked(listen).mockResolvedValue(unlistenMock as any)

        const unlisten = onNativePasteError(handler)
        await new Promise(r => setTimeout(r, 0))

        const callback = vi.mocked(listen).mock.calls[0][1]
        callback({ payload: 'error message', event: 'native://paste_error', id: 1 } as any)
        expect(handler).toHaveBeenCalledWith('error message')

        unlisten()
        expect(unlistenMock).toHaveBeenCalled()
    })

    it('should handle onNativePasteImage', async () => {
        const handler = vi.fn()
        const unlistenMock = vi.fn()
        vi.mocked(listen).mockResolvedValue(unlistenMock as any)

        const unlisten = onNativePasteImage(handler)
        await new Promise(r => setTimeout(r, 0))

        const callback = vi.mocked(listen).mock.calls[0][1]
        callback({ payload: '', event: 'native://paste_image', id: 1 } as any)
        expect(handler).toHaveBeenCalled()

        unlisten()
        expect(unlistenMock).toHaveBeenCalled()
    })

    it('should handle early unlisten (disposed before setup finishes)', async () => {
        const unlistenMock = vi.fn()
        let resolveListen: (val: any) => void = () => { }
        vi.mocked(listen).mockImplementation(() => new Promise(r => { resolveListen = r }))

        const unlisten = onNativePaste(vi.fn())
        unlisten() // dispose early

        resolveListen(unlistenMock)
        await new Promise(r => setTimeout(r, 0))

        expect(unlistenMock).toHaveBeenCalled()
    })
})
