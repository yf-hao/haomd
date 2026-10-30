import { invoke } from '@tauri-apps/api/core'

/** Temporary AI Chat scroll diagnostics. Enable with localStorage.setItem('ai-chat-scroll-debug', '1'). */
const DEBUG_KEY = 'ai-chat-scroll-debug'
let sequence = 0
let shouldResetFile = true
let writeQueue = Promise.resolve()

export function chatScrollDebug(
  event: string,
  container?: HTMLElement | null,
  details: Record<string, unknown> = {},
) {
  if (typeof window === 'undefined' || window.localStorage.getItem(DEBUG_KEY) !== '1') return
  const state = container ? {
    scrollTop: Math.round(container.scrollTop * 10) / 10,
    scrollHeight: Math.round(container.scrollHeight * 10) / 10,
    clientHeight: container.clientHeight,
  } : {}
  const record = {
    sequence: ++sequence,
    timestamp: new Date().toISOString(),
    elapsedMs: Math.round(performance.now()),
    event,
    ...state,
    ...details,
  }
  console.debug('[AI chat scroll]', record)
  const reset = shouldResetFile
  shouldResetFile = false
  writeQueue = writeQueue.then(async () => {
    const path = await invoke<string>('append_ai_chat_scroll_debug', {
      line: JSON.stringify(record),
      reset,
    })
    if (reset) console.info(`[AI chat scroll] 日志已写入 ${path}`)
  }).catch((error) => {
    console.warn('[AI chat scroll] 写入日志文件失败', error)
  })
}
