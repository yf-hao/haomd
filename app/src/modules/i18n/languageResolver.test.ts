import { describe, expect, it } from 'vitest'
import { normalizeLanguageTag, resolveLanguageMode } from './languageResolver'

describe('languageResolver', () => {
  it('normalizes Chinese language tags to zh-CN', () => {
    expect(normalizeLanguageTag('zh')).toBe('zh-CN')
    expect(normalizeLanguageTag('zh-Hans-CN')).toBe('zh-CN')
  })

  it('falls back unknown language tags to en-US', () => {
    expect(normalizeLanguageTag('en-US')).toBe('en-US')
    expect(normalizeLanguageTag('fr-FR')).toBe('en-US')
  })

  it('resolves explicit language modes directly', () => {
    expect(resolveLanguageMode('zh-CN')).toBe('zh-CN')
    expect(resolveLanguageMode('en-US')).toBe('en-US')
  })
})
