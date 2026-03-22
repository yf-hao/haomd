import { useSyncExternalStore } from 'react'
import type { ThemeSettings } from '../settings/editorSettings'

let previewOverride: ThemeSettings | null = null
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((listener) => listener())
}

export function setThemePreviewOverride(settings: ThemeSettings | null) {
  previewOverride = settings
  emit()
}

export function getThemePreviewOverride(): ThemeSettings | null {
  return previewOverride
}

export function useThemePreviewOverride(): ThemeSettings | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => previewOverride,
    () => previewOverride,
  )
}
