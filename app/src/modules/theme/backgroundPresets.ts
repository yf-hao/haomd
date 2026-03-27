import inkScapeUrl from '../../assets/background-presets/Ink-Scape.jpg'
import sciFiUrl from '../../assets/background-presets/Sci-Fi.jpg'
import zenBloomUrl from '../../assets/background-presets/Zen-Bloom.jpg'

export type BuiltinBackgroundPreset = {
  id: string
  label: string
  url: string
}

export const builtinBackgroundPresets: BuiltinBackgroundPreset[] = [
  { id: 'ink-scape', label: 'Ink Scape', url: inkScapeUrl },
  { id: 'sci-fi', label: 'Sci-Fi', url: sciFiUrl },
  { id: 'zen-bloom', label: 'Zen Bloom', url: zenBloomUrl },
]

export function getBuiltinBackgroundPresetUrl(id: string): string | null {
  return builtinBackgroundPresets.find((preset) => preset.id === id)?.url ?? null
}

export function getBuiltinBackgroundPresetLabel(id: string): string | null {
  return builtinBackgroundPresets.find((preset) => preset.id === id)?.label ?? null
}
