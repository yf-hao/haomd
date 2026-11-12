export type DictionaryPronunciationAccent = 'british' | 'american'

export type DictionarySettings = {
  mdxPath: string
  pronunciationAccent: DictionaryPronunciationAccent
  useInAiChat: boolean
}

const STORAGE_KEY = 'haomd:dictionary-settings:v1'
const LEGACY_PDF_STORAGE_KEY = 'pdf-translation-settings-v1'
const CHANGED_EVENT = 'haomd:dictionary-settings-changed'

const DEFAULT_SETTINGS: DictionarySettings = {
  mdxPath: '',
  pronunciationAccent: 'british',
  useInAiChat: false,
}

function normalizeSettings(value: Partial<DictionarySettings> | null | undefined): DictionarySettings {
  return {
    mdxPath: typeof value?.mdxPath === 'string' ? value.mdxPath : '',
    pronunciationAccent: value?.pronunciationAccent === 'american' ? 'american' : 'british',
    useInAiChat: value?.useInAiChat === true,
  }
}

export function getDictionarySettings(): DictionarySettings {
  if (typeof window === 'undefined') return { ...DEFAULT_SETTINGS }
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored) return normalizeSettings(JSON.parse(stored) as Partial<DictionarySettings>)

    // Move the first PDF-only dictionary choice into the shared dictionary settings.
    const legacy = window.localStorage.getItem(LEGACY_PDF_STORAGE_KEY)
    if (legacy) {
      const parsed = JSON.parse(legacy) as { dictionaryPath?: unknown; dictionaryAccent?: unknown }
      const migrated = normalizeSettings({
        mdxPath: typeof parsed.dictionaryPath === 'string' ? parsed.dictionaryPath : '',
        pronunciationAccent: parsed.dictionaryAccent === 'american' ? 'american' : 'british',
      })
      if (migrated.mdxPath) saveDictionarySettings(migrated)
      return migrated
    }
  } catch (error) {
    console.warn('[dictionarySettings] load failed', error)
  }
  return { ...DEFAULT_SETTINGS }
}

export function saveDictionarySettings(settings: DictionarySettings) {
  const normalized = normalizeSettings(settings)
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
    window.dispatchEvent(new CustomEvent<DictionarySettings>(CHANGED_EVENT, { detail: normalized }))
  }
}

export function subscribeDictionarySettingsChanged(listener: (settings: DictionarySettings) => void) {
  if (typeof window === 'undefined') return () => undefined
  const handler = (event: Event) => listener((event as CustomEvent<DictionarySettings>).detail)
  window.addEventListener(CHANGED_EVENT, handler)
  return () => window.removeEventListener(CHANGED_EVENT, handler)
}
