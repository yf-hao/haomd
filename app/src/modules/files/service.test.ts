import { describe, it, expect } from 'vitest'
import type { BackendError } from '../platform/backendTypes'
import type { RecentFile } from './types'
import { mergeRecent } from './service'

import { mapCodeForTest, normalizeInvokeErrorForTest } from './serviceTestHelpers'

// 这里我们通过辅助导出函数测试 mapCode 和 normalizeInvokeError 的行为

describe('files/service helpers', () => {
  it('mapCodeForTest should map backend codes to domain codes', () => {
    expect(mapCodeForTest('OK')).toBe('OK')
    expect(mapCodeForTest('NotFound')).toBe('NOT_FOUND')
    expect(mapCodeForTest('IoError')).toBe('IO_ERROR')
    expect(mapCodeForTest('TooLarge')).toBe('TOO_LARGE')
    expect(mapCodeForTest('UNKNOWN')).toBe('UNKNOWN')
  })

  it('normalizeInvokeErrorForTest should map unknown error to UNKNOWN code with message', () => {
    const result = normalizeInvokeErrorForTest(new Error('boom'))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('UNKNOWN')
      expect(result.error.message).toContain('boom')
    }
  })

  it('normalizeInvokeErrorForTest should respect BackendError-like code', () => {
    const error = { message: 'io fail', code: 'IoError' } as BackendError & { message: string }
    const result = normalizeInvokeErrorForTest(error)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('IO_ERROR')
      expect(result.error.message).toContain('io fail')
    }
  })

  it('mergeRecent should deduplicate by path, sort by lastOpenedAt, and respect limit', () => {
    const base: RecentFile[] = [
      {
        path: '/a.md',
        displayName: 'a',
        lastOpenedAt: 1,
        isFolder: false,
      },
      {
        path: '/b.md',
        displayName: 'b',
        lastOpenedAt: 2,
        isFolder: false,
      },
    ]

    const entry: RecentFile = {
      path: '/a.md',
      displayName: 'a (new)',
      lastOpenedAt: 3,
      isFolder: false,
    }

    const merged = mergeRecent(base, entry, 3)
    expect(merged).toHaveLength(2)
    // 新 entry 在最前
    expect(merged[0].path).toBe('/a.md')
    expect(merged[0].lastOpenedAt).toBe(3)
    // b 保持存在
    expect(merged[1].path).toBe('/b.md')
  })
})
