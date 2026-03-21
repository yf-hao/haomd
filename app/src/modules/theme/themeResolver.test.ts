import { describe, expect, it } from 'vitest'
import { resolveActiveTheme, resolveThemeMode } from './themeResolver'

describe('themeResolver', () => {
  it('resolves system mode using OS preference', () => {
    expect(resolveThemeMode('system', true)).toBe('dark')
    expect(resolveThemeMode('system', false)).toBe('light')
  })

  it('resolves builtin themes directly', () => {
    expect(resolveThemeMode('light', true)).toBe('light')
    expect(resolveThemeMode('dark', false)).toBe('dark')
    expect(resolveThemeMode('romantic', true)).toBe('light')
  })

  it('falls back custom mode to resolved builtin theme', () => {
    expect(resolveThemeMode('custom', true)).toBe('dark')
    expect(resolveThemeMode('custom', false)).toBe('light')
  })

  it('returns builtin active theme definition', () => {
    expect(resolveActiveTheme('light', true).id).toBe('light')
    expect(resolveActiveTheme('dark', false).id).toBe('dark')
    expect(resolveActiveTheme('romantic', true).id).toBe('romantic')
    expect(resolveActiveTheme('system', true).id).toBe('dark')
  })
})
