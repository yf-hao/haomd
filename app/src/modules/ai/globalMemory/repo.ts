import type { GlobalMemoryState, UserProfile, GlobalMemoryItem, SessionDigest } from './types'

const STORAGE_KEY = 'haomd_global_memory_v1'

function createEmptyState(): GlobalMemoryState {
  return {
    profile: null,
    items: [],
    pendingDigests: [],
    lastGlobalUpdateTime: null,
    autoUpdateCountToday: 0,
    autoUpdateDayKey: null,
  }
}

function isBrowserEnv(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

export function loadGlobalMemoryState(): GlobalMemoryState {
  if (!isBrowserEnv()) {
    return createEmptyState()
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return createEmptyState()

    const parsed = JSON.parse(raw) as Partial<GlobalMemoryState> | null
    if (!parsed || typeof parsed !== 'object') {
      return createEmptyState()
    }

    // 逐字段做兜底，避免旧版本或损坏数据导致崩溃
    return {
      profile: parsed.profile ?? null,
      items: Array.isArray(parsed.items) ? parsed.items : [],
      pendingDigests: Array.isArray(parsed.pendingDigests) ? parsed.pendingDigests : [],
      lastGlobalUpdateTime:
        typeof parsed.lastGlobalUpdateTime === 'number' ? parsed.lastGlobalUpdateTime : null,
      autoUpdateCountToday:
        typeof parsed.autoUpdateCountToday === 'number' ? parsed.autoUpdateCountToday : 0,
      autoUpdateDayKey:
        typeof parsed.autoUpdateDayKey === 'string' ? parsed.autoUpdateDayKey : null,
    }
  } catch (e) {
    console.error('[globalMemoryRepo] Failed to load global memory state:', e)
    return createEmptyState()
  }
}

export function saveGlobalMemoryState(state: GlobalMemoryState): void {
  if (!isBrowserEnv()) return

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (e) {
    console.error('[globalMemoryRepo] Failed to save global memory state:', e)
  }
}

export function loadUserProfile(): UserProfile | null {
  const state = loadGlobalMemoryState()
  return state.profile
}

export function saveUserProfile(profile: UserProfile | null): void {
  const state = loadGlobalMemoryState()
  const next: GlobalMemoryState = {
    ...state,
    profile,
  }
  saveGlobalMemoryState(next)
}

export function loadGlobalMemoryItems(): GlobalMemoryItem[] {
  const state = loadGlobalMemoryState()
  return state.items
}

export function saveGlobalMemoryItems(items: GlobalMemoryItem[]): void {
  const state = loadGlobalMemoryState()
  const next: GlobalMemoryState = {
    ...state,
    items,
  }
  saveGlobalMemoryState(next)
}

export function loadPendingSessionDigests(): SessionDigest[] {
  const state = loadGlobalMemoryState()
  return state.pendingDigests
}

export function savePendingSessionDigests(digests: SessionDigest[]): void {
  const state = loadGlobalMemoryState()
  const next: GlobalMemoryState = {
    ...state,
    pendingDigests: digests,
  }
  saveGlobalMemoryState(next)
}

export function updateMetaForAutoUpdate(options: {
  lastGlobalUpdateTime: number
  autoUpdateCountToday: number
  autoUpdateDayKey: string
}): void {
  const state = loadGlobalMemoryState()
  const next: GlobalMemoryState = {
    ...state,
    lastGlobalUpdateTime: options.lastGlobalUpdateTime,
    autoUpdateCountToday: options.autoUpdateCountToday,
    autoUpdateDayKey: options.autoUpdateDayKey,
  }
  saveGlobalMemoryState(next)
}

export function clearGlobalMemoryState(): void {
  const empty: GlobalMemoryState = {
    profile: null,
    items: [],
    pendingDigests: [],
    lastGlobalUpdateTime: null,
    autoUpdateCountToday: 0,
    autoUpdateDayKey: null,
  }
  saveGlobalMemoryState(empty)
}
