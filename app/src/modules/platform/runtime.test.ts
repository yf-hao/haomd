import { describe, it, expect } from 'vitest'
import { isTauriEnv } from './runtime'

describe('runtime', () => {
    it('should return true if __TAURI_INTERNALS__ is present', () => {
        (globalThis as any).__TAURI_INTERNALS__ = {}
        expect(isTauriEnv()).toBe(true)
        delete (globalThis as any).__TAURI_INTERNALS__
    })

    it('should return true if __TAURI__ is present', () => {
        (globalThis as any).__TAURI__ = {}
        expect(isTauriEnv()).toBe(true)
        delete (globalThis as any).__TAURI__
    })

    it('should return false if neither is present', () => {
        expect(isTauriEnv()).toBe(false)
    })
})
