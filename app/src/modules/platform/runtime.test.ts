import { describe, it, expect } from 'vitest'
import { isTauriEnv } from './runtime'

describe('runtime', () => {
    it('should return true if __TAURI_INTERNALS__ is present', () => {
        window.__TAURI_INTERNALS__ = {}
        expect(isTauriEnv()).toBe(true)
        delete window.__TAURI_INTERNALS__
    })

    it('should return true if __TAURI__ is present', () => {
        window.__TAURI__ = {}
        expect(isTauriEnv()).toBe(true)
        delete window.__TAURI__
    })

    it('should return false if neither is present', () => {
        expect(isTauriEnv()).toBe(false)
    })
})
