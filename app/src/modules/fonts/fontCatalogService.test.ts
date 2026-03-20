import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadAvailableFonts,
  resetFontCatalogCache,
  searchFonts,
} from './fontCatalogService'
import * as fontCatalogRepo from './fontCatalogRepo'

describe('fontCatalogService', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    resetFontCatalogCache()
  })

  it('should normalize and deduplicate system fonts', async () => {
    vi.spyOn(fontCatalogRepo, 'listSystemFonts').mockResolvedValue([
      { family: 'Calibri', displayName: 'Calibri', source: 'system' },
      { family: 'calibri', displayName: 'CALIBRI', source: 'system' },
      { family: 'Source Han Sans SC', displayName: 'Source Han Sans SC', source: 'system' },
    ])

    const fonts = await loadAvailableFonts()
    expect(fonts.find((font) => font.family === 'Calibri')?.source).toBe('system')
    expect(fonts.filter((font) => font.family === 'Calibri')).toHaveLength(1)
    expect(fonts.some((font) => font.family === 'Source Han Sans SC')).toBe(true)
  })

  it('should search fonts by family or display name', () => {
    const fonts = [
      { family: 'Source Han Sans SC', displayName: 'Source Han Sans SC', source: 'system' as const },
      { family: 'Inter', displayName: 'Inter', source: 'system' as const },
    ]

    expect(searchFonts(fonts, 'source han')).toEqual([
      { family: 'Source Han Sans SC', displayName: 'Source Han Sans SC', source: 'system' },
    ])
  })
})
