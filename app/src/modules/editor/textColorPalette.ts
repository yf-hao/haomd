export type TextColorPreset = {
  id: 'red' | 'orange' | 'yellow' | 'green' | 'cyan' | 'blue' | 'purple'
  color: string
}

export const TEXT_COLOR_PRESETS: readonly TextColorPreset[] = [
  { id: 'red', color: '#ef4444' },
  { id: 'orange', color: '#f97316' },
  { id: 'yellow', color: '#eab308' },
  { id: 'green', color: '#22c55e' },
  { id: 'cyan', color: '#06b6d4' },
  { id: 'blue', color: '#3b82f6' },
  { id: 'purple', color: '#a855f7' },
]

export const RECENT_TEXT_COLORS_STORAGE_KEY = 'haomd:text-color:recent'
export const MAX_RECENT_TEXT_COLORS = 8

export const BACKGROUND_COLOR_PRESETS: readonly TextColorPreset[] = [
  { id: 'red', color: '#fca5a5' },
  { id: 'orange', color: '#fdba74' },
  { id: 'yellow', color: '#fde047' },
  { id: 'green', color: '#86efac' },
  { id: 'cyan', color: '#67e8f9' },
  { id: 'blue', color: '#93c5fd' },
  { id: 'purple', color: '#d8b4fe' },
]

export const RECENT_BACKGROUND_COLORS_STORAGE_KEY = 'haomd:background-color:recent'
