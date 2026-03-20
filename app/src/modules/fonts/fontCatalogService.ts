import { listSystemFonts, type SystemFontOption } from './fontCatalogRepo'

export type FontOption = {
  family: string
  displayName: string
  source: 'system'
}

let cachedFonts: FontOption[] | null = null
let pendingFontsPromise: Promise<FontOption[]> | null = null

export async function loadAvailableFonts(): Promise<FontOption[]> {
  if (cachedFonts) {
    return cachedFonts.map((font) => ({ ...font }))
  }

  if (!pendingFontsPromise) {
    pendingFontsPromise = listSystemFonts()
      .then((systemFonts) => {
        cachedFonts = normalizeSystemFonts(systemFonts)
        return cachedFonts
      })
      .finally(() => {
        pendingFontsPromise = null
      })
  }

  const fonts = await pendingFontsPromise
  return fonts.map((font) => ({ ...font }))
}

export function searchFonts(options: FontOption[], keyword: string): FontOption[] {
  const normalizedKeyword = keyword.trim().toLocaleLowerCase()
  if (!normalizedKeyword) {
    return options
  }

  return options.filter((option) => {
    const haystacks = [option.family, option.displayName]
    return haystacks.some((value) => value.toLocaleLowerCase().includes(normalizedKeyword))
  })
}

export function resetFontCatalogCache() {
  cachedFonts = null
  pendingFontsPromise = null
}

function normalizeSystemFonts(systemFonts: SystemFontOption[]): FontOption[] {
  const merged = new Map<string, FontOption>()
  for (const option of systemFonts) {
    const family = option.family.trim()
    if (!family) continue
    const key = family.toLocaleLowerCase()
    if (!merged.has(key)) {
      merged.set(key, {
        family,
        displayName: option.displayName.trim() || family,
        source: option.source,
      })
    }
  }

  return [...merged.values()].sort((left, right) => left.displayName.localeCompare(right.displayName))
}
