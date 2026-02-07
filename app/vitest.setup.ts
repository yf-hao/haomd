import '@testing-library/jest-dom/vitest'

// Vitest + jsdom 环境下，默认只有 window.localStorage，没有全局 localStorage。
// 这里做一个简单的桥接，方便在测试中直接使用 localStorage。
if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).localStorage = window.localStorage
}
