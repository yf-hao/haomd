import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  loadGlobalMemoryState,
  saveGlobalMemoryState,
  loadUserProfile,
  saveUserProfile,
  loadGlobalMemoryItems,
  saveGlobalMemoryItems,
  loadPendingSessionDigests,
  savePendingSessionDigests,
  updateMetaForAutoUpdate,
  clearGlobalMemoryState,
} from './repo'
import type { GlobalMemoryState, UserProfile, GlobalMemoryItem, SessionDigest } from './types'

const STORAGE_KEY = 'haomd_global_memory_v1'

const getRawState = (): GlobalMemoryState | null => {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  return raw ? (JSON.parse(raw) as GlobalMemoryState) : null
}

describe('globalMemory repo - load/save state', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('should return empty state when not in browser env', () => {
    const originalWindow = (globalThis as any).window
    ;(globalThis as any).window = undefined

    const state = loadGlobalMemoryState()

    expect(state).toEqual({
      profile: null,
      items: [],
      pendingDigests: [],
      lastGlobalUpdateTime: null,
      autoUpdateCountToday: 0,
      autoUpdateDayKey: null,
    })

    ;(globalThis as any).window = originalWindow
  })

  it('should return empty state when storage has no data', () => {
    const state = loadGlobalMemoryState()

    expect(state.profile).toBeNull()
    expect(state.items).toEqual([])
    expect(state.pendingDigests).toEqual([])
    expect(state.lastGlobalUpdateTime).toBeNull()
    expect(state.autoUpdateCountToday).toBe(0)
    expect(state.autoUpdateDayKey).toBeNull()
  })

  it('should fallback to empty state on invalid JSON', () => {
    window.localStorage.setItem(STORAGE_KEY, 'not-json')

    const state = loadGlobalMemoryState()

    expect(state.profile).toBeNull()
    expect(state.items).toEqual([])
  })

  it('should save and load a full state roundtrip', () => {
    const state: GlobalMemoryState = {
      profile: {
        id: 'user-profile',
        updatedAt: 1,
        summary: 's',
        writingStyle: 'concise',
        interests: ['a'],
        languages: ['zh-CN'],
      },
      items: [
        {
          id: 'm1',
          type: 'fact',
          title: 't',
          content: 'c',
          sourceDocs: ['/doc.md'],
          sourceSessions: ['s1'],
          createdAt: 1,
          updatedAt: 2,
          weight: 0.9,
        },
      ],
      pendingDigests: [
        {
          docPath: '/doc.md',
          period: { from: 1, to: 2 },
          summaries: ['x'],
        },
      ],
      lastGlobalUpdateTime: 123,
      autoUpdateCountToday: 2,
      autoUpdateDayKey: '2025-01-01',
    }

    saveGlobalMemoryState(state)

    const loaded = loadGlobalMemoryState()
    expect(loaded).toEqual(state)
  })

  it('saveGlobalMemoryState should no-op when not in browser env', () => {
    const originalWindow = (globalThis as any).window
    ;(globalThis as any).window = undefined

    expect(() => saveGlobalMemoryState(loadGlobalMemoryState())).not.toThrow()

    ;(globalThis as any).window = originalWindow
  })
})

describe('globalMemory repo - profile helpers', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('loadUserProfile should return null when profile not set', () => {
    expect(loadUserProfile()).toBeNull()
  })

  it('saveUserProfile should merge into state and be loadable', () => {
    const profile: UserProfile = {
      id: 'user-profile',
      updatedAt: Date.now(),
      summary: 'hello',
      writingStyle: 'detailed',
      interests: ['frontend'],
      languages: ['zh-CN', 'en'],
    }

    saveUserProfile(profile)

    const loaded = loadUserProfile()
    expect(loaded).toEqual(profile)

    const raw = getRawState()
    expect(raw?.profile).toEqual(profile)
  })
})

