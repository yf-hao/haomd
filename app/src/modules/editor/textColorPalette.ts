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
  { id: 'red', color: '#fee2e2' },
  { id: 'orange', color: '#ffedd5' },
  { id: 'yellow', color: '#fef3c7' },
  { id: 'green', color: '#dcfce7' },
  { id: 'cyan', color: '#cffafe' },
  { id: 'blue', color: '#dbeafe' },
  { id: 'purple', color: '#f3e8ff' },
]

export const RECENT_BACKGROUND_COLORS_STORAGE_KEY = 'haomd:background-color:recent'
