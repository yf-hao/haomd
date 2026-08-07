const STORAGE_KEY = 'haomd:debug:input-performance'
const SLOW_THRESHOLD_MS = 8
const SAMPLE_INTERVAL = 10

type DebugValue = string | number | boolean | null | undefined
export type DebugDetails = Record<string, DebugValue>

export type PreviewTrace = {
  id: number
  inputAt: number
  debounceAt: number
}

export type PreviewPerformanceStage =
  | 'debounce-trigger'
  | 'preview-sync'
  | 'worker-post'
  | 'worker-response'
  | 'worker-unavailable'
  | 'react-render'

type PerformanceTrace = {
  label: string
  sequence: number
  startedAt: number
  startMark: string
  details: DebugDetails
} | null

let sequence = 0
let lastInputAt: number | null = null
let debugEnabled: boolean | null = null
let enabledMessageShown = false

export function isInputPerformanceDebugEnabled(): boolean {
  if (debugEnabled !== null) return debugEnabled
  if (typeof localStorage === 'undefined') {
    debugEnabled = false
    return false
  }
  try {
    debugEnabled = localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    debugEnabled = false
  }
  if (debugEnabled && !enabledMessageShown) {
    enabledMessageShown = true
    console.info('[input-perf] enabled')
  }
  return debugEnabled
}

export function setInputPerformanceDebugEnabled(enabled: boolean): void {
  debugEnabled = enabled
  enabledMessageShown = enabled
  try {
    if (enabled) {
      localStorage.setItem(STORAGE_KEY, '1')
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    // Debug toggling must never affect editor input.
  }
  console.info(`[input-perf] ${enabled ? 'enabled' : 'disabled'}`)
}

export function beginInputPerformanceTrace(
  label: string,
  details: DebugDetails = {},
): PerformanceTrace {
  if (!isInputPerformanceDebugEnabled()) return null

  const startedAt = performance.now()
  lastInputAt = startedAt
  const sequenceNumber = ++sequence
  const startMark = `haomd:${label}:${sequenceNumber}:start`
  performance.mark(startMark)
  return {
    label,
    sequence: sequenceNumber,
    startedAt,
    startMark,
    details,
  }
}

export function endInputPerformanceTrace(
  trace: PerformanceTrace,
  details: DebugDetails = {},
): void {
  if (!trace) return
  const duration = performance.now() - trace.startedAt
  const endMark = `haomd:${trace.label}:${trace.sequence}:end`
  const measureName = `haomd:${trace.label}:${trace.sequence}`
  performance.mark(endMark)
  performance.measure(measureName, trace.startMark, endMark)

  if (duration >= SLOW_THRESHOLD_MS || trace.sequence % SAMPLE_INTERVAL === 0) {
    console.info('[input-perf]', {
      label: trace.label,
      sequence: trace.sequence,
      durationMs: Number(duration.toFixed(2)),
      ...trace.details,
      ...details,
    })
  }
}

export function measureInputPerformance<T>(
  label: string,
  operation: () => T,
  details: DebugDetails = {},
): T {
  const trace = beginInputPerformanceTrace(label, details)
  try {
    return operation()
  } finally {
    endInputPerformanceTrace(trace)
  }
}

export function logInputPerformance(
  label: string,
  details: DebugDetails = {},
  durationMs?: number,
): void {
  if (!isInputPerformanceDebugEnabled()) return

  const currentSequence = ++sequence
  if (
    durationMs !== undefined &&
    durationMs < SLOW_THRESHOLD_MS &&
    currentSequence % SAMPLE_INTERVAL !== 0
  ) {
    return
  }
  if (durationMs === undefined && currentSequence % SAMPLE_INTERVAL !== 0) {
    return
  }

  console.info('[input-perf]', {
    label,
    sequence: currentSequence,
    durationMs: durationMs === undefined ? undefined : Number(durationMs.toFixed(2)),
    sinceInputMs: lastInputAt === null
      ? undefined
      : Number((performance.now() - lastInputAt).toFixed(2)),
    ...details,
  })
}

export function logPreviewPerformance(
  stage: PreviewPerformanceStage,
  details: DebugDetails = {},
): void {
  if (!isInputPerformanceDebugEnabled()) return

  console.info('[preview-perf]', {
    stage,
    atMs: Number(performance.now().toFixed(2)),
    ...details,
  })
}

declare global {
  interface Window {
    __haomdInputPerformance?: {
      enable: () => void
      disable: () => void
      status: () => boolean
    }
  }
}

if (typeof window !== 'undefined') {
  window.__haomdInputPerformance = {
    enable: () => setInputPerformanceDebugEnabled(true),
    disable: () => setInputPerformanceDebugEnabled(false),
    status: () => isInputPerformanceDebugEnabled(),
  }
}
