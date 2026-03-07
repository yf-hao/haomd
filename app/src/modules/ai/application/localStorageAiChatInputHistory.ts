const STORAGE_KEY = 'haomd:aiChat:inputHistory'

export type AiInputHistoryEntry = {
  text: string
  createdAt: string
}

export type AiInputHistoryStore = {
  [directoryKey: string]: AiInputHistoryEntry[]
}

function isStorageAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function loadStore(): AiInputHistoryStore {
  if (!isStorageAvailable()) return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as AiInputHistoryStore
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed
  } catch (e) {
    console.error('[AiInputHistory] Failed to load store from localStorage', e)
    return {}
  }
}

function saveStore(store: AiInputHistoryStore): void {
  if (!isStorageAvailable()) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch (e) {
    console.error('[AiInputHistory] Failed to save store to localStorage', e)
  }
}

export function appendAiInputHistory(directoryKey: string, text: string): void {
  const trimmed = text.trim()
  if (!trimmed) return

  const store = loadStore()
  const list = store[directoryKey] ?? []

  const entry: AiInputHistoryEntry = {
    text: trimmed,
    createdAt: new Date().toISOString(),
  }

  store[directoryKey] = [...list, entry]
  saveStore(store)
}

export function getAiInputHistory(directoryKey: string): AiInputHistoryEntry[] {
  const store = loadStore()
  return store[directoryKey] ?? []
}

export function getLatestAiInput(directoryKey: string): AiInputHistoryEntry | null {
  const list = getAiInputHistory(directoryKey)
  if (!list.length) return null
  return list[list.length - 1] ?? null
}

export function getRecentAiInputs(directoryKey: string, limit = 10): AiInputHistoryEntry[] {
  const all = getAiInputHistory(directoryKey)
  if (all.length <= limit) return all
  return all.slice(all.length - limit)
}

export function clearAiInputHistoryForDirectory(directoryKey: string): void {
  const store = loadStore()
  if (!store[directoryKey]) return
  delete store[directoryKey]
  saveStore(store)
}

export function clearAllAiInputHistory(): void {
  if (!isStorageAvailable()) return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch (e) {
    console.error('[AiInputHistory] Failed to clear store from localStorage', e)
  }
}