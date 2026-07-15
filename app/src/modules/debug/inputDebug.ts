const INPUT_DEBUG_FLAG = 'haomd-debug-ai-input'

export function isInputDebugEnabled() {
  return typeof window !== 'undefined'
    && window.localStorage.getItem(INPUT_DEBUG_FLAG) === '1'
}

export function logInputDebug(scope: string, event: string, details?: Record<string, unknown>) {
  if (!isInputDebugEnabled()) return
  if (details && Object.keys(details).length > 0) {
    console.log(`[input-debug][${scope}] ${event}`, details)
    return
  }
  console.log(`[input-debug][${scope}] ${event}`)
}
