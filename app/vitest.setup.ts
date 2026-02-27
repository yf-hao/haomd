import { expect, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'

// 扩展 Jest DOM 匹配器
expect.extend(matchers)

// 每个测试后清理 DOM
afterEach(() => {
  cleanup()
})

// Vitest + jsdom 环境下，默认只有 window.localStorage，没有全局 localStorage。
// 这里做一个简单的桥接，方便在测试中直接使用 localStorage。
if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ; (globalThis as any).localStorage = window.localStorage
}

// Mock Tauri API core (Tauri 2.0)
const mockInvoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}))

// Mock legacy Tauri API
vi.mock('@tauri-apps/api', () => ({
  invoke: mockInvoke,
}))

// Mock Tauri Plugins frequently used in app
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: vi.fn(),
}))

// Mock ResizeObserver (common in React components)
globalThis.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}))

export { mockInvoke }

