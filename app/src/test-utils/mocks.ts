// app/src/test-utils/mocks.ts
import { vi } from 'vitest'

/**
 * Mock Tauri Backend API
 */
export function createMockTauriBackend() {
    return {
        readFile: vi.fn(),
        writeFile: vi.fn(),
        openFile: vi.fn(),
        saveFile: vi.fn(),
        listRecentFiles: vi.fn(),
        clearRecentFiles: vi.fn(),
    }
}

/**
 * Mock AI Client
 */
export function createMockAiClient() {
    return {
        openChat: vi.fn().mockResolvedValue({ ok: true, message: 'AI response' }),
        askAboutFile: vi.fn().mockResolvedValue({ ok: true, message: 'File analysis' }),
        askAboutSelection: vi.fn().mockResolvedValue({ ok: true, message: 'Selection analysis' }),
        streamChat: vi.fn().mockImplementation(async function* () {
            yield 'Hello'
            yield ' World'
        }),
    }
}

/**
 * Mock File Service
 */
export function createMockFileService() {
    return {
        openFile: vi.fn(),
        saveFile: vi.fn(),
        newFile: vi.fn(),
        watchFile: vi.fn(),
        unwatchFile: vi.fn(),
    }
}
