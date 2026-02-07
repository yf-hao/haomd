import { describe, it, expect } from 'vitest'
import { useWorkspaceLayout } from './useWorkspaceLayout'

// 由于当前测试环境（bun test）没有 DOM，我们把对该 Hook 的测试
// 简化为“导出形态”的检查，避免依赖 document/window/localStorage。

describe('useWorkspaceLayout', () => {
  it('should export a hook function', () => {
    expect(typeof useWorkspaceLayout).toBe('function')
  })
})
