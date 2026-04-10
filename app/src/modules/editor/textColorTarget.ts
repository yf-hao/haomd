export type TextColorTargetMode = 'source' | 'wysiwyg'

export type TextColorTarget = {
  docKey: string
  mode: TextColorTargetMode
  from: number
  to: number
  timestamp: number
}

export const TEXT_COLOR_TARGET_TTL_MS = 10_000

export function createTextColorTarget(
  docKey: string,
  mode: TextColorTargetMode,
  from: number,
  to: number,
): TextColorTarget {
  return {
    docKey,
    mode,
    from,
    to,
    timestamp: Date.now(),
  }
}

export function isTextColorTargetActive(
  target: TextColorTarget | null | undefined,
  docKey: string | null | undefined,
  mode: TextColorTargetMode,
): target is TextColorTarget {
  if (!target || !docKey) return false
  if (target.docKey !== docKey || target.mode !== mode) return false
  if (target.from >= target.to) return false
  return Date.now() - target.timestamp <= TEXT_COLOR_TARGET_TTL_MS
}
