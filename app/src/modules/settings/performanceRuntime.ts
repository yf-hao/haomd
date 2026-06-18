import type { PerformanceSettings } from './editorSettings'

const PERFORMANCE_SETTINGS_CHANGED_EVENT = 'haomd:performance-settings-changed'

export function emitPerformanceSettingsChanged(settings: PerformanceSettings) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<PerformanceSettings>(PERFORMANCE_SETTINGS_CHANGED_EVENT, { detail: settings }))
}

export function subscribePerformanceSettingsChanged(listener: (settings: PerformanceSettings) => void) {
  if (typeof window === 'undefined') return () => {}
  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<PerformanceSettings>
    if (customEvent.detail) {
      listener(customEvent.detail)
    }
  }
  window.addEventListener(PERFORMANCE_SETTINGS_CHANGED_EVENT, handler)
  return () => window.removeEventListener(PERFORMANCE_SETTINGS_CHANGED_EVENT, handler)
}