describe('globalMemory repo - items helpers', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('loadGlobalMemoryItems should sanitize malformed items', () => {
    const malformed: any = {
      profile: null,
      items: [
        null,
        {
          id: 'm1',
          type: 'habit',
          title: 't',
          content: 'c',
          sourceDocs: 'not-array',
          sourceSessions: undefined,
          createdAt: 1,
          updatedAt: 1,
          weight: 0.5,
        },
      ],
      pendingDigests: [],
      lastGlobalUpdateTime: null,
      autoUpdateCountToday: 0,
      autoUpdateDayKey: null,
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(malformed))

    const items = loadGlobalMemoryItems()
    expect(items).toHaveLength(1)
    const item = items[0]
    expect(item.sourceDocs).toEqual([])
    expect(item.sourceSessions).toEqual([])
  })

  it('saveGlobalMemoryItems should replace items in persisted state', () => {
    const items: GlobalMemoryItem[] = [
      {
        id: 'm2',
        type: 'preference',
        title: 'dark mode',
        content: 'prefers dark mode',
        sourceDocs: [],
        sourceSessions: [],
        createdAt: 1,
        updatedAt: 1,
        weight: 1,
      },
    ]

    saveGlobalMemoryItems(items)

    const loaded = loadGlobalMemoryItems()
    expect(loaded).toEqual(items)

    const raw = getRawState()
    expect(raw?.items).toEqual(items)
  })
})

describe('globalMemory repo - pending digests helpers', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('loadPendingSessionDigests should return empty array when not set', () => {
    const digests = loadPendingSessionDigests()
    expect(digests).toEqual([])
  })

  it('savePendingSessionDigests should overwrite pendingDigests', () => {
    const digests: SessionDigest[] = [
      {
        docPath: '/doc.md',
        period: { from: 1, to: 3 },
        summaries: ['a', 'b'],
      },
    ]

    savePendingSessionDigests(digests)

    const loaded = loadPendingSessionDigests()
    expect(loaded).toEqual(digests)

    const raw = getRawState()
    expect(raw?.pendingDigests).toEqual(digests)
  })
})

describe('globalMemory repo - meta and clear helpers', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('updateMetaForAutoUpdate should patch meta fields only', () => {
    const initial: GlobalMemoryState = {
      profile: null,
      items: [],
      pendingDigests: [],
      lastGlobalUpdateTime: null,
      autoUpdateCountToday: 0,
      autoUpdateDayKey: null,
    }
    saveGlobalMemoryState(initial)

    updateMetaForAutoUpdate({
      lastGlobalUpdateTime: 999,
      autoUpdateCountToday: 3,
      autoUpdateDayKey: '2025-01-02',
    })

    const raw = getRawState()
    expect(raw).toMatchObject({
      lastGlobalUpdateTime: 999,
      autoUpdateCountToday: 3,
      autoUpdateDayKey: '2025-01-02',
    })
  })

  it('clearGlobalMemoryState should reset to empty state', () => {
    const state: GlobalMemoryState = {
      profile: {
        id: 'user-profile',
        updatedAt: 1,
        summary: 'x',
        writingStyle: 'y',
        interests: [],
        languages: [],
      },
      items: [
        {
          id: 'id',
          type: 'fact',
          title: 't',
          content: 'c',
          sourceDocs: ['/doc'],
          sourceSessions: ['s'],
          createdAt: 1,
          updatedAt: 1,
          weight: 0.3,
        },
      ],
      pendingDigests: [
        {
          docPath: '/doc',
          period: { from: 1, to: 2 },
          summaries: ['s'],
        },
      ],
      lastGlobalUpdateTime: 1,
      autoUpdateCountToday: 1,
      autoUpdateDayKey: '2025-01-01',
    }

    saveGlobalMemoryState(state)

    clearGlobalMemoryState()

    const loaded = loadGlobalMemoryState()
    expect(loaded).toEqual({
      profile: null,
      items: [],
      pendingDigests: [],
      lastGlobalUpdateTime: null,
      autoUpdateCountToday: 0,
      autoUpdateDayKey: null,
    })
  })
})
