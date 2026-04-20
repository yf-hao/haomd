import type { SkillBuildSession } from './types'

const STORAGE_KEY = 'haomd:skills:authoring-session:v1'

export type PersistedSkillAuthoringDialogState = {
  mode: 'create' | 'revise'
  skillId?: string
  request: string
  session: SkillBuildSession | null
}

type PersistedStore = {
  create?: PersistedSkillAuthoringDialogState
  revise?: PersistedSkillAuthoringDialogState[]
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function loadStore(): PersistedStore {
  if (!canUseStorage()) return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as PersistedStore
  } catch (e) {
    console.error('[skillAuthoringSessionRepo] Failed to load store', e)
    return {}
  }
}

function saveStore(store: PersistedStore): void {
  if (!canUseStorage()) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch (e) {
    console.error('[skillAuthoringSessionRepo] Failed to save store', e)
  }
}

export function loadPersistedSkillAuthoringState(
  mode: 'create' | 'revise',
  skillId?: string,
): PersistedSkillAuthoringDialogState | null {
  const store = loadStore()
  if (mode === 'create') {
    return store.create ?? null
  }

  const list = store.revise ?? []
  if (!skillId) return null
  return list.find((item) => item.skillId === skillId) ?? null
}

export function savePersistedSkillAuthoringState(state: PersistedSkillAuthoringDialogState): void {
  const store = loadStore()
  if (state.mode === 'create') {
    store.create = state
    saveStore(store)
    return
  }

  const next = (store.revise ?? []).filter((item) => item.skillId !== state.skillId)
  next.push(state)
  store.revise = next
  saveStore(store)
}

export function clearPersistedSkillAuthoringState(
  mode: 'create' | 'revise',
  skillId?: string,
): void {
  const store = loadStore()
  if (mode === 'create') {
    delete store.create
    saveStore(store)
    return
  }

  store.revise = (store.revise ?? []).filter((item) => item.skillId !== skillId)
  saveStore(store)
}
