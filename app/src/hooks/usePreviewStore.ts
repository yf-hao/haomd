import { useSyncExternalStore } from 'react'

export type PreviewStore = {
  getSnapshot: () => string
  subscribe: (listener: () => void) => () => void
  set: (value: string) => void
}

export function createPreviewStore(initialValue: string): PreviewStore {
  let value = initialValue
  const listeners = new Set<() => void>()

  return {
    getSnapshot: () => value,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: (nextValue) => {
      if (nextValue === value) return
      value = nextValue
      listeners.forEach((listener) => listener())
    },
  }
}

export function usePreviewValue(store: PreviewStore): string {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
