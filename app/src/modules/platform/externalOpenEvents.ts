import { listen } from '@tauri-apps/api/event'

export type Unlisten = () => void

export type ExternalOpenPayload = {
  path: string
  isFolder: boolean
}

export function onExternalOpenFile(handler: (payload: ExternalOpenPayload) => void | Promise<void>): Unlisten {
  let unlisten: Unlisten | undefined
  let disposed = false
  let unlistenCalled = false

  const setup = async () => {
    try {
      const un = await listen<ExternalOpenPayload>('native://open_external_file', (event) => {
        void handler(event.payload)
      })
      if (disposed) {
        if (!unlistenCalled) {
          unlistenCalled = true
          try {
            un()
          } catch (err) {
            console.warn('[externalOpenEvents] unlisten native://open_external_file failed', err)
          }
        }
      } else {
        unlisten = un
      }
    } catch (err) {
      console.error('[externalOpenEvents] listen native://open_external_file failed', err)
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
        console.warn('[externalOpenEvents] manual unlisten native://open_external_file failed', err)
      }
    }
  }
}
