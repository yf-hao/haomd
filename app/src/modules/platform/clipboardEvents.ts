import { emit, listen } from '@tauri-apps/api/event'
import { isTauriEnv } from './runtime'

export type Unlisten = () => void

function createNativeClipboardListener<T>(
  eventName: string,
  onEvent: (payload: T) => void,
  onListenErrorLabel: string,
): Unlisten {
  if (!isTauriEnv()) {
    return () => {}
  }

  let unlisten: Unlisten | undefined
  let disposed = false
  let unlistenCalled = false

  const setup = async () => {
    try {
      const un = await listen<T>(eventName, (event) => {
        onEvent(event.payload)
      })
      if (disposed) {
        if (!unlistenCalled) {
          unlistenCalled = true
          try {
            un()
          } catch (err) {
            console.warn(`[clipboardEvents] unlisten ${eventName} failed`, err)
          }
        }
      } else {
        unlisten = un
      }
    } catch (err) {
      console.error(onListenErrorLabel, err)
    }
  }

  void setup()

  return () => {
    disposed = true
    if (unlisten && !unlistenCalled) {
      unlistenCalled = true
      try {
        unlisten()
      } catch (err) {
        console.warn(`[clipboardEvents] manual unlisten ${eventName} failed`, err)
      }
    }
  }
}

/**
 * 监听原生粘贴事件（native://paste），内部处理 StrictMode 下重复监听问题。
 */
export function onNativePaste(handler: (text: string) => void): Unlisten {
  return createNativeClipboardListener<string>(
    'native://paste',
    (payload) => {
      console.log('[clipboardEvents] native://paste event received, len=', payload?.length)
      handler(payload)
    },
    '[clipboardEvents] listen native://paste failed',
  )
}

/**
 * 监听原生粘贴错误事件（native://paste_error）。
 */
export function onNativePasteError(handler: (message: string) => void): Unlisten {
  return createNativeClipboardListener<string>(
    'native://paste_error',
    (payload) => {
      console.error('[clipboardEvents] native://paste_error:', payload)
      handler(payload)
    },
    '[clipboardEvents] listen native://paste_error failed',
  )
}

/**
 * 监听原生粘贴图片事件（native://paste_image）。
 * 后端只负责检测剪贴板中是否有图片并发出事件，真正的保存路径由前端决定。
 */
export function onNativePasteImage(handler: () => void): Unlisten {
  return createNativeClipboardListener<unknown>(
    'native://paste_image',
    () => {
        console.log('[clipboardEvents] native://paste_image event received')
        handler()
    },
    '[clipboardEvents] listen native://paste_image failed',
  )
}

export async function dispatchNativePasteImage(): Promise<void> {
  if (!isTauriEnv()) return
  await emit('native://paste_image')
}
