import { TEXT_COLOR_PRESETS } from './textColorPalette'

const TEXT_COLOR_CYCLE = [...TEXT_COLOR_PRESETS.map((preset) => preset.color), null] as const

export function getNextTextColor(currentColor: string | null): string | null {
  const currentIndex = TEXT_COLOR_CYCLE.findIndex((color) => color === currentColor)
  if (currentIndex === -1) return TEXT_COLOR_CYCLE[0]
  return TEXT_COLOR_CYCLE[(currentIndex + 1) % TEXT_COLOR_CYCLE.length]
}
