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
    expect(resolveThemeMode('electric-mint', false)).toBe('dark')
    expect(resolveThemeMode('neon-pop', true)).toBe('dark')
    expect(resolveThemeMode('velvet-rose', false)).toBe('dark')
    expect(resolveThemeMode('paper', true)).toBe('light')
    expect(resolveThemeMode('focus', false)).toBe('dark')
    expect(resolveThemeMode('ai-console', false)).toBe('dark')
    expect(resolveThemeMode('high-contrast', true)).toBe('light')
  })

  it('falls back custom mode to resolved builtin theme', () => {
    expect(resolveThemeMode('custom', true)).toBe('dark')
    expect(resolveThemeMode('custom', false)).toBe('light')
  })

  it('returns builtin active theme definition', () => {
    expect(resolveActiveTheme('light', true).id).toBe('light')
    expect(resolveActiveTheme('dark', false).id).toBe('dark')
    expect(resolveActiveTheme('romantic', true).id).toBe('romantic')
    expect(resolveActiveTheme('electric-mint', false).id).toBe('electric-mint')
    expect(resolveActiveTheme('neon-pop', true).id).toBe('neon-pop')
    expect(resolveActiveTheme('velvet-rose', false).id).toBe('velvet-rose')
    expect(resolveActiveTheme('paper', true).id).toBe('paper')
    expect(resolveActiveTheme('focus', false).id).toBe('focus')
    expect(resolveActiveTheme('ai-console', false).id).toBe('ai-console')
    expect(resolveActiveTheme('high-contrast', false).id).toBe('high-contrast')
    expect(resolveActiveTheme('system', true).id).toBe('dark')
  })
})
