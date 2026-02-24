import { listen } from '@tauri-apps/api/event'

export type Unlisten = () => void

export type RecentMenuPayload = {
  path: string
  isFolder: boolean
}

/**
 * 监听 Tauri 原生菜单命令（menu://action）。
 * 内部处理 React StrictMode 下 effect 双执行导致的重复监听问题。
 */
export function onMenuAction(handler: (actionId: string) => void | Promise<void>): Unlisten {
  let unlisten: Unlisten | undefined
  let disposed = false

  const setup = async () => {
    try {
      const un = await listen<string>('menu://action', (event) => {
        void handler(event.payload)
      })
      if (disposed) {
        // 如果在监听完成前已经被清理，立刻注销，避免遗留监听
        try {
          un()
        } catch (err) {
          console.warn('[menuEvents] unlisten menu://action failed', err)
        }
      } else {
        unlisten = un
      }
    } catch (err) {
      console.error('[menuEvents] listen menu://action failed', err)
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
 * 监听 File → Open Recent 子菜单点击（menu://open_recent_file）。
 */
export function onOpenRecentFile(handler: (payload: RecentMenuPayload) => void | Promise<void>): Unlisten {
  let unlisten: Unlisten | undefined
  let disposed = false

  const setup = async () => {
    try {
      const un = await listen<RecentMenuPayload>('menu://open_recent_file', (event) => {
        void handler(event.payload)
      })
      if (disposed) {
        try {
          un()
        } catch (err) {
          console.warn('[menuEvents] unlisten menu://open_recent_file failed', err)
        }
      } else {
        unlisten = un
      }
    } catch (err) {
      console.error('[menuEvents] listen menu://open_recent_file failed', err)
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
