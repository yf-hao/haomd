import { listen } from '@tauri-apps/api/event'

export type Unlisten = () => void

/**
 * 监听原生粘贴事件（native://paste），内部处理 StrictMode 下重复监听问题。
 */
export function onNativePaste(handler: (text: string) => void): Unlisten {
  let unlisten: Unlisten | undefined
  let disposed = false

  const setup = async () => {
    try {
      const un = await listen<string>('native://paste', (event) => {
        console.log('[clipboardEvents] native://paste event received, len=', event.payload?.length)
        handler(event.payload)
      })
      if (disposed) {
        try {
          un()
        } catch (err) {
          console.warn('[clipboardEvents] unlisten native://paste failed', err)
        }
      } else {
        unlisten = un
      }
    } catch (err) {
      console.error('[clipboardEvents] listen native://paste failed', err)
    }
  }

  void setup()

  return () => {
    disposed = true
    if (unlisten) {
      unlisten()
    }
  }
}

/**
 * 监听原生粘贴错误事件（native://paste_error）。
 */
export function onNativePasteError(handler: (message: string) => void): Unlisten {
  let unlisten: Unlisten | undefined
  let disposed = false

  const setup = async () => {
    const un = await listen<string>('native://paste_error', (event) => {
      console.error('[clipboardEvents] native://paste_error:', event.payload)
      handler(event.payload)
    })
    if (disposed) {
      try {
        un()
      } catch (err) {
        console.warn('[clipboardEvents] unlisten native://paste_error failed', err)
      }
    } else {
      unlisten = un
    }
  }

  void setup()

  return () => {
    disposed = true
    if (unlisten) {
      unlisten()
    }
  }
}

/**
 * 监听原生粘贴图片事件（native://paste_image）。
 * 后端只负责检测剪贴板中是否有图片并发出事件，真正的保存路径由前端决定。
 */
export function onNativePasteImage(handler: () => void): Unlisten {
  let unlisten: Unlisten | undefined
  let disposed = false

  const setup = async () => {
    try {
      const un = await listen<unknown>('native://paste_image', () => {
        console.log('[clipboardEvents] native://paste_image event received')
        handler()
      })
      if (disposed) {
        try {
          un()
        } catch (err) {
          console.warn('[clipboardEvents] unlisten native://paste_image failed', err)
        }
      } else {
        unlisten = un
      }
    } catch (err) {
      console.error('[clipboardEvents] listen native://paste_image failed', err)
    }
  }

  void setup()

  return () => {
    disposed = true
    if (unlisten) {
      unlisten()
    }
  }
}
