import { listen } from '@tauri-apps/api/event'

export type Unlisten = () => void

/**
 * 监听原生粘贴事件（native://paste），内部处理 StrictMode 下重复监听问题。
 */
export function onNativePaste(handler: (text: string) => void): Unlisten {
  let unlisten: Unlisten | undefined
  let disposed = false

  const setup = async () => {
    const un = await listen<string>('native://paste', (event) => {
      handler(event.payload)
    })
    if (disposed) {
      un()
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
 * 监听原生粘贴错误事件（native://paste_error）。
 */
export function onNativePasteError(handler: (message: string) => void): Unlisten {
  let unlisten: Unlisten | undefined
  let disposed = false

  const setup = async () => {
    const un = await listen<string>('native://paste_error', (event) => {
      handler(event.payload)
    })
    if (disposed) {
      un()
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
